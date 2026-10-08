import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PdfReader } from './pdf-reader';
import {
  Calibration,
  ObjectKind,
  PageInspection,
  PdfObject,
  PdfPoint,
  PdfWorkspace,
  SourcePath,
  area,
  calibrate,
  calibrationFor,
  contains,
  distance,
  polygonError,
  sourceToMetres,
} from './pdf-workspace.model';
import {
  hashPdf,
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
  listHallBindings,
  saveHallBinding,
} from './pdf-workspace.storage';
import { PdfImportNavigation } from './pdf-import-navigation.service';
import { preparePdfHall, hallSignature } from './pdf-hall-plan';
import { SetupApiService } from '../../setup/setup-api.service';
import { extractErrorMessage } from '../../core/http-error.util';
import type { Hall } from '../models/hall.model';
import { readWorkspaceBackup, workspaceBackup } from './pdf-workspace.backup';
import { PdfObjectPreviewComponent } from './pdf-object-preview.component';
import { PdfThreeSceneComponent, type PdfTileRenderer } from './pdf-three-scene.component';
import type { PdfDrawingSurface } from '../three/pdf-drawing-surface';

type Tool = 'select' | 'trace' | 'calibrate' | 'measure';
type View = 'original' | 'compare' | 'edited';

@Component({
  selector: 'app-pdf-workspace',
  imports: [
    RouterLink,
    FormsModule,
    DecimalPipe,
    PdfObjectPreviewComponent,
    PdfThreeSceneComponent,
  ],
  templateUrl: './pdf-workspace.component.html',
  styleUrl: './pdf-workspace.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.embedded]': 'embedded()' },
})
export class PdfWorkspaceComponent {
  readonly embedded = input(false);
  readonly surface = input<PdfDrawingSurface | null>(null);
  readonly hallOpened = output<Hall>();
  private readonly reader = new PdfReader();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navigation = inject(PdfImportNavigation);
  private readonly api = inject(SetupApiService);
  // A storage failure after a successful POST must never trigger another POST on retry.
  private readonly createdHalls = new Map<string, Hall>();
  readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  readonly svg = viewChild<ElementRef<SVGSVGElement>>('overlay');
  readonly threeScene = viewChild(PdfThreeSceneComponent);
  readonly engine = signal<'three' | 'reference'>('three');
  readonly threeZoom = signal(1);
  readonly renderThreeTile: PdfTileRenderer = (canvas, scale, left, top, width, height) =>
    this.reader.render(canvas, scale, left, top, width, height);
  readonly doc = signal<PdfWorkspace | null>(null);
  readonly inspection = signal<PageInspection | null>(null);
  readonly pageCount = signal(0);
  readonly busy = signal('');
  readonly error = signal('');
  readonly message = signal('');
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly library = signal<Array<{ id: string; name: string; updatedAt: number }>>([]);
  readonly selectedId = signal('');
  readonly selectedPath = signal<SourcePath | null>(null);
  readonly tool = signal<Tool>('select');
  readonly view = signal<View>('compare');
  readonly zoom = signal(0.5);
  readonly layer = signal('');
  readonly points = signal<PdfPoint[]>([]);
  readonly history = signal<PdfWorkspace[]>([]);
  readonly future = signal<PdfWorkspace[]>([]);
  readonly kinds: ObjectKind[] = ['unknown', 'hall', 'foyer', 'stall', 'wall', 'symbol', 'legend'];
  knownMetres: number | null = null;
  measurementExpected: number | null = null;
  vertexText = '';
  referenceText = '';
  traceText = '';
  moveX = 0;
  moveY = 0;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private saveRevision = 0;
  private resize?: ResizeObserver;
  readonly objects = computed(
    () => this.doc()?.objects.filter((o) => o.page === this.doc()?.page) ?? [],
  );
  readonly selected = computed(
    () => this.objects().find((o) => o.id === this.selectedId()) ?? null,
  );
  readonly halls = computed(() => this.objects().filter((o) => o.kind === 'hall'));
  readonly legends = computed(() => this.objects().filter((o) => o.kind === 'legend'));
  readonly hallImportIssue = computed(() => {
    const doc = this.doc(),
      object = this.selected();
    if (!doc || !object) return 'Select or trace a hall outline to continue.';
    try {
      preparePdfHall(doc, object);
      return '';
    } catch (e) {
      return this.errorText(e);
    }
  });
  readonly activeCalibration = computed(() => {
    const doc = this.doc(),
      selected = this.selected();
    return doc
      ? selected
        ? calibrationFor(doc, selected)
        : doc.pageCalibrations[doc.page]
      : undefined;
  });
  readonly selectedArea = computed(() => {
    const object = this.selected(),
      cal = this.activeCalibration();
    return object && cal ? area(object.points) * cal.metresPerUnit ** 2 : null;
  });
  readonly metricPoints = computed(() => {
    const object = this.selected(),
      cal = this.activeCalibration();
    return object && cal ? sourceToMetres(object.points, cal) : [];
  });
  readonly measured = computed(() => {
    const points = this.points(),
      cal = this.activeCalibration();
    return points.length === 2 && cal ? distance(points[0], points[1]) * cal.metresPerUnit : null;
  });
  readonly sourcePathConvertible = computed(() => {
    const path = this.selectedPath();
    return (
      !!path &&
      path.closed &&
      !path.curved &&
      !path.compound &&
      !path.clipped &&
      !polygonError(this.cleanClosingPoint(path.points))
    );
  });
  readonly reviewItems = computed(() => {
    const doc = this.doc();
    if (!doc) return [];
    return doc.objects.flatMap((o) => {
      const reasons: string[] = [];
      if (!o.reviewed) reasons.push('review not confirmed');
      if (o.kind === 'unknown') reasons.push('object type unknown');
      if (!calibrationFor(doc, o)) reasons.push('scale not calibrated');
      if (o.kind === 'symbol' && !o.legendId) reasons.push('legend meaning unassigned');
      if (o.kind === 'stall' && o.heightMetres === null) reasons.push('3D height unknown');
      return reasons.length
        ? [{ id: o.id, name: o.name, page: o.page, reasons: reasons.join('; ') }]
        : [];
    });
  });
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      clearTimeout(this.renderTimer);
      this.resize?.disconnect();
      void this.reader.destroy();
    });
    afterNextRender(() => {
      void this.refreshLibrary();
      const pending = this.navigation.takeFile();
      const id = this.route.snapshot.queryParamMap.get('document');
      if (pending) void this.openFile(pending);
      else if (id) void this.reopen(id);
    });
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  canLeave(): boolean {
    return !this.dirty() || window.confirm('There are unsaved PDF edits. Leave without saving?');
  }
  private async refreshLibrary(): Promise<void> {
    try {
      this.library.set(await listWorkspaces());
    } catch (e) {
      this.error.set(this.errorText(e));
    }
  }
  async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (file) await this.openFile(file);
  }
  async openFile(file: File): Promise<void> {
    if (this.busy() || !this.canLeave()) return;
    this.error.set('');
    this.busy.set('Opening PDF…');
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF smaller than 25 MB.');
      const pdf = await file.arrayBuffer();
      if (!new TextDecoder('latin1').decode(pdf.slice(0, 1024)).includes('%PDF-'))
        throw new Error('This file is not a PDF. Choose a .pdf document.');
      const sha256 = await hashPdf(pdf);
      const doc: PdfWorkspace = {
        version: 1,
        id: crypto.randomUUID(),
        name: file.name,
        pdf,
        sha256,
        page: 1,
        objects: [],
        pageCalibrations: {},
        updatedAt: Date.now(),
      };
      await this.open(doc);
      this.dirty.set(true);
      await this.save();
    } catch (e) {
      this.error.set(this.errorText(e));
    } finally {
      this.busy.set('');
    }
  }
  async reopen(id: string): Promise<void> {
    if (this.busy() || !this.canLeave()) return;
    this.error.set('');
    this.busy.set('Reopening local PDF…');
    try {
      const doc = await loadWorkspace(id);
      if (!doc)
        throw new Error('This document is not stored in this browser. Reopen the original PDF.');
      if ((await hashPdf(doc.pdf)) !== doc.sha256)
        throw new Error('The saved PDF failed its integrity check. Reopen the original file.');
      await this.open(doc);
      this.dirty.set(false);
    } catch (e) {
      this.error.set(this.errorText(e));
    } finally {
      this.busy.set('');
    }
  }
  async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file || this.busy() || !this.canLeave()) return;
    this.busy.set('Opening PDF project…');
    this.error.set('');
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('Choose a PDF project smaller than 32 MB.');
      await this.open(await readWorkspaceBackup(await file.arrayBuffer()));
      this.dirty.set(true);
      await this.save();
    } catch (e) {
      this.error.set(this.errorText(e));
    } finally {
      this.busy.set('');
    }
  }
  private async open(doc: PdfWorkspace): Promise<void> {
    this.inspection.set(null);
    this.pageCount.set(await this.reader.open(doc.pdf));
    if (doc.page > this.pageCount() || doc.objects.some((o) => o.page > this.pageCount()))
      throw new Error('The project refers to a page not present in its PDF.');
    this.doc.set(doc);
    this.history.set([]);
    this.future.set([]);
    this.selectedId.set('');
    this.selectedPath.set(null);
    this.points.set([]);
    this.layer.set('');
    this.tool.set('select');
    this.view.set('compare');
    this.message.set('');
    await this.readPage();
    const halls = this.halls();
    if (halls.length === 1) this.select(halls[0]);
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { document: doc.id, ...(this.embedded() ? { import: 'pdf' } : {}) },
      replaceUrl: true,
    });
  }
  private async readPage(): Promise<void> {
    const doc = this.doc();
    if (!doc) return;
    this.inspection.set(await this.reader.inspect(doc.page));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (this.disposed) return;
    this.resize?.disconnect();
    const viewport = this.viewport()?.nativeElement;
    if (viewport) {
      this.resize = new ResizeObserver(() => this.scheduleRender());
      this.resize.observe(viewport);
    }
    this.fit();
  }
  async changePage(value: string): Promise<void> {
    const doc = this.doc(),
      page = Number(value);
    if (!doc || this.busy() || page < 1 || page > this.pageCount()) return;
    this.busy.set('Inspecting page…');
    this.error.set('');
    this.selectedId.set('');
    this.selectedPath.set(null);
    this.points.set([]);
    this.layer.set('');
    this.doc.set({ ...doc, page });
    this.dirty.set(true);
    this.saveRevision++;
    try {
      await this.readPage();
    } catch (e) {
      this.inspection.set(null);
      this.error.set(this.errorText(e));
    } finally {
      this.busy.set('');
    }
  }
  scheduleRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render(), 60);
  }
  private async render(): Promise<void> {
    if (this.engine() === 'three') return;
    const viewport = this.viewport()?.nativeElement,
      canvas = this.canvas()?.nativeElement;
    if (!viewport || !canvas || this.disposed || this.view() === 'edited') return;
    canvas.style.left = `${viewport.scrollLeft}px`;
    canvas.style.top = `${viewport.scrollTop}px`;
    canvas.style.width = `${viewport.clientWidth}px`;
    canvas.style.height = `${viewport.clientHeight}px`;
    try {
      await this.reader.render(
        canvas,
        this.zoom(),
        viewport.scrollLeft,
        viewport.scrollTop,
        viewport.clientWidth,
        viewport.clientHeight,
      );
    } catch (e) {
      this.error.set(`PDF rendering failed: ${this.errorText(e)}`);
    }
  }
  fit(): void {
    if (this.engine() === 'three') {
      this.threeScene()?.fit();
      return;
    }
    const page = this.inspection(),
      el = this.viewport()?.nativeElement;
    if (!page || !el) return;
    this.zoom.set(
      Math.max(
        0.05,
        Math.min((el.clientWidth - 24) / page.width, (el.clientHeight - 24) / page.height, 2),
      ),
    );
    el.scrollTo(0, 0);
    this.scheduleRender();
  }
  setZoom(factor: number): void {
    if (this.engine() === 'three') {
      this.threeScene()?.zoom(factor);
      return;
    }
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) return;
    const old = this.zoom(),
      next = Math.max(0.05, Math.min(8, old * factor));
    const centre = {
      x: (viewport.scrollLeft + viewport.clientWidth / 2) / old,
      y: (viewport.scrollTop + viewport.clientHeight / 2) / old,
    };
    this.zoom.set(next);
    setTimeout(() => {
      viewport.scrollLeft = centre.x * next - viewport.clientWidth / 2;
      viewport.scrollTop = centre.y * next - viewport.clientHeight / 2;
      this.scheduleRender();
    }, 0);
  }
  setView(view: View): void {
    this.view.set(view);
    this.selectedPath.set(null);
    this.points.set([]);
    this.tool.set('select');
    this.scheduleRender();
  }
  setEngine(engine: 'three' | 'reference'): void {
    if (this.engine() === engine) return;
    this.resize?.disconnect();
    this.engine.set(engine);
    setTimeout(() => {
      if (this.disposed) return;
      const viewport = this.viewport()?.nativeElement;
      if (viewport) {
        this.resize = new ResizeObserver(() => this.scheduleRender());
        this.resize.observe(viewport);
      }
      this.fit();
    }, 0);
  }
  selectById(id: string): void {
    const object = this.objects().find((o) => o.id === id);
    if (object) this.select(object);
  }
  setTool(tool: Tool): void {
    this.tool.set(tool);
    this.points.set([]);
    this.selectedPath.set(null);
    this.error.set('');
    this.message.set('');
    if (this.view() === 'original') this.view.set('compare');
  }
  click(event: MouseEvent): void {
    if (this.busy() || this.view() === 'original') return;
    const svg = this.svg()?.nativeElement,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    this.pickPoint({ x: value.x, y: value.y });
  }
  pickPoint(point: PdfPoint, tolerance = 5 / this.zoom()): void {
    if (this.busy() || this.view() === 'original') return;
    const page = this.inspection();
    if (!page || point.x < 0 || point.y < 0 || point.x > page.width || point.y > page.height)
      return;
    if (this.tool() === 'trace') {
      if (this.points().length >= 500) {
        this.error.set('An outline can have up to 500 vertices.');
        return;
      }
      this.points.update((ps) => [...ps, point]);
      return;
    }
    if (this.tool() === 'calibrate' || this.tool() === 'measure') {
      this.points.update((ps) => (ps.length === 2 ? [point] : [...ps, point]));
      return;
    }
    const object = [...this.objects()].reverse().find((o) => contains(o.points, point));
    if (object) {
      this.select(object);
      return;
    }
    this.selectedId.set('');
    if (this.view() === 'edited') {
      this.selectedPath.set(null);
      return;
    }
    const candidates = page.paths.filter(
      (p) =>
        !p.hidden &&
        (!this.layer() || p.layer === this.layer()) &&
        point.x >= p.bounds.x - tolerance &&
        point.x <= p.bounds.x + p.bounds.width + tolerance &&
        point.y >= p.bounds.y - tolerance &&
        point.y <= p.bounds.y + p.bounds.height + tolerance,
    );
    // Prefer a genuinely enclosing closed path, then the nearest segment. Curves remain reference-only.
    const enclosing = candidates
      .filter(
        (p) => p.closed && !p.curved && !p.compound && !p.clipped && contains(p.points, point),
      )
      .sort((a, b) => area(a.points) - area(b.points));
    const nearest = candidates
      .map((p) => ({ path: p, distance: this.pathDistance(p, point) }))
      .filter((x) => x.distance <= tolerance)
      .sort((a, b) => a.distance - b.distance);
    this.selectedPath.set(enclosing[0] ?? nearest[0]?.path ?? null);
  }
  private pathDistance(path: SourcePath, p: PdfPoint): number {
    let nearest = Infinity;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
      nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return nearest;
  }
  select(object: PdfObject): void {
    this.selectedId.set(object.id);
    this.selectedPath.set(null);
    this.vertexText = object.points.map((p) => `${p.x}, ${p.y}`).join('\n');
    this.moveX = 0;
    this.moveY = 0;
  }
  private cleanClosingPoint(points: PdfPoint[]): PdfPoint[] {
    return points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-8
      ? points.slice(0, -1)
      : points;
  }
  private mutate(update: (doc: PdfWorkspace) => PdfWorkspace): void {
    const doc = this.doc();
    if (!doc) return;
    this.history.update((h) => [...h.slice(-29), doc]);
    this.future.set([]);
    this.doc.set({ ...update(doc), updatedAt: Date.now() });
    this.dirty.set(true);
    this.message.set('');
    this.saveRevision++;
  }
  private addObject(points: PdfPoint[], sourcePathId?: string): void {
    const error = polygonError(points);
    if (error) {
      this.error.set(error);
      return;
    }
    const doc = this.doc();
    if (!doc) return;
    const object: PdfObject = {
      id: crypto.randomUUID(),
      page: doc.page,
      name: `Outline ${doc.objects.length + 1}`,
      kind: 'unknown',
      sourcePoints: points.map((p) => ({ ...p })),
      points: points.map((p) => ({ ...p })),
      sourcePathId,
      reviewed: false,
      heightMetres: null,
    };
    this.mutate((d) => ({ ...d, objects: [...d.objects, object] }));
    this.select(object);
    this.tool.set('select');
    this.points.set([]);
    this.error.set('');
  }
  finishTrace(): void {
    this.addObject(this.points());
  }
  private parseCoordinates(text: string): PdfPoint[] {
    return text
      .trim()
      .split('\n')
      .map((line) => {
        const values = line
          .trim()
          .split(/[,\s]+/)
          .map(Number);
        return { x: values.length === 2 ? values[0] : NaN, y: values[1] };
      });
  }
  enterTrace(): void {
    this.addObject(this.parseCoordinates(this.traceText));
  }
  enterReference(): void {
    const points = this.parseCoordinates(this.referenceText),
      page = this.inspection();
    if (
      !page ||
      points.length !== 2 ||
      points.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x > page.width ||
          p.y > page.height,
      ) ||
      distance(points[0], points[1]) < 0.01
    ) {
      this.error.set('Enter two different points inside this page, one x, y pair per line.');
      return;
    }
    this.points.set(points);
    this.error.set('');
  }
  usePath(): void {
    const p = this.selectedPath();
    if (p && this.sourcePathConvertible()) this.addObject(this.cleanClosingPoint(p.points), p.id);
  }
  updateObject(patch: Partial<PdfObject>): void {
    const selected = this.selected();
    if (!selected) return;
    this.mutate((doc) => ({
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === selected.id
          ? { ...o, ...patch, reviewed: patch.reviewed ?? false }
          : patch.calibration && (o.regionId === selected.id || o.adjacentHallIds?.includes(selected.id))
            ? { ...o, reviewed: false }
            : o,
      ),
    }));
  }
  setKind(kind: string): void {
    if (!this.kinds.includes(kind as ObjectKind)) return;
    const selected = this.selected();
    if (!selected) return;
    this.mutate((doc) => ({
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === selected.id
          ? {
              ...o,
              kind: kind as ObjectKind,
              reviewed: false,
              regionId: kind === 'hall' ? undefined : o.regionId,
              adjacentHallIds: kind === 'foyer' ? o.adjacentHallIds : undefined,
            }
          : {
              ...o,
              regionId: o.regionId === selected.id && kind !== 'hall' ? undefined : o.regionId,
              legendId: o.legendId === selected.id && kind !== 'legend' ? undefined : o.legendId,
              adjacentHallIds: kind !== 'hall' ? o.adjacentHallIds?.filter(id => id !== selected.id) : o.adjacentHallIds,
              reviewed:
                (o.regionId === selected.id && kind !== 'hall') ||
                (o.adjacentHallIds?.includes(selected.id) && kind !== 'hall') ||
                (o.legendId === selected.id && kind !== 'legend')
                  ? false
                  : o.reviewed,
            },
      ),
    }));
  }
  setHeight(value: string): void {
    const height = value.trim() === '' ? null : Number(value);
    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      this.error.set('Height must be positive, or blank when unknown.');
      return;
    }
    this.updateObject({ heightMetres: height });
    this.error.set('');
  }
  applyVertices(): void {
    const points = this.vertexText
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line
          .trim()
          .split(/[,\s]+/)
          .map(Number);
        return { x: parts.length === 2 ? parts[0] : NaN, y: parts[1] };
      });
    const error = polygonError(points);
    if (error) {
      this.error.set(error);
      return;
    }
    this.updateObject({ points });
    this.error.set('');
  }
  move(): void {
    const selected = this.selected(),
      cal = this.activeCalibration();
    if (!selected || !cal) return;
    if (!Number.isFinite(this.moveX) || !Number.isFinite(this.moveY)) {
      this.error.set('Enter finite move distances.');
      return;
    }
    this.updateObject({
      points: selected.points.map((p) => ({
        x: p.x + this.moveX / cal.metresPerUnit,
        y: p.y + this.moveY / cal.metresPerUnit,
      })),
    });
    this.select(this.selected()!);
  }
  restore(): void {
    const o = this.selected();
    if (o) {
      this.updateObject({ points: o.sourcePoints.map((p) => ({ ...p })) });
      this.select(this.selected()!);
    }
  }
  remove(): void {
    const id = this.selectedId();
    if (!id) return;
    this.mutate((doc) => ({
      ...doc,
      objects: doc.objects
        .filter((o) => o.id !== id)
        .map((o) => ({
          ...o,
          regionId: o.regionId === id ? undefined : o.regionId,
          legendId: o.legendId === id ? undefined : o.legendId,
          adjacentHallIds: o.adjacentHallIds?.filter(h => h !== id),
          reviewed: o.regionId === id || o.legendId === id || o.adjacentHallIds?.includes(id) ? false : o.reviewed,
        })),
    }));
    this.selectedId.set('');
  }
  applyCalibration(scope: 'page' | 'hall'): void {
    if (this.points().length !== 2) return;
    try {
      const value = calibrate(this.points()[0], this.points()[1], Number(this.knownMetres));
      if (scope === 'hall') {
        if (this.selected()?.kind !== 'hall') return;
        this.updateObject({ calibration: value });
      } else
        this.mutate((doc) => ({
          ...doc,
          pageCalibrations: { ...doc.pageCalibrations, [doc.page]: value },
          objects: doc.objects.map((o) => (o.page === doc.page ? { ...o, reviewed: false } : o)),
        }));
      this.tool.set('select');
      this.points.set([]);
      this.error.set('');
      this.message.set(
        'Scale set. Check a different known dimension with Measure, then save your changes.',
      );
    } catch (e) {
      this.error.set(this.errorText(e));
    }
  }
  undo(): void {
    const h = this.history(),
      current = this.doc(),
      previous = h.at(-1);
    if (!current || !previous) return;
    this.future.update((f) => [...f, current]);
    this.history.set(h.slice(0, -1));
    this.doc.set({ ...previous, page: current.page });
    this.dirty.set(true);
    this.selectedId.set('');
    this.points.set([]);
    this.saveRevision++;
  }
  redo(): void {
    const f = this.future(),
      current = this.doc(),
      next = f.at(-1);
    if (!current || !next) return;
    this.history.update((h) => [...h, current]);
    this.future.set(f.slice(0, -1));
    this.doc.set({ ...next, page: current.page });
    this.dirty.set(true);
    this.selectedId.set('');
    this.saveRevision++;
  }
  async save(): Promise<void> {
    const doc = this.doc();
    if (!doc || this.saving()) return;
    const revision = this.saveRevision;
    this.saving.set(true);
    try {
      await saveWorkspace(doc);
      if (revision === this.saveRevision) {
        this.dirty.set(false);
        this.message.set(
          'Saved on this browser. Keep the original PDF and download a review report for your records.',
        );
      }
      await this.refreshLibrary();
    } catch (e) {
      this.error.set(this.errorText(e));
    } finally {
      this.saving.set(false);
    }
  }
  async openInPlanner(): Promise<void> {
    const doc = this.doc(),
      object = this.selected();
    if (!doc || !object || this.busy() || this.saving()) return;
    this.busy.set('Saving reviewed hall…');
    this.error.set('');
    try {
      const { hall, binding } = preparePdfHall(doc, object);
      // Keep the original before writing any planner geometry.
      await saveWorkspace(doc);
      this.dirty.set(false);
      const key = JSON.stringify([
        doc.id,
        object.id,
        binding.hallSignature,
        binding.page,
        binding.crop,
        binding.metresPerUnit,
      ]);
      const links = await listHallBindings();
      const prior = links.find(
        (link) =>
          link.documentId === doc.id &&
          link.objectId === object.id &&
          link.sha256 === doc.sha256 &&
          link.page === binding.page &&
          link.hallSignature === binding.hallSignature &&
          JSON.stringify(link.crop) === JSON.stringify(binding.crop) &&
          link.metresPerUnit === binding.metresPerUnit,
      );
      let saved = this.createdHalls.get(key);
      if (!saved && prior) {
        // A deleted hall must not leave a link that navigates to a different fallback hall.
        saved = (await this.api.listHalls()).find(
          (h) => String(h.id) === prior.hallId && hallSignature(h) === prior.hallSignature,
        );
      }
      if (!saved) {
        saved = await this.api.createHall(hall);
        this.createdHalls.set(key, saved);
      }
      if (hallSignature(saved) !== binding.hallSignature) {
        throw new Error(
          `The server changed the geometry of hall ${saved.id}. Its PDF was not aligned automatically; review the saved hall before continuing.`,
        );
      }
      await saveHallBinding({ ...binding, hallId: String(saved.id) });
      this.hallOpened.emit(saved);
      await this.router.navigate(['/planner/editor'], { queryParams: { hallId: saved.id } });
    } catch (e) {
      this.error.set(
        e instanceof HttpErrorResponse && e.status === 0
          ? 'The planner server is unavailable. Your PDF draft is saved locally. Use “Preview in main planner” to check the layout now.'
          : extractErrorMessage(e),
      );
    } finally {
      this.busy.set('');
    }
  }
  async previewInPlanner(): Promise<void> {
    const doc = this.doc(),
      object = this.selected();
    if (!doc || !object || this.busy() || this.saving()) return;
    this.busy.set('Opening local hall in planner…');
    this.error.set('');
    try {
      preparePdfHall(doc, object);
      await saveWorkspace(doc);
      this.dirty.set(false);
      await this.router.navigate(['/planner/editor'], {
        queryParams: { pdfDocument: doc.id, pdfObject: object.id },
      });
    } catch (e) {
      this.error.set(extractErrorMessage(e));
    } finally {
      this.busy.set('');
    }
  }
  async continueToPlanner(): Promise<void> {
    if (!this.doc() || this.busy() || this.saving()) return;
    this.error.set('');
    if (!this.selected() && this.halls().length === 1) this.select(this.halls()[0]);
    const object = this.selected();
    if (!object) {
      if (this.objects().length || this.selectedPath()) {
        this.message.set(
          'Choose the hall outline below. For a selected PDF path, click Create editable outline first.',
        );
        this.focusImportControl(
          this.selectedPath() ? '#pdf-use-source-path' : '.object-list button',
        );
      } else {
        this.setTool('trace');
        this.message.set(
          'First mark the hall boundary on the drawing, then click Finish outline. The planner needs a hall boundary and a known scale.',
        );
        this.focusImportControl('.drawing');
      }
      return;
    }
    if (object.kind !== 'hall') {
      this.message.set('Set Object type to hall for the boundary you want to open in the planner.');
      this.focusImportControl('#pdf-object-kind');
      return;
    }
    if (!calibrationFor(this.doc()!, object)) {
      this.setTool('calibrate');
      this.message.set(
        'Mark two reference points and enter their known distance in metres, then apply the scale.',
      );
      this.focusImportControl('.drawing');
      return;
    }
    if (!object.reviewed) {
      this.message.set(
        'Check the selected hall boundary and confirm “I reviewed this outline and its meaning” to continue.',
      );
      this.focusImportControl('#pdf-object-reviewed');
      return;
    }
    await this.previewInPlanner();
  }
  private focusImportControl(selector: string): void {
    setTimeout(() => {
      if (this.disposed) return;
      const control =
        selector === '.drawing' && this.surface()
          ? this.surface()!.renderer.domElement
          : document.querySelector('app-pdf-workspace')?.querySelector<HTMLElement>(selector);
      control?.scrollIntoView({ block: 'nearest' });
      control?.focus({ preventScroll: true });
    }, 0);
  }
  downloadReport(): void {
    const doc = this.doc();
    if (!doc) return;
    const report = {
      schema: 'pdf-review-v1',
      document: { name: doc.name, sha256: doc.sha256, pageCount: this.pageCount() },
      coordinateSpace:
        'PDF.js scale-1 viewport; page transform maps PDF user coordinates to this space',
      currentPage: this.inspection()
        ? {
            ...this.inspection(),
            pathCount: this.inspection()!.paths.length,
            paths: undefined,
            texts: this.inspection()!.texts,
          }
        : null,
      pageCalibrations: doc.pageCalibrations,
      objects: doc.objects.map((o) => ({
        ...o,
        metres: calibrationFor(doc, o) ? sourceToMetres(o.points, calibrationFor(doc, o)!) : null,
      })),
      unresolved: this.reviewItems(),
      limitations: [
        'Local browser draft; not saved to the planner backend.',
        'Report is not the original PDF.',
        'Object types and legend mappings require human review.',
        'Heights and real-world accuracy are not inferred.',
      ],
    };
    this.download(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      doc.name.replace(/\.pdf$/i, '') + '-review.json',
    );
  }
  downloadOriginal(): void {
    const doc = this.doc();
    if (doc) this.download(new Blob([doc.pdf], { type: 'application/pdf' }), doc.name);
  }
  downloadBackup(): void {
    const doc = this.doc();
    if (doc) this.download(workspaceBackup(doc), doc.name.replace(/\.pdf$/i, '') + '.pdfplan');
  }
  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  pointsAttribute(points: PdfPoint[]): string {
    return points.map((p) => `${p.x},${p.y}`).join(' ');
  }
  private errorText(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'The PDF could not be processed. Try reopening the original file.';
  }
}
