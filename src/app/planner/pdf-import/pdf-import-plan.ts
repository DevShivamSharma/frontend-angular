import type { EventType, Hall } from '../models/hall.model';
import type { GateSide, Stall } from '../models/stall.model';
import { planBounds } from '../geometry/hall-plan';
import { placementContextFor, toPlacementStall } from '../geometry/hall-rules';
import { pointInPolygon, validatePlacement, type Point, type Rect, type Violation } from '../geometry/placement-rules';
import { normalizeStall } from '../geometry/planner-geometry';
import { normalizeFootprint, sidesOfEdges } from '../geometry/stall-footprint';
import type { PdfGroup, PdfImportResult, PdfStall } from './pdf-import.model';

/**
 * From reviewed PDF stalls to planner stalls: which halls of the drawing go into which planner
 * hall, where (alignment), and as what. Pure functions, so the review dialog, the store and the
 * tests share them.
 *
 * Coordinates: the backend gives each drawing hall ("group") in its own grid metres. One page
 * has one scale, so the groups keep their relative positions in a common FRAME (the first
 * selected group's grid). A planner hall then receives them turned by a quarter-turn multiple
 * and shifted per group, in 0.5 m steps so half-metre stalls stay on the grid.
 */

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Alignment {
  rotation: QuarterTurn;
  /** Shift of each group, hall metres. */
  offsets: Record<string, Point>;
}

/** The drawing halls whose number appears in the planner hall's name ("Hall 8-9-10" -> 8, 9, 10). */
export function matchGroups(hallName: string, groups: ReadonlyArray<PdfGroup>): string[] {
  // "Hall 12A" is hall 12A, not 12; a trailing G or F is the floor ("Hall 5G" is hall 5).
  const numbers = new Set(
    [...hallName.toUpperCase().matchAll(/(\d+)([A-Z]?)(?![A-Z])/g)].map(m => String(Number(m[1])) + (/[GF]/.test(m[2]) ? '' : m[2]))
  );
  return groups.map(g => g.group).filter(g => numbers.has(g));
}

/**
 * The planner hall an import goes into by default: the hall whose name carries the most of the
 * drawing's hall numbers, so a Hall 8-11 drawing lands in "Hall 8-9-10" even while another hall
 * is selected. On a tie the selected hall wins; when no hall matches, the selected hall is kept.
 */
export function defaultTarget(
  halls: ReadonlyArray<Hall>,
  current: Hall | null,
  groups: ReadonlyArray<PdfGroup>,
): Hall | null {
  const score = (h: Hall) => matchGroups(h.name, groups).length;
  let best = current;
  for (const h of halls) if (score(h) > (best ? score(best) : 0)) best = h;
  return best;
}

export const round05 = (v: number): number => Math.round(v * 2) / 2;

/** Each group's grid origin in the frame of `groups[0]`, metres, on the half-metre grid. */
export function frameOffsets(result: PdfImportResult, groups: ReadonlyArray<string>): Record<string, Point> {
  const cal = new Map(result.groups.map(g => [g.group, g]));
  const ref = cal.get(groups[0]);
  const out: Record<string, Point> = {};
  for (const g of groups) {
    const c = cal.get(g);
    out[g] = ref && c
      ? { x: round05((c.originX - ref.originX) / ref.pitchX), z: round05((c.originY - ref.originY) / ref.pitchY) }
      : { x: 0, z: 0 };
  }
  return out;
}

/** A quarter turn clockwise on the plan (x right, z down) is (x, z) -> (-z, x). */
export function turn(p: Point, rotation: QuarterTurn): Point {
  switch (rotation) {
    case 90: return { x: -p.z, z: p.x };
    case 180: return { x: -p.x, z: -p.z };
    case 270: return { x: p.z, z: -p.x };
    default: return { x: p.x, z: p.z };
  }
}

/** A stall's outline in hall metres under an alignment. */
export function placeOutline(stall: PdfStall, alignment: Alignment): Point[] {
  const o = alignment.offsets[stall.group] ?? { x: 0, z: 0 };
  return stall.outline.map(p => {
    const t = turn(p, alignment.rotation);
    return { x: clean(t.x + o.x), z: clean(t.z + o.z) };
  });
}

/**
 * The alignment that keeps the drawing's layout (frame offsets) and centres the selection on the
 * hall. The starting point before auto-fit, and what "reset" returns to.
 */
