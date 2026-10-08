import type { Hall } from '../models/hall.model';
import type { Point } from '../geometry/placement-rules';
import {
  calibrationFor,
  polygonError,
  type PdfObject,
  type PdfWorkspace,
} from './pdf-workspace.model';

/** Snapshot of the coordinate mapping at import. Later source edits must not move a saved hall. */
export interface PdfHallBinding {
  hallId: string;
  hallSignature: string;
  documentId: string;
  sha256: string;
  objectId: string;
  page: number;
  crop: { x: number; y: number; width: number; height: number };
  metresPerUnit: number;
}

export interface PdfPlanTexture {
  canvas: HTMLCanvasElement | null;
  hallId: string;
  width: number;
  length: number;
  centre?: Point;
}

/** Reviewed floor context in the active hall's coordinates, never extra placement space. */
export interface PdfFloorPlan {
  hallId: string;
  regions: Array<{ id: string; name: string; kind: 'hall' | 'foyer'; boundary: Point[] }>;
}

export function preparePdfFloorPlan(doc: PdfWorkspace, binding: PdfHallBinding, overview = false): PdfFloorPlan {
  const halls = doc.objects.filter(o => o.kind === 'hall' && o.page === binding.page);
  const foyers = doc.objects.filter(o => o.kind === 'foyer' && o.page === binding.page);
  for (const foyer of foyers) {
    const k = calibrationFor(doc, foyer)?.metresPerUnit;
    if (!foyer.reviewed || polygonError(foyer.points) || !k || Math.abs(k / binding.metresPerUnit - 1) > 1e-8)
      throw new Error('Review each foyer outline and its scale before displaying a combined floor.');
    const connections = foyer.adjacentHallIds?.length ? foyer.adjacentHallIds : foyer.regionId ? [foyer.regionId] : [];
    if (!connections.length || connections.some(id => !halls.some(h => h.id === id)))
      throw new Error('Associate each foyer with its adjoining hall before previewing it.');
  }
  const objects = overview ? [...halls, ...foyers] : [
    ...halls.filter(h => h.id === binding.objectId),
    ...foyers.filter(f => f.regionId === binding.objectId || f.adjacentHallIds?.includes(binding.objectId)),
  ];
  const crop = binding.crop;
  return {
    hallId: binding.hallId,
    regions: objects.map(o => ({
      id: o.id, name: o.name, kind: o.kind as 'hall' | 'foyer',
      boundary: o.points.map(p => ({
        x: (p.x - crop.x - crop.width / 2) * binding.metresPerUnit,
        z: (p.y - crop.y - crop.height / 2) * binding.metresPerUnit,
      })),
    })),
  };
}

/** Expand the source crop for neighbouring foyers without changing the hall's origin. */
export function pdfReferenceCrop(binding: PdfHallBinding, plan: PdfFloorPlan | null) {
  let crop = binding.crop;
  const centre = { x: 0, z: 0 };
  if (plan?.hallId === binding.hallId && plan.regions.length) {
    const points = plan.regions.flatMap(r => r.boundary);
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    const k = binding.metresPerUnit;
    centre.x = (minX + maxX) / 2; centre.z = (minZ + maxZ) / 2;
    crop = { x: crop.x + crop.width / 2 + minX / k, y: crop.y + crop.height / 2 + minZ / k,
      width: (maxX-minX)/k, height: (maxZ-minZ)/k };
  }
  return { crop, centre };
}

export function hallSignature(hall: Hall): string {
  // API JSON round trips preserve doubles; this signature also works for saved layout copies.
  return JSON.stringify([hall.name, hall.width, hall.length, hall.boundary]);
}

export function preparePdfHall(
  doc: PdfWorkspace,
  object: PdfObject,
): {
  hall: Hall;
  binding: PdfHallBinding;
} {
  if (object.kind !== 'hall') throw new Error('Select an outline and set its object type to hall.');
  if (!object.reviewed) throw new Error('Review the hall outline and confirm its meaning first.');
  if (!object.name.trim()) throw new Error('Give the hall a name.');
  const problem = polygonError(object.points);
  if (problem) throw new Error(problem);
  const calibration = calibrationFor(doc, object);
  const k = calibration?.metresPerUnit;
  if (!k || !Number.isFinite(k) || k <= 0)
    throw new Error('Calibrate this hall using a known distance first.');
  const xs = object.points.map((p) => p.x),
    ys = object.points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  const width = Math.max(...xs) - x,
    height = Math.max(...ys) - y;
  const hall: Hall = {
    id: 'pdf-import',
    name: object.name.trim(),
    shape: 'SQUARE',
    radius: 0,
    width: width * k,
    length: height * k,
    boundary: object.points.map((p) => ({
      x: (p.x - x - width / 2) * k,
      z: (p.y - y - height / 2) * k,
    })),
    // Enables the existing polygon containment checks. No architectural height is inferred.
    rules: {},
  };
  if (
    ![hall.width, hall.length, ...hall.boundary!.flatMap((p) => [p.x, p.z])].every(Number.isFinite)
  ) {
    throw new Error('The calibrated dimensions are too large. Check the scale.');
  }
  return {
    hall,
    binding: {
      hallId: '',
      hallSignature: hallSignature(hall),
      documentId: doc.id,
      sha256: doc.sha256,
      objectId: object.id,
      page: object.page,
      crop: { x, y, width, height },
      metresPerUnit: k,
    },
  };
}
