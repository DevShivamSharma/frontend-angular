import { BlockedArea, Hall } from '../models/hall.model';
import {
  FloorRegion,
  Footprint,
  footprintRect,
  HallZone,
  Point,
  polygonBounds,
  Rect,
  rectInsidePolygon,
  rectOverlapsPolygon,
  traceFloor,
} from './placement-rules';
import { num, overlapsBlockedArea, withinHall } from './planner-geometry';

/**
 * The hall as its source plan draws it: every floor region, and the canvas that holds it.
 *
 * One place derives this from the hall's rectangles, and the renderer, the grid, the camera and
 * validation all read it — so what is drawn as floor is exactly where a stall may stand.
 */

/** The `length x breadth` canvas the plan's coordinates were converted against. */
export function planSize(hall: Hall): { width: number; length: number } {
  const width = num(hall.width, 0);
  const length = num(hall.length, 0);
  if (width > 0 && length > 0) return { width, length };
  const d = num(hall.radius, 20) * 2;
  return { width: d, length: d };
}

const floorCache = new WeakMap<Hall, FloorRegion[]>();

/**
 * The floor regions traced from the hall's source rectangles (see `traceFloor`), largest first.
 * Empty when the hall has no outside/wall rectangle: it is then its plain rectangle or circle.
 */
export function hallFloor(hall: Hall | null | undefined): FloorRegion[] {
  if (!hall) return [];
  const cached = floorCache.get(hall);
  if (cached) return cached;

  const { width, length } = planSize(hall);
  const floor = traceFloor(hall.blockedAreas ?? [], width, length);
  floorCache.set(hall, floor);
  return floor;
}

/**
 * Every outline the planner should treat as hall floor, outer rings only: the traced regions,
 * else the stored boundary polygon, else nothing (plain rectangle / circle).
 */
export function floorOutlines(hall: Hall | null | undefined): Point[][] {
  const floor = hallFloor(hall);
  if (floor.length) return floor.map((r) => r.outer);
  return hall?.boundary && hall.boundary.length >= 3 ? [hall.boundary] : [];
}

/**
 * Bounds of everything that belongs to the plan's geometry: the canvas, the floor, every wall and
 * coloured rectangle. Labels and icons are left out; `annotationBounds` adds them for framing.
 */
export function planBounds(hall: Hall): Rect {
  const { width, length } = planSize(hall);
  const r: Rect = { minX: -width / 2, maxX: width / 2, minZ: -length / 2, maxZ: length / 2 };
  const grow = (b: Rect): void => {
    r.minX = Math.min(r.minX, b.minX);
    r.maxX = Math.max(r.maxX, b.maxX);
    r.minZ = Math.min(r.minZ, b.minZ);
    r.maxZ = Math.max(r.maxZ, b.maxZ);
  };
  for (const outline of floorOutlines(hall)) grow(polygonBounds(outline));
  for (const area of hall.blockedAreas ?? []) {
    if (area.kind === 'outside' || !validArea(area)) continue;
    grow(areaRect(area));
  }
  return r;
}

/**
 * The legacy (non rule-driven) placement check, for halls traced from a plan: the stall must lie
 * wholly inside one floor region and clear of its holes. `null` when the hall has no traced floor,
 * so the caller falls back to the plain rectangle / circle test.
 */
export function insideHallFloor(
  hall: Hall | null | undefined,
  footprint: Footprint,
): boolean | null {
  const floor = hallFloor(hall);
  if (!floor.length) return null;
  const rect = footprintRect(footprint);
  return floor.some(
    (region) =>
      rectInsidePolygon(rect, region.outer) &&
      !region.holes.some((hole) => rectOverlapsPolygon(rect, hole)),
  );
}

/**
 * Legacy "is the stall inside the hall": the traced floor when the hall has one, else the plain
 * rectangle / circle test ported from React.
 */
export function withinPlan(
  hall: Hall | null | undefined,
  footprint: Footprint,
  x = footprint.posX,
  z = footprint.posZ,
): boolean {
  const inside = insideHallFloor(hall, { ...footprint, posX: num(x, 0), posZ: num(z, 0) });
  return inside ?? withinHall(hall, footprint, x, z);
}

/**
 * Legacy "does the stall sit on something it may not": an outside mask or wall, or a restricted
 * zone of the plan (compulsory passage, no-construction area, fire curtain — hidden ones too).
 */
export function blockedInPlan(hall: Hall | null | undefined, footprint: Footprint): boolean {
  return (
    overlapsBlockedArea(footprint, hall?.blockedAreas) ||
    overlappedZone(footprint, hall?.zones) !== null
  );
}

/** A restricted zone the footprint overlaps (touching allowed), or null. Hidden zones count. */
export function overlappedZone(
  footprint: Footprint,
  zones: readonly HallZone[] | null | undefined,
): HallZone | null {
  const rect = footprintRect(footprint);
  return (
    (zones ?? []).find((z) => z.polygon?.length >= 3 && rectOverlapsPolygon(rect, z.polygon)) ??
    null
  );
}

export function areaRect(area: BlockedArea): Rect {
  return {
    minX: area.posX - area.width / 2,
    maxX: area.posX + area.width / 2,
    minZ: area.posZ - area.length / 2,
    maxZ: area.posZ + area.length / 2,
  };
}

function validArea(area: BlockedArea): boolean {
  return (
    [area.posX, area.posZ, area.width, area.length].every(Number.isFinite) &&
    area.width > 0 &&
    area.length > 0
  );
}
