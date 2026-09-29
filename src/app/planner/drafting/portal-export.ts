import type { Rect } from '../geometry/placement-rules';
import type { Stall } from '../models/stall.model';

/**
 * Export for the Fabric.js booking portal (ITPO SelfCare `hall-layout`), so the published drawing
 * replaces the hand redraw there.
 *
 * The portal's model: the hall is `length` x `breadth` metres of 1 m cells, drawn at
 * `metersToPixels` px per metre from the top-left corner, Y down. A stall is the list of its cells
 * (`stallCoords`, top-left pixel of each cell) plus its outline as one segment per cell edge
 * (`borderCoords`), dashed where the side is open to the aisle. `area` is `"<cells>sqm"`.
 *
 * Only what the portal can show is exported: unrotated rectangles on whole metres. Anything else
 * is listed in `skipped` with the reason, never approximated.
 */

export interface PortalBorder {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isDashed: boolean;
}

export interface PortalStall {
  id: string;
  area: string;
  stallCoords: Array<{ x: number; y: number }>;
  borderCoords: PortalBorder[];
  /** Not read by the portal; kept so the two systems can be matched. */
  name: string;
  stallNumber: string | null;
}

export interface PortalExport {
  name: string;
  length: number;
  breadth: number;
  metersToPixels: number;
  layout_data: { shape: 'non-circular'; stallWidth: 1; stallHeight: 1 };
  default_stalls: PortalStall[];
  skipped: Array<{ name: string; reason: string }>;
}

const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;

export function portalExport(
  hallName: string,
  plan: Rect,
  stalls: readonly Stall[],
  metersToPixels = 10
): PortalExport {
  const px = (m: number) => Math.round(m * metersToPixels * 1000) / 1000;
  const out: PortalExport = {
    name: hallName,
    length: Math.round(plan.maxX - plan.minX),
    breadth: Math.round(plan.maxZ - plan.minZ),
    metersToPixels,
    layout_data: { shape: 'non-circular', stallWidth: 1, stallHeight: 1 },
    default_stalls: [],
    skipped: []
  };

  for (const s of stalls) {
    if (s.status === 'CANCELLED') continue;
    const label = s.stallNumber ?? s.name;
    if (s.footprint && s.footprint.length >= 3) {
      out.skipped.push({ name: label, reason: 'custom shape' });
      continue;
    }
    if (((s.rotation ?? 0) % 360 + 360) % 360 > 1e-6) {
      out.skipped.push({ name: label, reason: `rotated ${Math.round(s.rotation ?? 0)}°` });
      continue;
    }
    const x0 = s.posX - s.width / 2 - plan.minX;
    const z0 = s.posZ - s.length / 2 - plan.minZ;
    if (![x0, z0, s.width, s.length].every(whole)) {
      out.skipped.push({ name: label, reason: 'not on the 1 m grid' });
      continue;
    }
    const cx = Math.round(x0), cz = Math.round(z0), w = Math.round(s.width), l = Math.round(s.length);
    const open = new Set(s.openSides);
    const cells: Array<{ x: number; y: number }> = [];
    const borders: PortalBorder[] = [];
    for (let j = 0; j < l; j++) {
      for (let i = 0; i < w; i++) cells.push({ x: px(cx + i), y: px(cz + j) });
    }
    // Clockwise from the top-left corner, one segment per cell edge, as the portal draws them.
    for (let i = 0; i < w; i++) borders.push({ x1: px(cx + i), y1: px(cz), x2: px(cx + i + 1), y2: px(cz), isDashed: open.has('BACK') });
    for (let j = 0; j < l; j++) borders.push({ x1: px(cx + w), y1: px(cz + j), x2: px(cx + w), y2: px(cz + j + 1), isDashed: open.has('RIGHT') });
    for (let i = 0; i < w; i++) borders.push({ x1: px(cx + i), y1: px(cz + l), x2: px(cx + i + 1), y2: px(cz + l), isDashed: open.has('FRONT') });
    for (let j = 0; j < l; j++) borders.push({ x1: px(cx), y1: px(cz + j), x2: px(cx), y2: px(cz + j + 1), isDashed: open.has('LEFT') });

    out.default_stalls.push({
      id: String(s.stallNumber ?? s.id),
      area: `${cells.length}sqm`,
      stallCoords: cells,
      borderCoords: borders,
      name: s.name,
      stallNumber: s.stallNumber
    });
  }
  return out;
}