export function centredAlignment(
  result: PdfImportResult,
  groups: ReadonlyArray<string>,
  hall: Hall,
  rotation: QuarterTurn = 0,
): Alignment {
  const frame = frameOffsets(result, groups);
  const turned = Object.fromEntries(groups.map(g => [g, turn(frame[g], rotation)]));
  const pts = result.stalls
    .filter(s => groups.includes(s.group))
    .flatMap(s => s.outline.map(p => {
      const t = turn(p, rotation);
      return { x: t.x + turned[s.group].x, z: t.z + turned[s.group].z };
    }));
  const hb = planBounds(hall);
  if (!pts.length) return { rotation, offsets: turned };
  const sb = bounds(pts);
  const dx = round05((hb.minX + hb.maxX) / 2 - (sb.minX + sb.maxX) / 2);
  const dz = round05((hb.minZ + hb.maxZ) / 2 - (sb.minZ + sb.maxZ) / 2);
  return {
    rotation,
    offsets: Object.fromEntries(groups.map(g => [g, { x: turned[g].x + dx, z: turned[g].z + dz }])),
  };
}

// --- auto-fit ------------------------------------------------------------------------------------

const CELL = 0.5;

/** The hall's usable floor on a 0.5 m raster: floor regions minus walls, masks and holes. */
export class FloorMask {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: Uint8Array;

  constructor(readonly box: Rect, inside: (p: Point) => boolean) {
    this.cols = Math.max(1, Math.ceil((box.maxX - box.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((box.maxZ - box.minZ) / CELL));
    this.cells = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = { x: box.minX + (c + 0.5) * CELL, z: box.minZ + (r + 0.5) * CELL };
        this.cells[r * this.cols + c] = inside(p) ? 1 : 0;
      }
    }
  }

  static forHall(hall: Hall): FloorMask {
    const ctx = placementContextFor(hall, [], 'B2B');
    const rings = [...(ctx.boundary ? [ctx.boundary] : []), ...(ctx.regions ?? [])];
    const obstacles = ctx.obstacles ?? [];
    const radius = ctx.circleRadius;
    return new FloorMask(planBounds(hall), p =>
      (radius != null ? Math.hypot(p.x, p.z) <= radius : rings.some(r => pointInPolygon(p, r))) &&
      !obstacles.some(o => pointInPolygon(p, o)),
    );
  }

  free(p: Point): boolean {
    const c = Math.floor((p.x - this.box.minX) / CELL);
    const r = Math.floor((p.z - this.box.minZ) / CELL);
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.cells[r * this.cols + c] === 1;
  }

  /** Marks the cells under an outline as taken (so the next group avoids them). */
  occupy(outline: Point[]): void {
    for (const p of cellCentres(outline)) {
      const c = Math.floor((p.x - this.box.minX) / CELL);
      const r = Math.floor((p.z - this.box.minZ) / CELL);
      if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.cells[r * this.cols + c] = 0;
    }
  }
}

/** Centres of the 0.5 m cells inside an outline (outlines are on the half-metre grid). */
export function cellCentres(outline: Point[]): Point[] {
  const b = bounds(outline);
  const out: Point[] = [];
  for (let x = Math.floor(b.minX / CELL) * CELL + CELL / 2; x < b.maxX; x += CELL) {
    for (let z = Math.floor(b.minZ / CELL) * CELL + CELL / 2; z < b.maxZ; z += CELL) {
      if (pointInPolygon({ x, z }, outline)) out.push({ x, z });
    }
  }
  return out;
}

/**
 * Each corner moved half a metre inwards: a cheap "is this stall on the floor" probe. Half a
 * metre, so a stall the 1 m coarse search leaves half a metre into a wall still counts there and
 * the half-metre fine search can then place it flush (halls whose walls sit on half metres).
 */
function probes(outline: Point[]): Point[] {
  const n = outline.length;
  const inward = (a: Point, b: Point): Point => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
  };
  return outline.map((v, i) => {
    const a = inward(outline[(i - 1 + n) % n], v);
    const b = inward(v, outline[(i + 1) % n]);
    return { x: v.x + CELL * (a.x + b.x), z: v.z + CELL * (a.z + b.z) };
  });
}

export interface FitResult {
  alignment: Alignment;
  /** Stalls wholly on free floor under it, per group. */
  onFloor: Record<string, number>;
  total: number;
}

/**
 * Searches, for each quarter turn, the shift of every group (largest first) that puts the most of
 * its stalls wholly on the free floor, the groups not overlapping each other. Ties keep the
 * drawing's own layout (closest to `centredAlignment`). A best effort: the review shows the
 * result over the PDF and the hall, and every shift can be nudged.
 */
