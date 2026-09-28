/**
 * Renders page 1 of the uploaded plan to an image in the browser, for the review underlay.
 *
 * pdf.js is loaded on demand (its own chunk), so the planner does not pay for it until a plan is
 * imported. Evaluation of PDF-embedded code stays off (`isEvalSupported: false`), and the file
 * never leaves the browser for this: only the extraction request sends it to the backend.
 */
export interface PageImage {
  /** Object URL of a PNG; revoke with `URL.revokeObjectURL` when done. */
  url: string;
  /** Page size in points, as displayed (rotation applied): the coordinate space of the import. */
  width: number;
  height: number;
}

/** Enough pixels to read stall letters when zoomed in, without exhausting a phone. */
const MAX_PIXELS = 16e6;

export async function renderPdfPage(data: ArrayBuffer, pageNumber = 1): Promise<PageImage> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(6, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the plan preview.');
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not draw the plan preview.'))), 'image/png'),
    );
    canvas.width = canvas.height = 0;
    return { url: URL.createObjectURL(blob), width: base.width, height: base.height };
  } finally {
    await doc.destroy();
  }
}
