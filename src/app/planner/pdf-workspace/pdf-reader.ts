import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import { PageInspection, PdfPoint, SourcePath } from './pdf-workspace.model';

type Matrix = number[];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export function transform(m: Matrix, x: number, y: number): PdfPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** PDF.js remains responsible for appearance. This adapter only proposes selectable geometry. */
export class PdfReader {
  private doc?: PDFDocumentProxy;
  private loadingTask?: PDFDocumentLoadingTask;
  private page?: PDFPageProxy;
  private renderTask?: RenderTask;
  private generation = 0;
  private renderGeneration = 0;
  async open(bytes: ArrayBuffer): Promise<number> {
    await this.destroy();
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'assets/pdfjs/pdf.worker.min.mjs',
      document.baseURI,
    ).href;
    this.loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes.slice(0)),
      isEvalSupported: false,
      cMapUrl: new URL('assets/pdfjs/cmaps/', document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('assets/pdfjs/standard_fonts/', document.baseURI).href,
    });
    this.doc = await this.loadingTask.promise;
    return this.doc.numPages;
  }
  async inspect(pageNumber: number): Promise<PageInspection> {
    if (!this.doc) throw new Error('Open a PDF first.');
    const generation = ++this.generation;
    const page = await this.doc.getPage(pageNumber);
    this.page = page;
    const viewport = page.getViewport({ scale: 1 });
    const result: PageInspection = {
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
      userUnit: page.userUnit,
      transform: [...viewport.transform],
      paths: [],
      texts: [],
      layers: [],
      images: 0,
      curvedPaths: 0,
      clippedPaths: 0,
      issues: [],
    };
    const pdfjs = await import('pdfjs-dist');
    const O = pdfjs.OPS;
    const [ops, text, config] = await Promise.all([
      page.getOperatorList(),
      page.getTextContent(),
      this.doc.getOptionalContentConfig(),
    ]).catch((error) => {
      result.issues.push(
        `Automatic extraction failed: ${error instanceof Error ? error.message : 'unreadable content'}. Original rendering and manual tracing remain available.`,
      );
      return [null, null, null] as const;
    });
    if (!ops || !text || !config) return result;
    const groups = config.getGroups() ?? {};
    const layerStack: string[] = [];
    const visibilityStack: boolean[] = [];
    let state = { matrix: identity(), clipped: false };
    const stack: (typeof state)[] = [];
    let pendingClip = false;
    let current: SourcePath | undefined;
    let vertices = 0;
    const paints = new Set([
      O.stroke,
      O.closeStroke,
      O.fill,
      O.eoFill,
      O.fillStroke,
      O.eoFillStroke,
      O.closeFillStroke,
      O.closeEOFillStroke,
    ]);
    const closes = new Set([O.closeStroke, O.closeFillStroke, O.closeEOFillStroke]);
    const fills = new Set([
      O.fill,
      O.eoFill,
      O.fillStroke,
      O.eoFillStroke,
      O.closeFillStroke,
      O.closeEOFillStroke,
    ]);
    const names = new Map(Object.entries(O).map(([name, code]) => [code, name]));
    const otherPaints = new Map<string, number>();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (i % 2000 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (generation !== this.generation) throw new Error('Page inspection cancelled.');
      }
      if (i > 2_000_000 || vertices > 1_000_000) {
        result.issues.push(
          'Geometry inspection reached its resource limit. Remaining content is reference-only; the original page is retained.',
        );
        break;
      }
      const fn = ops.fnArray[i],
        args = ops.argsArray[i] as any[];
      if (fn === O.save) stack.push({ matrix: [...state.matrix], clipped: state.clipped });
      else if (fn === O.restore) state = stack.pop() ?? { matrix: identity(), clipped: false };
      else if (fn === O.paintFormXObjectBegin) {
        stack.push({ matrix: [...state.matrix], clipped: state.clipped });
        state = {
          matrix: args?.[0] ? multiply(state.matrix, args[0]) : state.matrix,
          clipped: state.clipped || !!args?.[1],
        };
      } else if (fn === O.paintFormXObjectEnd)
        state = stack.pop() ?? { matrix: identity(), clipped: false };
      else if (fn === O.transform)
        state = { ...state, matrix: multiply(state.matrix, args as number[]) };
      else if (fn === O.beginMarkedContent || fn === O.beginMarkedContentProps) {
        const value = args?.[1];
        const id = typeof value === 'string' ? value : value?.id;
        layerStack.push(id && groups[id] ? groups[id].name : (layerStack.at(-1) ?? 'Unlayered'));
        visibilityStack.push(
          (visibilityStack.at(-1) ?? true) &&
            (id && groups[id] ? groups[id].visible !== false : true),
        );
      } else if (fn === O.endMarkedContent) {
        layerStack.pop();
        visibilityStack.pop();
      } else if (fn === O.clip || fn === O.eoClip) pendingClip = true;
      else if (fn === O.constructPath) {
        const pathOps = args[0] as number[],
          coords = args[1] as number[];
        const m = multiply(viewport.transform, state.matrix);
        const points: PdfPoint[] = [];
        let d = '',
          k = 0,
          moves = 0,
          closed = false,
          curved = false;
        let last: PdfPoint = { x: 0, y: 0 },
          first: PdfPoint = last;
        const pt = () => {
          const p = transform(m, coords[k++], coords[k++]);
          points.push(p);
          return p;
        };
        const pair = (p: PdfPoint) => `${p.x} ${p.y}`;
        for (const op of pathOps) {
          if (op === O.moveTo) {
            last = pt();
            first = last;
            d += `M${pair(last)} `;
            moves++;
            closed = false;
          } else if (op === O.lineTo) {
            last = pt();
            d += `L${pair(last)} `;
          } else if (op === O.curveTo) {
            const a = pt(),
              b = pt();
            last = pt();
            d += `C${pair(a)} ${pair(b)} ${pair(last)} `;
            curved = true;
          } else if (op === O.curveTo2) {
            const a = last,
              b = pt();
            last = pt();
            d += `C${pair(a)} ${pair(b)} ${pair(last)} `;
            curved = true;
          } else if (op === O.curveTo3) {
            const a = pt();
            last = pt();
            d += `C${pair(a)} ${pair(last)} ${pair(last)} `;
            curved = true;
          } else if (op === O.closePath) {
            d += 'Z ';
            last = first;
            closed = true;
          } else if (op === O.rectangle) {
            const [x, y, w, h] = coords.slice(k, k + 4);
            k += 4;
            const ps = [
              transform(m, x, y),
              transform(m, x + w, y),
              transform(m, x + w, y + h),
              transform(m, x, y + h),
            ];
            points.push(...ps);
            first = last = ps[0];
            d += `M${ps.map(pair).join(' L')} Z `;
            closed = true;
            moves++;
          }
        }
        vertices += points.length;
        if (points.length) {
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          current = {
            id: `p${pageNumber}-op${i}`,
            layer: layerStack.at(-1) ?? 'Unlayered',
            d,
            points,
            closed,
            curved,
            compound: moves > 1,
            hidden: visibilityStack.at(-1) === false,
            clipped: state.clipped,
            bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          };
        }
      } else if (paints.has(fn)) {
        if (current) {
          if ((closes.has(fn) || fills.has(fn)) && !current.closed) {
            current.d += 'Z';
            current.closed = true;
          }
          current.clipped ||= pendingClip;
          result.paths.push(current);
          if (current.curved) result.curvedPaths++;
          if (current.clipped) result.clippedPaths++;
        }
        current = undefined;
        if (pendingClip) {
          state = { ...state, clipped: true };
          pendingClip = false;
        }
      } else if (fn === O.endPath) {
        current = undefined;
        if (pendingClip) {
          state = { ...state, clipped: true };
          pendingClip = false;
        }
      } else {
        const name = names.get(fn) ?? `operator-${fn}`;
        if (name.startsWith('paintImage') || name.startsWith('paintInlineImage')) result.images++;
        else if (name === 'shadingFill' || name === 'paintFormXObjectBegin')
          otherPaints.set(name, (otherPaints.get(name) ?? 0) + 1);
      }
    }
    result.texts = text.items.flatMap((item) =>
      'str' in item
        ? [
            {
              text: item.str,
              position: transform(viewport.transform, item.transform[4], item.transform[5]),
            },
          ]
        : [],
    );
    result.layers = [...new Set(result.paths.map((p) => p.layer))].sort();
    const hidden = result.paths.filter((p) => p.hidden).length;
    if (hidden)
      result.issues.push(
        `${hidden} paths belong to hidden PDF layers. They are retained in the source and excluded from selection.`,
      );
    if (result.curvedPaths)
      result.issues.push(
        `${result.curvedPaths} curved paths are preserved visually; conversion to straight polygons is disabled.`,
      );
    if (result.clippedPaths)
      result.issues.push(
        `${result.clippedPaths} paths have clipping. Their untrimmed geometry cannot be accepted automatically.`,
      );
    if (result.images)
      result.issues.push(
        `${result.images} image paint operations remain reference-only. Trace required objects; OCR is not enabled in this milestone.`,
      );
    for (const [name, count] of otherPaints)
      result.issues.push(
        `${count} ${name} operations retained in the original rendering; inspect related geometry manually.`,
      );
    if (!result.texts.length)
      result.issues.push(
        'No readable text found. Labels may be outlines or pixels; no labels have been invented.',
      );
    result.issues.push(
      'Path selection does not identify stalls or infer symbol meanings. Review classification and legend associations.',
    );
    return result;
  }
  /** Render only the visible tile. Zoom is not limited by a full-page bitmap budget. */
  async selectPage(pageNumber: number): Promise<void> {
    if (!this.doc) throw new Error('Open a PDF first.');
    this.page = await this.doc.getPage(pageNumber);
  }
  async render(
    canvas: HTMLCanvasElement,
    scale: number,
    left: number,
    top: number,
    width: number,
    height: number,
  ): Promise<void> {
    const generation = ++this.renderGeneration;
    const page = this.page;
    if (!page) return;
    this.renderTask?.cancel();
    try {
      await this.renderTask?.promise;
    } catch {
      /* A newer viewport owns this canvas. */
    }
    if (generation !== this.renderGeneration || page !== this.page) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.ceil(width * dpr));
    canvas.height = Math.max(1, Math.ceil(height * dpr));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render a PDF canvas.');
    const task = page.render({
      canvasContext: context,
      viewport: page.getViewport({ scale: scale * dpr }),
      transform: [1, 0, 0, 1, -left * dpr, -top * dpr],
      background: 'white',
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if ((e as Error).name !== 'RenderingCancelledException') throw e;
    }
  }
  async destroy(): Promise<void> {
    this.generation++;
    this.renderGeneration++;
    this.renderTask?.cancel();
    this.page = undefined;
    if (this.doc) {
      await this.doc.destroy();
      this.doc = undefined;
    } else if (this.loadingTask) await this.loadingTask.destroy();
    this.loadingTask = undefined;
  }
}