export function autoFit(
  result: PdfImportResult,
  groups: ReadonlyArray<string>,
  hall: Hall,
  rotations: ReadonlyArray<QuarterTurn> = [0, 90, 180, 270],
): FitResult {
  let best: FitResult | null = null;
  for (const rotation of rotations) {
    const start = centredAlignment(result, groups, hall, rotation);
    const mask = FloorMask.forHall(hall);
    const order = [...groups].sort((a, b) => count(result, b) - count(result, a));
    const offsets: Record<string, Point> = { ...start.offsets };
    const onFloor: Record<string, number> = {};
    for (const g of order) {
      const stalls = result.stalls.filter(s => s.group === g);
      if (!stalls.length) {
        onFloor[g] = 0;
        continue;
      }
      const shapes = stalls.map(s => s.outline.map(p => turn(p, rotation)));
      const found = searchShift(shapes, mask, start.offsets[g]);
      offsets[g] = found.shift;
      onFloor[g] = found.score;
      for (const outline of shapes) {
        const placed = outline.map(p => ({ x: p.x + found.shift.x, z: p.z + found.shift.z }));
        if (cellCentres(placed).every(p => mask.free(p))) mask.occupy(placed);
      }
    }
    const total = Object.values(onFloor).reduce((s, v) => s + v, 0);
    if (!best || total > best.total) best = { alignment: { rotation, offsets }, onFloor, total };
  }
  return best!;
}

function searchShift(shapes: Point[][], mask: FloorMask, preferred: Point): { shift: Point; score: number } {
  const all = shapes.flat();
  const sb = bounds(all);
  const hb = mask.box;
  const probeSets = shapes.map(probes);
  const score = (dx: number, dz: number, full: boolean): number => {
    let n = 0;
    for (let i = 0; i < shapes.length; i++) {
      const pts = full ? cellCentres(shapes[i]) : probeSets[i];
      if (pts.every(p => mask.free({ x: p.x + dx, z: p.z + dz }))) n++;
    }
    return n;
  };
  const better = (s: number, d: Point, bs: number, bd: Point) =>
    s > bs || (s === bs && dist(d, preferred) < dist(bd, preferred));

  // Coarse: 1 m steps over every shift that keeps the group overlapping the hall.
  let bestD = preferred;
  let bestS = score(preferred.x, preferred.z, false);
  for (let dx = Math.floor(hb.minX - sb.maxX); dx <= Math.ceil(hb.maxX - sb.minX); dx += 1) {
    for (let dz = Math.floor(hb.minZ - sb.maxZ); dz <= Math.ceil(hb.maxZ - sb.minZ); dz += 1) {
      const s = score(dx, dz, false);
      if (better(s, { x: dx, z: dz }, bestS, bestD)) {
        bestS = s;
        bestD = { x: dx, z: dz };
      }
    }
  }
  // Fine: half metres around it, every cell of every stall.
  const centre = bestD;
  bestS = -1;
  for (let dx = centre.x - 1; dx <= centre.x + 1; dx += CELL) {
    for (let dz = centre.z - 1; dz <= centre.z + 1; dz += CELL) {
      const s = score(dx, dz, true);
      if (better(s, { x: dx, z: dz }, bestS, bestD)) {
        bestS = s;
        bestD = { x: dx, z: dz };
      }
    }
  }
  return { shift: bestD, score: Math.max(bestS, 0) };
}

// --- to planner stalls ---------------------------------------------------------------------------

export const CATEGORY_COLORS: Record<PdfStall['category'], string> = {
  standard: '#3498db',
  premium: '#e67e22',
  marquee: '#8e44ad',
  'start-up': '#27ae60',
};

/**
 * A planner stall for a placed outline: a plain rectangle when it has four corners, else a
 * custom (e.g. L-shaped) stall that keeps its exact outline and open edges. null when the
 * outline is unusable (the review reports it).
 */
