import {
  Calibration,
  ObjectKind,
  PdfObject,
  PdfPoint,
  PdfWorkspace,
  calibrate,
  polygonError,
} from './pdf-workspace.model';
import { hashPdf } from './pdf-workspace.storage';

const MAGIC = 'PDFPLAN1\n';
const KINDS: ObjectKind[] = ['unknown', 'hall', 'foyer', 'stall', 'wall', 'symbol', 'legend'];
/** A portable local project: length-prefixed JSON followed by the exact original PDF bytes. */
export function workspaceBackup(doc: PdfWorkspace): Blob {
  const { pdf, ...metadata } = doc;
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length);
  return new Blob([MAGIC, length, header, pdf], { type: 'application/octet-stream' });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid project data.');
  return value as Record<string, unknown>;
}
function point(value: unknown): PdfPoint {
  const p = record(value);
  if (
    typeof p['x'] !== 'number' ||
    typeof p['y'] !== 'number' ||
    !Number.isFinite(p['x']) ||
    !Number.isFinite(p['y'])
  )
    throw new Error('Invalid project coordinates.');
  return { x: p['x'], y: p['y'] };
}
function outline(value: unknown): PdfPoint[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid project outline.');
  const points = value.map(point),
    error = polygonError(points);
  if (error) throw new Error(error);
  return points;
}
function calibration(value: unknown): Calibration {
  const c = record(value);
  if (typeof c['metres'] !== 'number') throw new Error('Invalid calibration.');
  const checked = calibrate(point(c['a']), point(c['b']), c['metres']);
  if (
    typeof c['metresPerUnit'] !== 'number' ||
    Math.abs(checked.metresPerUnit - c['metresPerUnit']) >
      1e-10 * Math.max(1, checked.metresPerUnit)
  )
    throw new Error('Inconsistent calibration.');
  return checked;
}
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new Error('Invalid project name or identifier.');
  return value;
}
function page(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000)
    throw new Error('Invalid page number.');
  return value;
}
function hallConnections(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid foyer connections.');
  const ids = value.map(id => text(id));
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate foyer connections.');
  return ids;
}
export async function readWorkspaceBackup(bytes: ArrayBuffer): Promise<PdfWorkspace> {
  if (bytes.byteLength > 32 * 1024 * 1024 || bytes.byteLength < MAGIC.length + 4)
    throw new Error('Invalid or oversized PDF project.');
  const prefix = new TextDecoder().decode(bytes.slice(0, MAGIC.length));
  if (prefix !== MAGIC)
    throw new Error('This is not a PDF workspace backup. Choose a .pdfplan file.');
  const size = new DataView(bytes).getUint32(MAGIC.length),
    start = MAGIC.length + 4;
  if (size > 4 * 1024 * 1024 || start + size >= bytes.byteLength)
    throw new Error('Invalid project header.');
  const data = record(JSON.parse(new TextDecoder().decode(bytes.slice(start, start + size))));
  if (data['version'] !== 1) throw new Error('This project version is not supported.');
  const pdf = bytes.slice(start + size);
  if (
    pdf.byteLength > 25 * 1024 * 1024 ||
    !new TextDecoder('latin1').decode(pdf.slice(0, 1024)).includes('%PDF-')
  )
    throw new Error('The backup does not contain a supported PDF.');
  const sha256 = await hashPdf(pdf);
  if (sha256 !== data['sha256'])
    throw new Error('PDF integrity check failed. Re-export the backup from the original browser.');
  if (!Array.isArray(data['objects']) || data['objects'].length > 10000)
    throw new Error('Invalid project object list.');
  const objects: PdfObject[] = data['objects'].map((value) => {
    const o = record(value),
      kind = o['kind'] as ObjectKind,
      height = o['heightMetres'];
    if (
      !KINDS.includes(kind) ||
      typeof o['reviewed'] !== 'boolean' ||
      (height !== null && (typeof height !== 'number' || !Number.isFinite(height) || height <= 0))
    )
      throw new Error('Invalid object properties.');
    return {
      id: text(o['id']),
      name: text(o['name']),
      page: page(o['page']),
      kind,
      points: outline(o['points']),
      sourcePoints: outline(o['sourcePoints']),
      heightMetres: height as number | null,
      reviewed: o['reviewed'],
      ...(o['regionId'] ? { regionId: text(o['regionId']) } : {}),
      ...(o['adjacentHallIds'] !== undefined ? { adjacentHallIds: hallConnections(o['adjacentHallIds']) } : {}),
      ...(o['legendId'] ? { legendId: text(o['legendId']) } : {}),
      ...(o['sourcePathId'] ? { sourcePathId: text(o['sourcePathId']) } : {}),
      ...(o['calibration'] ? { calibration: calibration(o['calibration']) } : {}),
    };
  });
  if (new Set(objects.map((o) => o.id)).size !== objects.length)
    throw new Error('Duplicate project object IDs.');
  for (const o of objects) {
    if (o.adjacentHallIds && (o.kind !== 'foyer' || o.adjacentHallIds.some(id =>
      !objects.some(h => h.id === id && h.kind === 'hall' && h.page === o.page))))
      throw new Error('A foyer has an invalid hall connection.');
    if (
      o.regionId &&
      !objects.some(
        (h) => h.id === o.regionId && h.kind === 'hall' && h.page === o.page && h.id !== o.id,
      )
    )
      throw new Error('An object has an invalid hall association.');
    if (
      o.legendId &&
      !objects.some((l) => l.id === o.legendId && l.kind === 'legend' && l.page === o.page)
    )
      throw new Error('An object has an invalid legend association.');
  }
  const pageCalibrations: Record<number, Calibration> = {};
  for (const [key, value] of Object.entries(record(data['pageCalibrations'])))
    pageCalibrations[page(Number(key))] = calibration(value);
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: text(data['name']),
    pdf,
    sha256,
    page: page(data['page']),
    objects,
    pageCalibrations,
    updatedAt: Date.now(),
  };
}
