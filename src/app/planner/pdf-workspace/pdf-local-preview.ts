import { isDevMode } from '@angular/core';
import { readWorkspaceBackup } from './pdf-workspace.backup';
import { preparePdfHall, preparePdfFloorPlan, type PdfFloorPlan } from './pdf-hall-plan';
import { hashPdf, loadWorkspace, saveHallBinding, saveWorkspace } from './pdf-workspace.storage';
import type { PdfObject } from './pdf-workspace.model';

/** Development-only preview packages stay on this machine, outside application assets. */
export async function loadLocalPdfPreview(key: string) {
  if (!isDevMode() || !['localhost', '127.0.0.1'].includes(location.hostname) ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) {
    throw new Error('Prepared PDF previews are available only on the local development server.');
  }
  const response = await fetch(`http://127.0.0.1:4322/${key}.pdfplan`, {
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('The local PDF preview is unavailable. Start its preview server and retry.');
  if (Number(response.headers.get('content-length')) > 32 * 1024 * 1024)
    throw new Error('The local PDF preview is too large.');
  const bytes = await response.arrayBuffer();
  const imported = await readWorkspaceBackup(bytes);
  imported.id = `preview-${await hashPdf(bytes)}`;
  const existing = await loadWorkspace(imported.id);
  const doc = existing ?? imported;
  if (await hashPdf(doc.pdf) !== doc.sha256) throw new Error('The local PDF failed its integrity check.');
  const objects = doc.objects.filter(o => o.kind === 'hall');
  if (!objects.length || objects.length > 30) throw new Error('A preview needs between 1 and 30 reviewed halls.');
  if (objects.some(o => o.page !== objects[0].page)) throw new Error('The combined preview requires halls from one page.');
  const prepared = objects.map(o => preparePdfHall(doc, o));
  const scale = prepared[0].binding.metresPerUnit;
  if (prepared.some(p => Math.abs(p.binding.metresPerUnit / scale - 1) > 1e-8))
    throw new Error('Halls with different scales cannot share one overview.');
  const foyers = doc.objects.filter(o => o.kind === 'foyer');
  if (foyers.some(f => f.page !== objects[0].page))
    throw new Error('The combined preview requires foyers and halls from one page.');
  const floorObjects = [...objects, ...foyers];
  const xs = floorObjects.flatMap(o => o.points.map(p => p.x));
  const ys = floorObjects.flatMap(o => o.points.map(p => p.y));
  const x = Math.max(0, Math.min(...xs) - 60), y = Math.max(0, Math.min(...ys) - 20);
  const right = Math.max(...xs) + 60, bottom = Math.max(...ys) + 100;
  // A viewing window only: never expose this rectangle as an editable exhibition hall.
  const overview: PdfObject = {
    ...objects[0], id: 'overview', name: 'All imported halls · overview',
    points: [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }],
    sourcePoints: [], heightMetres: null,
  };
  const frame = preparePdfHall(doc, overview);
  const floorPlans: Record<string, PdfFloorPlan> = {};
  for (const [index, entry] of [...prepared, frame].entries()) {
    const object = index < objects.length ? objects[index] : overview;
    entry.hall.id = `pdf-local-${doc.id}-${object.id}`;
    floorPlans[String(entry.hall.id)] = preparePdfFloorPlan(doc,
      { ...entry.binding, hallId: String(entry.hall.id) }, object === overview);
  }
  // Finish validation before persisting any of this preview's hall mappings.
  await saveWorkspace(doc);
  for (const entry of [...prepared, frame])
    await saveHallBinding({ ...entry.binding, hallId: String(entry.hall.id) });
  return { documentId: doc.id, halls: prepared.map(p => p.hall), overview: frame.hall, floorPlans };
}