export function toPlannerStall(stall: PdfStall, outline: Point[], hallId: string | number, name = stall.name): Stall | null {
  const n = normalizeFootprint(outline);
  if (typeof n === 'string') return null;
  const edges = [...new Set(stall.openEdges.map(e => n.edgeMap.get(e)).filter((e): e is number => e !== undefined))].sort((a, b) => a - b);
  const sides = sidesOfEdges(n.points, edges) as GateSide[];
  const rectangle = n.points.length === 4;
  return normalizeStall(
    {
      id: `${hallId}:${stall.key}`,
      name,
      width: n.width,
      length: n.length,
      posX: clean(n.offset.x),
      posZ: clean(n.offset.z),
      color: CATEGORY_COLORS[stall.category],
      openSides: sides.length ? sides : ['FRONT'],
      rotation: 0,
      ...(rectangle ? {} : { footprint: n.points, openEdges: edges }),
    },
    hallId,
  );
}

// --- the hall the import goes into ---------------------------------------------------------------

/**
 * The hall an import goes into: the chosen planner hall itself (same id, name, floor, zones,
 * walls and rules), so the import stays in that hall and no hall is added. Only when "new hall"
 * is chosen it is a plain rectangle around the drawing with 2 m to spare on every side. Only the
 * size step changes, and only when the drawing uses half metres: every other rule stays as the
 * hall has it. `target` itself is not modified: a changed size step comes back on a copy.
 */
export function importHall(
  target: Hall | null,
  result: PdfImportResult,
  groups: ReadonlyArray<string>,
  stamp = Date.now(),
): Hall {
  const half = needsHalfMetres(result, groups);
  const id = `pdf-hall-${stamp}`;
  if (target) {
    return half ? { ...target, rules: { ...(target.rules ?? {}), snapStep: 0.5 } } : target;
  }
  const frame = frameOffsets(result, groups);
  const pts = result.stalls
    .filter(s => groups.includes(s.group))
    .flatMap(s => s.outline.map(p => ({ x: p.x + frame[s.group].x, z: p.z + frame[s.group].z })));
  const b = pts.length ? bounds(pts) : { minX: 0, maxX: 20, minZ: 0, maxZ: 20 };
  return {
    id,
    name: `Hall ${groups.join('-')} (PDF import)`,
    shape: 'SQUARE',
    width: Math.ceil(b.maxX - b.minX) + 4,
    length: Math.ceil(b.maxZ - b.minZ) + 4,
    radius: 0,
    rules: { snapStep: half ? 0.5 : 1 },
  };
}

// --- planner rules ---------------------------------------------------------------------------------

export interface RuleCheck {
  /** Every stall as drawn, checked against the hall and all the other imported stalls. */
  violations: Map<string, Violation[]>;
  /** Stall ids that pass together: taken in order, each checked against those already kept. */
  compliant: string[];
  /** Stalls per violation code (as drawn). */
  codes: Record<string, number>;
}

/**
 * The planner's own placement rules over the imported stalls. A CAD plan may follow different
 * rules than the planner (e.g. blocks of stalls touching on several sides): these are reported,
 * never relaxed.
 */
export function checkRules(hall: Hall, stalls: ReadonlyArray<Stall>, eventType: EventType): RuleCheck {
  const ctx = placementContextFor(hall, stalls, eventType);
  const violations = new Map<string, Violation[]>();
  const codes: Record<string, number> = {};
  for (const s of stalls) {
    const v = validatePlacement(toPlacementStall(s), ctx, String(s.id)).violations;
    violations.set(String(s.id), v);
    for (const code of new Set(v.map(x => x.code))) codes[code] = (codes[code] ?? 0) + 1;
  }
  const kept: Stall[] = [];
  for (const s of stalls) {
    if (violations.get(String(s.id))?.some(v => v.code === 'OUTSIDE_HALL' || v.code === 'INVALID_DIMENSIONS' || v.code === 'INVALID_OPEN_SIDES')) continue;
    const c = placementContextFor(hall, kept, eventType);
    if (!validatePlacement(toPlacementStall(s), c, String(s.id)).violations.length) kept.push(s);
  }
  return { violations, compliant: kept.map(s => String(s.id)), codes };
}

/** Whether the selection needs a 0.5 m size step (a stall edge is not a whole metre). */
export function needsHalfMetres(result: PdfImportResult, groups: ReadonlyArray<string>): boolean {
  return result.groups.some(g => groups.includes(g.group) && g.usesHalfMetres);
}

function count(result: PdfImportResult, group: string): number {
  return result.stalls.filter(s => s.group === group).length;
}

export function bounds(points: ReadonlyArray<Point>): Rect {
  const r: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    r.minX = Math.min(r.minX, p.x);
    r.maxX = Math.max(r.maxX, p.x);
    r.minZ = Math.min(r.minZ, p.z);
    r.maxZ = Math.max(r.maxZ, p.z);
  }
  return r;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
