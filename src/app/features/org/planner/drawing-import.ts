import type {
  DrawingGroup,
  DrawingImportResult,
  DrawingPoint,
  DrawingStall,
} from '../../../core/plans/drawing-import.models';
import type { CategoryRef } from '../../../core/categories/categories.models';
import type { PlanStall, PlanZone, StallSide } from '../../../core/plans/plans.models';
import { cellCounts, cleanCutCells, stallArea } from '../../../core/plans/stall-cells';
import type { Point } from '../../../core/venues/floor-plan.models';
import {
  centre,
  newId,
  pointInRing,
  type PlannerFloor,
  type Rect,
  zoneAt,
} from './planner-geometry';

/**
 * From the stalls of a hall's CAD plan PDF to planner stalls: which halls of the drawing are
 * this hall, where they go on its floor, and as what. Pure functions, shared by the import
 * dialog and its tests.
 *
 * The backend gives each hall of the drawing ("group") in its own grid metres (x right, z down).
 * One page has one scale, so the groups keep their positions relative to each other (a frame:
 * the first group's grid). They are turned by a quarter-turn multiple and shifted in half-metre
 * steps, so half-metre stalls stay on the grid. Ported from the planner on main
 * (src/app/planner/pdf-import/pdf-import-plan.ts), on this planner's floor.
 */

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Alignment {
  rotation: QuarterTurn;
  /** Shift of each group, hall metres. */
  offsets: Record<string, DrawingPoint>;
}

/** How a fit was found: the drawing's own grid on the hall's, or the best search. */
export type FitMethod = 'registered' | 'fitted';

export interface FitResult {
  alignment: Alignment;
  method: FitMethod;
  /** Stalls wholly on the open floor under it. */
  onFloor: number;
}

/**
 * The halls of the drawing this hall is: those whose number is in the hall's name or code
 * ("Hall 8-9-10" → 8, 9, 10; "H5" → 5). "Hall 12A" is hall 12A, not 12; a trailing G or F is the
 * floor ("Hall 5G" is hall 5).
 */
export function matchGroups(
  names: ReadonlyArray<string | null | undefined>,
  groups: ReadonlyArray<DrawingGroup>,
): string[] {
  const numbers = new Set(
    names
      .filter((n): n is string => !!n)
      .flatMap((n) => [...n.toUpperCase().matchAll(/(\d+)([A-Z]?)(?![A-Z])/g)])
      .map((m) => String(Number(m[1])) + (/[GF]/.test(m[2]) ? '' : m[2])),
  );
  return groups.map((g) => g.group).filter((g) => numbers.has(g));
}

export const round05 = (v: number): number => Math.round(v * 2) / 2;

/**
 * The step the drawing is moved in, metres. Its stalls are in metres of its own grid, so whole
 * metres keep its grid lines on the hall's 1 m grid: a stall drawn on a grid line stays on one,
 * and one drawn on a half metre stays on that half metre, as in the drawing.
 */
export const DRAWING_STEP = 1;

const roundTo = (v: number, step: number): number => clean(Math.round(v / step) * step);

/** Each group's grid origin in the frame of `groups[0]`, metres, on the drawing's grid. */
export function frameOffsets(
  result: DrawingImportResult,
  groups: ReadonlyArray<string>,
): Record<string, DrawingPoint> {
  const step = DRAWING_STEP;
  const cal = new Map(result.groups.map((g) => [g.group, g]));
  const ref = cal.get(groups[0]);
  const out: Record<string, DrawingPoint> = {};
  for (const g of groups) {
    const c = cal.get(g);
    out[g] =
      ref && c
        ? {
            x: roundTo((c.originX - ref.originX) / ref.pitchX, step),
            z: roundTo((c.originY - ref.originY) / ref.pitchY, step),
          }
        : { x: 0, z: 0 };
  }
  return out;
}

/** A quarter turn clockwise on the plan (x right, z down) is (x, z) → (-z, x). */
export function turn(p: DrawingPoint, rotation: QuarterTurn): DrawingPoint {
  switch (rotation) {
    case 90:
      return { x: -p.z, z: p.x };
    case 180:
      return { x: -p.x, z: -p.z };
    case 270:
      return { x: p.z, z: -p.x };
    default:
      return { x: p.x, z: p.z };
  }
}

/** A stall's outline in hall metres under an alignment. */
export function placeOutline(stall: DrawingStall, alignment: Alignment): DrawingPoint[] {
  const o = alignment.offsets[stall.group] ?? { x: 0, z: 0 };
  return ring(stall.outline).map((p) => {
    const t = turn(p, alignment.rotation);
    return { x: clean(t.x + o.x), z: clean(t.z + o.z) };
  });
}

/** The drawing's layout kept, the selection centred on the hall: before a fit, and for Reset. */
export function centredAlignment(
  result: DrawingImportResult,
  groups: ReadonlyArray<string>,
  floor: PlannerFloor,
  rotation: QuarterTurn = 0,
): Alignment {
  const frame = frameOffsets(result, groups);
  const turned = Object.fromEntries(groups.map((g) => [g, turn(frame[g], rotation)]));
  const pts = result.stalls
    .filter((s) => groups.includes(s.group))
    .flatMap((s) =>
      s.outline.map((p) => {
        const t = turn(p, rotation);
        return { x: t.x + turned[s.group].x, z: t.z + turned[s.group].z };
      }),
    );
  if (!pts.length) return { rotation, offsets: turned };
  const hb = floorBounds(floor);
  const sb = bounds(pts);
  const step = DRAWING_STEP;
  const dx = roundTo((hb.minX + hb.maxX) / 2 - (sb.minX + sb.maxX) / 2, step);
  const dz = roundTo((hb.minZ + hb.maxZ) / 2 - (sb.minZ + sb.maxZ) / 2, step);
  return {
    rotation,
    offsets: Object.fromEntries(
      groups.map((g) => [g, { x: turned[g].x + dx, z: turned[g].z + dz }]),
    ),
  };
}

/** Moves every group of an alignment by the same step: the review's nudge. */
export function nudge(alignment: Alignment, dx: number, dz: number): Alignment {
  return {
    rotation: alignment.rotation,
    offsets: Object.fromEntries(
      Object.entries(alignment.offsets).map(([g, o]) => [
        g,
        { x: clean(o.x + dx), z: clean(o.z + dz) },
      ]),
    ),
  };
}

// --- registration: the drawing's grid on the hall's grid ----------------------------------------

/** How far (m) a drawing's grid area and a hall floor may differ in size and still be the same. */
const SAME_SIZE = 1.5;
/** How far (m) from corner-on-corner the grid match looks. */
const SEARCH = 1.5;
const CELL = 0.5;

/** Share of the drawing's grid that must land on open floor for a placement to count as exact. */
const ON_FLOOR = 0.97;
/** How far (m) the drawing's grid may reach past the hall's outline while it is searched. */
const OVERHANG = 3;
/** Cells a coarse search scores at most; the fine search scores them all. */
const COARSE_CELLS = 1500;

/**
 * The exact placement when the drawing and the hall come from the same plan: the drawing's own
 * grid laid on the hall's open floor where the two coincide, in half-metre steps, so every stall
 * lands where the drawing puts it. A floor of the drawing's size is tried corner on corner; a
 * hall whose outline takes in walls, an annex or a foyer (an ITPO floor from T_HALL_LAYOUTS) is
 * searched over its whole extent. Only a placement with nearly all the grid on open floor counts.
 * Tries the drawing's orientation first, then the other quarter turns; null when none fits.
 */
export function registeredAlignment(
  result: DrawingImportResult,
  groups: ReadonlyArray<string>,
  floor: PlannerFloor,
): Alignment | null {
  const floors = floor.floor
    .map((poly) => bounds(poly[0].map(([x, z]) => ({ x, z }))))
    .sort((a, b) => area(b) - area(a));
  const gridAreas = result.gridAreas ?? [];
  if (!floors.length || !gridAreas.length || !groups.length) return null;
  // The drawing's grid covers the hall's passages too: only walls, voids and the outside are off.
  const mask = FloorMask.forStructure(floor);
  // One page, one scale: the halls of the drawing keep their places to each other, and are
  // laid on the floor together, as one.
  const frame = frameOffsets(result, groups);
  const step = DRAWING_STEP;
  for (const rotation of [0, 180, 90, 270] as QuarterTurn[]) {
    const placed = groups.flatMap((g) => {
      const at = turn(frame[g], rotation);
      return gridAreas
        .filter((a) => a.group === g)
        .map((a) =>
          a.outline.map((p) => turn(p, rotation)).map((p) => ({ x: p.x + at.x, z: p.z + at.z })),
        );
    });
    if (!placed.length) continue;
    const box = bounds(placed.flat());
    // Every half-metre cell of the drawing's grid: on the floor counts for, off it against.
    const cells = placed.flatMap((outline) => cellCentres(outline));
    const score = (d: DrawingPoint, sample: DrawingPoint[] = cells) => {
      let n = 0;
      for (const c of sample) n += mask.free({ x: c.x + d.x, z: c.z + d.z }) ? 1 : -1;
      return n;
    };
    const hall = floors.find(
      (f) =>
        Math.abs(f.maxX - f.minX - (box.maxX - box.minX)) <= SAME_SIZE &&
        Math.abs(f.maxZ - f.minZ - (box.maxZ - box.minZ)) <= SAME_SIZE,
    );
    const found = hall
      ? searchAround({ x: hall.minX - box.minX, z: hall.minZ - box.minZ }, SEARCH, step, score)
      : searchWithin(box, mask.box, cells, step, score);
    if (!found || found.score < cells.length * (2 * ON_FLOOR - 1)) continue;
    // The page's halls are drawn apart, each on its own walls, and their distances to each
    // other come to the half metre: each settles on its walls, near where the drawing puts it.
    const offsets: Record<string, DrawingPoint> = {};
    for (const g of groups) {
      const at = turn(frame[g], rotation);
      const own = gridAreas
        .filter((a) => a.group === g)
        .flatMap((a) => cellCentres(a.outline.map((p) => turn(p, rotation))));
      const start = { x: found.d.x + at.x, z: found.d.z + at.z };
      const settled =
        groups.length > 1
          ? searchAround(start, SEARCH, step, (d) => {
              let n = 0;
              for (const c of own) n += mask.free({ x: c.x + d.x, z: c.z + d.z }) ? 1 : -1;
              return n;
            }).d
          : start;
      offsets[g] = { x: clean(settled.x), z: clean(settled.z) };
    }
    return { rotation, offsets };
  }
  return null;
}

/** The best shift within `reach` of a start, on the drawing's step; ties go to the nearest. */
function searchAround(
  from: DrawingPoint,
  reach: number,
  step: number,
  score: (d: DrawingPoint) => number,
): { d: DrawingPoint; score: number } {
  const start = { x: roundTo(from.x, step), z: roundTo(from.z, step) };
  let best = { d: start, score: -Infinity };
  for (let dx = -reach; dx <= reach; dx += step) {
    for (let dz = -reach; dz <= reach; dz += step) {
      const d = { x: start.x + dx, z: start.z + dz };
      const s = score(d);
      if (
        s > best.score ||
        (s === best.score &&
          Math.hypot(dx, dz) < Math.hypot(best.d.x - start.x, best.d.z - start.z))
      ) {
        best = { d, score: s };
      }
    }
  }
  return best;
}

/**
 * The best shift that keeps the drawing's grid and the hall's extent within each other: whole
 * metres on a sample of its cells first, then the drawing's step around the best on all of them.
 */
function searchWithin(
  box: Box,
  hall: Box,
  cells: DrawingPoint[],
  step: number,
  score: (d: DrawingPoint, sample?: DrawingPoint[]) => number,
): { d: DrawingPoint; score: number } {
  // The grid may reach a little past the hall's outline (over its walls); the score counts
  // such cells against it. A grid longer than the hall (it takes in a foyer the hall's floor
  // leaves out) is searched with the hall inside it.
  const span = (hMin: number, hMax: number, bMin: number, bMax: number): [number, number] => {
    const [a, b] = [hMin - bMin, hMax - bMax];
    return [Math.min(a, b) - OVERHANG, Math.max(a, b) + OVERHANG];
  };
  const [x0, x1] = span(hall.minX, hall.maxX, box.minX, box.maxX);
  const [z0, z1] = span(hall.minZ, hall.maxZ, box.minZ, box.maxZ);
  const stride = Math.max(1, Math.ceil(cells.length / COARSE_CELLS));
  const sample = cells.filter((_, i) => i % stride === 0);
  let coarse = { d: { x: x0, z: z0 }, score: -Infinity };
  for (let dx = Math.floor(x0); dx <= Math.ceil(x1); dx += 1) {
    for (let dz = Math.floor(z0); dz <= Math.ceil(z1); dz += 1) {
      const s = score({ x: dx, z: dz }, sample);
      if (s > coarse.score) coarse = { d: { x: dx, z: dz }, score: s };
    }
  }
  return searchAround(coarse.d, 1, step, (d) => score(d));
}

// --- auto-fit ------------------------------------------------------------------------------------

interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * The hall's open floor on a 0.5 m raster: inside its outline, out of its holes and of what
 * blocks stalls. Pillars stay open: stalls are built round them.
 */
export class FloorMask {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: Uint8Array;

  constructor(
    readonly box: Box,
    inside: (p: DrawingPoint) => boolean,
  ) {
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

  /** Where stalls may stand: the floor, clear of everything that blocks them. */
  static forFloor(floor: PlannerFloor): FloorMask {
    return FloorMask.within(floor, floor.blocked);
  }

  /** The floor itself, passages and no-build areas included: what a drawing of the hall covers. */
  static forStructure(floor: PlannerFloor): FloorMask {
    return FloorMask.within(floor, floor.structure);
  }

  private static within(floor: PlannerFloor, off: ReadonlyArray<Rect>): FloorMask {
    return new FloorMask(floorBounds(floor), (p) => {
      const at: Point = [p.x, p.z];
      return (
        floor.floor.some(
          (poly) => pointInRing(at, poly[0]) && !poly.slice(1).some((h) => pointInRing(at, h)),
        ) && !off.some((b) => inBox(at, b))
      );
    });
  }

  free(p: DrawingPoint): boolean {
    const c = Math.floor((p.x - this.box.minX) / CELL);
    const r = Math.floor((p.z - this.box.minZ) / CELL);
    return (
      c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.cells[r * this.cols + c] === 1
    );
  }

  /** Marks the cells under an outline as taken, so the next group avoids them. */
  occupy(outline: DrawingPoint[]): void {
    for (const p of cellCentres(outline)) {
      const c = Math.floor((p.x - this.box.minX) / CELL);
      const r = Math.floor((p.z - this.box.minZ) / CELL);
      if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.cells[r * this.cols + c] = 0;
    }
  }
}

/** Centres of the 0.5 m cells inside an outline (outlines are on the half-metre grid). */
export function cellCentres(outline: DrawingPoint[]): DrawingPoint[] {
  const b = bounds(outline);
  const poly: Point[] = outline.map((p) => [p.x, p.z]);
  const out: DrawingPoint[] = [];
  for (let x = Math.floor(b.minX / CELL) * CELL + CELL / 2; x < b.maxX; x += CELL) {
    for (let z = Math.floor(b.minZ / CELL) * CELL + CELL / 2; z < b.maxZ; z += CELL) {
      if (pointInRing([x, z], poly)) out.push({ x, z });
    }
  }
  return out;
}

/** Each corner moved half a metre inwards: a cheap "is this stall on the floor" probe. */
function probes(outline: DrawingPoint[]): DrawingPoint[] {
  const n = outline.length;
  const inward = (a: DrawingPoint, b: DrawingPoint): DrawingPoint => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
  };
  return outline.map((v, i) => {
    const a = inward(outline[(i - 1 + n) % n], v);
    const b = inward(v, outline[(i + 1) % n]);
    return { x: v.x + CELL * (a.x + b.x), z: v.z + CELL * (a.z + b.z) };
  });
}

/**
 * Where the drawing goes on the hall: exactly on the hall's grid when both come from the same
 * plan; else, for each quarter turn, the shift of every group (largest first) that puts most of
 * its stalls wholly on the open floor, groups not overlapping. Ties keep the drawing's layout.
 */
export function autoFit(
  result: DrawingImportResult,
  groups: ReadonlyArray<string>,
  floor: PlannerFloor,
  rotations: ReadonlyArray<QuarterTurn> = [0, 90, 180, 270],
): FitResult {
  const chosen = result.stalls.filter((s) => groups.includes(s.group));
  const step = DRAWING_STEP;
  const registered = registeredAlignment(result, groups, floor);
  if (registered) {
    return {
      alignment: registered,
      method: 'registered',
      onFloor: countOnFloor(chosen, registered, FloorMask.forFloor(floor)),
    };
  }
  let best: FitResult | null = null;
  for (const rotation of rotations) {
    const start = centredAlignment(result, groups, floor, rotation);
    const mask = FloorMask.forFloor(floor);
    const order = [...groups].sort(
      (a, b) =>
        chosen.filter((s) => s.group === b).length - chosen.filter((s) => s.group === a).length,
    );
    const offsets: Record<string, DrawingPoint> = { ...start.offsets };
    let total = 0;
    for (const g of order) {
      const shapes = chosen
        .filter((s) => s.group === g)
        .map((s) => ring(s.outline).map((p) => turn(p, rotation)));
      if (!shapes.length) continue;
      const found = searchShift(shapes, mask, start.offsets[g], step);
      offsets[g] = found.shift;
      total += found.score;
      for (const outline of shapes) {
        const placed = outline.map((p) => ({ x: p.x + found.shift.x, z: p.z + found.shift.z }));
        if (cellCentres(placed).every((p) => mask.free(p))) mask.occupy(placed);
      }
    }
    if (!best || total > best.onFloor) {
      best = { alignment: { rotation, offsets }, method: 'fitted', onFloor: total };
    }
  }
  return best!;
}

/** How many stalls stand wholly on the open floor under an alignment. */
export function countOnFloor(
  stalls: ReadonlyArray<DrawingStall>,
  alignment: Alignment,
  mask: FloorMask,
): number {
  return stalls.filter((s) => cellCentres(placeOutline(s, alignment)).every((p) => mask.free(p)))
    .length;
}

function searchShift(
  shapes: DrawingPoint[][],
  mask: FloorMask,
  preferred: DrawingPoint,
  step: number,
): { shift: DrawingPoint; score: number } {
  const sb = bounds(shapes.flat());
  const hb = mask.box;
  const probeSets = shapes.map(probes);
  const cellSets = shapes.map(cellCentres);
  const score = (dx: number, dz: number, full: boolean): number => {
    let n = 0;
    for (let i = 0; i < shapes.length; i++) {
      const pts = full ? cellSets[i] : probeSets[i];
      if (pts.every((p) => mask.free({ x: p.x + dx, z: p.z + dz }))) n++;
    }
    return n;
  };
  const better = (s: number, d: DrawingPoint, bs: number, bd: DrawingPoint) =>
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
  // Fine: the drawing's step around it, every cell of every stall.
  const c = bestD;
  bestS = -1;
  for (let dx = c.x - 1; dx <= c.x + 1; dx += step) {
    for (let dz = c.z - 1; dz <= c.z + 1; dz += step) {
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

/** One stall of the drawing on the hall, and whether it can be brought in. */
export interface PlacedStall {
  stall: DrawingStall;
  outline: DrawingPoint[];
  /**
   * The planner rectangle: the outline's box, with `cutCells` for an L or other square-cornered
   * shape; null when it cannot be made of cells (a slanted edge).
   */
  rect: Rect | null;
  /** Cells of the box outside the outline, [column, row] from its top-left. */
  cutCells: Array<[number, number]>;
  /** Wholly on the open floor. */
  onFloor: boolean;
  /** Why it is not brought in, or null. */
  skip: string | null;
}

/** Every stall of the chosen halls of the drawing, placed. */
export function placeStalls(
  result: DrawingImportResult,
  groups: ReadonlyArray<string>,
  alignment: Alignment,
  floor: PlannerFloor,
  excluded: ReadonlySet<string> = new Set(),
  overrides: ReadonlyMap<string, StallOverride> = new Map(),
): PlacedStall[] {
  // Off the hall (a wall, a void, the outside) a stall cannot be; on a passage or a no-build
  // area the hall's rules decide, as for a stall drawn there.
  const mask = FloorMask.forStructure(floor);
  return result.stalls
    .filter((s) => groups.includes(s.group))
    .map((stall) => {
      const outline = adjustOutline(placeOutline(stall, alignment), overrides.get(stall.key));
      const shape = cellShapeOf(outline);
      const rect = shape?.rect ?? null;
      // The outline's own cells: an L is on the floor when its kept cells are, not its box.
      const onFloor = cellCentres(outline).every((p) => mask.free(p));
      // An outline the server doubted (no letter in it) is a stall once the review says so.
      const notStall = overrides.get(stall.key)?.isStall ? null : notAStall(stall);
      const skip = excluded.has(stall.key)
        ? 'Left out in the review'
        : notStall
          ? notStall
          : !rect
            ? 'Has a slanted edge: draw it by hand'
            : !onFloor
              ? 'Off the hall floor: on a wall or outside the hall'
              : null;
      return { stall, outline, rect, cutCells: shape?.cutCells ?? [], onFloor, skip };
    });
}

/**
 * Why an outline of the drawing is no stall, or null: a named area ("HALL MASTER") or a kiosk
 * (an ATM) the server left out of the import, or an outline the drawing gives no stall letter.
 * Nothing is assumed for such an outline: it comes in only once the review takes it as a stall.
 */
export function notAStall(
  stall: Pick<DrawingStall, 'include' | 'letter' | 'issues'>,
): string | null {
  const why = stall.include
    ? null
    : stall.issues.find(
        (i) =>
          i.code === 'KIOSK' ||
          (i.code === 'NO_LABEL' && !stall.letter && i.message.startsWith('Named area')),
      );
  if (why) return `Not a stall: ${why.message}`;
  return stall.letter ? null : 'No stall letter in the drawing';
}

/**
 * Whether the drawing gives the stall no number: no block was read for it, so the server named
 * it by its key ("Stall s116"). Such a stall comes in numbered by `autoNumbers`.
 */
export function unnumbered(stall: Pick<DrawingStall, 'name' | 'key'>): boolean {
  return stall.name === `Stall ${stall.key}`;
}

/** The stall's outline as a planner rectangle, when it is one: four corners, sides square. */
export function rectOf(outline: DrawingPoint[]): Rect | null {
  if (outline.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % 4];
    if (a.x !== b.x && a.z !== b.z) return null;
  }
  const b = bounds(outline);
  const width = clean(b.maxX - b.minX);
  const height = clean(b.maxZ - b.minZ);
  if (width <= 0 || height <= 0) return null;
  return { x: clean(b.minX), y: clean(b.minZ), width, height };
}

/**
 * The outline as whole 1 m cells: its box, and the cells of the box whose middle is outside it.
 * Any outline with square corners (a rectangle, an L, a U, a notched box) is one; null when an
 * edge is slanted, as no cells make that. A far-edge cell of a box off whole metres is a part
 * cell, tested at its own middle.
 */
export function cellShapeOf(
  outline: DrawingPoint[],
): { rect: Rect; cutCells: Array<[number, number]> } | null {
  const n = outline.length;
  if (n < 4) return null;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (a.x !== b.x && a.z !== b.z) return null;
  }
  const b = bounds(outline);
  const rect = {
    x: clean(b.minX),
    y: clean(b.minZ),
    width: clean(b.maxX - b.minX),
    height: clean(b.maxZ - b.minZ),
  };
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rectOf(outline)) return { rect, cutCells: [] };
  const size = { width: rect.width, depth: rect.height };
  const { cols, rows } = cellCounts(size);
  const ring: Point[] = outline.map((p) => [p.x, p.z]);
  const cut: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mid: Point = [
        rect.x + c + Math.min(1, rect.width - c) / 2,
        rect.y + r + Math.min(1, rect.height - r) / 2,
      ];
      if (!pointInRing(mid, ring)) cut.push([c, r]);
    }
  }
  return { rect, cutCells: cleanCutCells(size, cut) };
}

/**
 * The sides the drawing's fascia (open) edges are on, after placing. Only an edge on a side of
 * the box opens that side; an open edge round a notch is not one, and is counted by
 * `notchOpenEdges` instead.
 */
export function openSidesOf(stall: DrawingStall, outline: DrawingPoint[]): StallSide[] {
  const sides = new Set<StallSide>();
  for (const side of edgeSides(stall, outline)) if (side) sides.add(side);
  return (['top', 'right', 'bottom', 'left'] as StallSide[]).filter((s) => sides.has(s));
}

/** Open edges of the drawing round a notch, not on a side of the box: they are drawn closed. */
export function notchOpenEdges(stall: DrawingStall, outline: DrawingPoint[]): number {
  return edgeSides(stall, outline).filter((side) => side === null).length;
}

/** The side of the box each open edge lies on; null for one inside the box, round a notch. */
function edgeSides(stall: DrawingStall, outline: DrawingPoint[]): Array<StallSide | null> {
  const b = bounds(outline);
  const n = outline.length;
  const on = (v: number, w: number) => Math.abs(v - w) < 1e-6;
  const out: Array<StallSide | null> = [];
  for (const e of stall.openEdges) {
    const a = outline[e];
    const c = outline[(e + 1) % n];
    if (!a || !c) continue;
    if (a.z === c.z) out.push(on(a.z, b.minZ) ? 'top' : on(a.z, b.maxZ) ? 'bottom' : null);
    else if (a.x === c.x) out.push(on(a.x, b.minX) ? 'left' : on(a.x, b.maxX) ? 'right' : null);
  }
  return out;
}

/**
 * New numbers for stalls whose number the drawing repeats (2F-09 has "A1" twice), by drawing
 * key: a plan cannot hold two stalls of one number, so the first in reading order (top to
 * bottom, then left to right) keeps it and each other takes the next number free in the
 * drawing, its last digits counted on ("A1" → "A2"). A number given by hand is left alone.
 */
export function twinNumbers(
  placed: ReadonlyArray<PlacedStall>,
  overrides: ReadonlyMap<string, StallOverride> = new Map(),
): Map<string, string> {
  const nameOf = (p: PlacedStall) => overrides.get(p.stall.key)?.name ?? p.stall.name;
  const used = new Set(placed.map((p) => nameOf(p).toLowerCase()));
  const top = (p: PlacedStall) => bounds(p.outline);
  const order = [...placed].sort((a, b) => top(a).minZ - top(b).minZ || top(a).minX - top(b).minX);
  const seen = new Set<string>();
  const out = new Map<string, string>();
  for (const p of order) {
    const name = nameOf(p);
    const key = name.toLowerCase();
    if (!seen.has(key) || overrides.get(p.stall.key)?.name) {
      seen.add(key);
      continue;
    }
    const m = /^(.*?)(\d+)$/.exec(name);
    const [stem, start] = m ? [m[1], Number(m[2])] : [name, 1];
    let n = start + 1;
    while (used.has(`${stem}${n}`.toLowerCase())) n++;
    const next = `${stem}${n}`;
    used.add(next.toLowerCase());
    out.set(p.stall.key, next);
  }
  return out;
}

/**
 * Numbers for the stalls the drawing gives none, by drawing key: S1, S2… in reading order (top
 * to bottom, then left to right), past any number already used. A number given by hand wins.
 */
export function autoNumbers(
  placed: ReadonlyArray<PlacedStall>,
  overrides: ReadonlyMap<string, StallOverride> = new Map(),
): Map<string, string> {
  const nameOf = (p: PlacedStall) => overrides.get(p.stall.key)?.name ?? p.stall.name;
  const used = new Set(placed.map((p) => nameOf(p).toLowerCase()));
  const top = (p: PlacedStall) => bounds(p.outline);
  const order = placed
    .filter((p) => unnumbered(p.stall) && !overrides.get(p.stall.key)?.name)
    .sort((a, b) => top(a).minZ - top(b).minZ || top(a).minX - top(b).minX);
  const out = new Map<string, string>();
  let n = 1;
  for (const p of order) {
    while (used.has(`s${n}`)) n++;
    const next = `S${n}`;
    used.add(next.toLowerCase());
    out.set(p.stall.key, next);
  }
  return out;
}

/**
 * What the review says about a stall as it is brought in: open edges drawn closed round its
 * notch, an area off the drawing's label, and what was changed by hand.
 */
export function importNotes(
  placed: PlacedStall,
  stall: PlanStall,
  override?: StallOverride,
): string[] {
  const name = placed.stall.name;
  const notes: string[] = [];
  const closed = notchOpenEdges(placed.stall, placed.outline);
  if (closed) {
    const what = closed === 1 ? 'an open side' : `${closed} open sides`;
    notes.push(`${name}: ${what} round its notch drawn closed.`);
  }
  const drawn = placed.stall.labels.area;
  const cells = stallArea(stall);
  if (drawn !== null && Math.abs(drawn - cells) > 1) {
    notes.push(`${name}: the drawing says ${fmtM(drawn)} m², the cells give ${fmtM(cells)} m².`);
  }
  const changed = override ? overrideText(override) : '';
  if (changed) notes.push(`${name} ${changed} by hand.`);
  return notes;
}

// --- one stall changed by hand -------------------------------------------------------------------

/**
 * A change to one stall made in the review, on top of where the alignment puts it: turned a
 * quarter at a time, resized (a rectangle only), then moved. Relative, so a new alignment or
 * fit keeps it.
 */
export interface StallOverride {
  /** Moved, hall metres. */
  dx: number;
  dz: number;
  /** Size after turning, whole metres; a rectangle only. */
  width?: number;
  depth?: number;
  turn?: QuarterTurn;
  /** A new number, as the drawing writes one ("2F-09 A3"): for a number the drawing repeats. */
  name?: string;
  /** Taken as a stall, though the server doubted it (no stall letter inside its outline). */
  isStall?: boolean;
}

/** Whether an override changes nothing: what Reset leaves. */
export function isNoOverride(o: StallOverride): boolean {
  return (
    !o.dx &&
    !o.dz &&
    o.width === undefined &&
    o.depth === undefined &&
    !o.turn &&
    !o.name &&
    !o.isStall
  );
}

/**
 * A placed outline with a stall's own change: turned about its box and set back on the box's
 * top-left corner (so it stays on the grid), resized, then moved. The corners keep their order,
 * so the drawing's open edges still name the same edges.
 */
export function adjustOutline(outline: DrawingPoint[], o?: StallOverride): DrawingPoint[] {
  if (!o || isNoOverride(o)) return outline;
  let pts = outline;
  if (o.turn) {
    const b = bounds(pts);
    const turned = pts.map((p) => turn({ x: p.x - b.minX, z: p.z - b.minZ }, o.turn!));
    const t = bounds(turned);
    pts = turned.map((p) => ({
      x: clean(p.x - t.minX + b.minX),
      z: clean(p.z - t.minZ + b.minZ),
    }));
  }
  if ((o.width !== undefined || o.depth !== undefined) && rectOf(pts)) {
    const b = bounds(pts);
    const w = o.width ?? b.maxX - b.minX;
    const d = o.depth ?? b.maxZ - b.minZ;
    pts = pts.map((p) => ({
      x: p.x === b.minX ? p.x : clean(b.minX + w),
      z: p.z === b.minZ ? p.z : clean(b.minZ + d),
    }));
  }
  return pts.map((p) => ({ x: clean(p.x + o.dx), z: clean(p.z + o.dz) }));
}

/** A change in words, e.g. "moved 1 m left and 0.5 m down, turned a quarter". */
export function overrideText(o: StallOverride): string {
  const parts: string[] = [];
  const moves = [
    o.dx ? `${fmtM(Math.abs(o.dx))} m ${o.dx < 0 ? 'left' : 'right'}` : '',
    o.dz ? `${fmtM(Math.abs(o.dz))} m ${o.dz < 0 ? 'up' : 'down'}` : '',
  ].filter(Boolean);
  if (moves.length) parts.push(`moved ${moves.join(' and ')}`);
  if (o.turn === 90) parts.push('turned a quarter');
  else if (o.turn === 180) parts.push('turned half round');
  else if (o.turn === 270) parts.push('turned three quarters');
  if (o.width !== undefined || o.depth !== undefined) {
    const size = [o.width, o.depth].map((v) => (v === undefined ? 'as drawn' : `${fmtM(v)} m`));
    parts.push(`resized to ${size.join(' × ')}`);
  }
  if (o.name) parts.push(`numbered ${o.name}`);
  if (o.isStall) parts.push('taken as a stall');
  return parts.join(', ');
}

/**
 * The drawing's name as the plan's island and number, so the label reads as drawn: "08-01 C" is
 * island "08-01" and stall "C"; a name without a letter is the stall number itself.
 */
export function numberOf(
  stall: DrawingStall,
  name = stall.name,
): {
  islandNumber: string | null;
  stallNumber: string;
} {
  const text = name.trim();
  const letter = stall.letter?.trim();
  if (letter && text.length > letter.length && text.endsWith(letter)) {
    const island = text.slice(0, text.length - letter.length).trim();
    if (island.length <= 40 && letter.length <= 20) {
      return { islandNumber: island, stallNumber: letter };
    }
  }
  if (text.length <= 20) return { islandNumber: null, stallNumber: text || stall.key };
  // Too long for a stall number: its start becomes the island.
  return { islandNumber: text.slice(0, -20).slice(-40) || null, stallNumber: text.slice(-20) };
}

/**
 * A placed stall as a planner stall, its cut cells and all; premium and marquee as the drawing
 * marks them.
 */
export function toPlanStall(
  placed: PlacedStall,
  zones: PlanZone[],
  categories: ReadonlyArray<CategoryRef>,
  name?: string,
): PlanStall {
  const { stall, rect } = placed;
  const r = rect!;
  const active = categories.filter((c) => c.status === 'active');
  const named = (re: RegExp) => active.find((c) => re.test(c.name))?.id;
  const categoryIds = [
    stall.category === 'premium' ? named(/premium/i) : undefined,
    stall.category === 'start-up' ? named(/start[- ]?up/i) : undefined,
  ].filter((id): id is string => !!id);
  const open = openSidesOf(stall, placed.outline);
  return {
    id: newId(),
    zoneId: zoneAt(centre(r), zones)?.id ?? null,
    // A new number splits like the drawn one: its last word is the stall, the rest the island.
    ...numberOf(name ? { ...stall, letter: name.trim().split(/\s+/).pop() ?? null } : stall, name),
    x: r.x,
    y: r.y,
    width: r.width,
    depth: r.height,
    openSides: open.length ? open : ['bottom'],
    cutCells: placed.cutCells,
    scheme: 'shell',
    categoryIds,
    isPremium: stall.category === 'premium',
    isBlocked: false,
    isFnb: false,
    isBranding: false,
    isHorseshoe: false,
    isMarqueeAvailable: stall.category === 'marquee',
    isRestrictedForOverseas: false,
    isActive: true,
    location: null,
    description: null,
  };
}

// --- helpers ---------------------------------------------------------------------------------------

/** The outline without a repeated closing point. */
function ring(outline: DrawingPoint[]): DrawingPoint[] {
  const n = outline.length;
  return n > 1 && outline[0].x === outline[n - 1].x && outline[0].z === outline[n - 1].z
    ? outline.slice(0, -1)
    : outline;
}

function floorBounds(floor: PlannerFloor): Box {
  const pts = floor.floor.flatMap((poly) => poly[0].map(([x, z]) => ({ x, z })));
  return pts.length ? bounds(pts) : { minX: 0, minZ: 0, maxX: floor.width, maxZ: floor.depth };
}

function inBox(p: Point, r: Rect): boolean {
  return p[0] > r.x && p[0] < r.x + r.width && p[1] > r.y && p[1] < r.y + r.height;
}

export function bounds(points: ReadonlyArray<DrawingPoint>): Box {
  const r: Box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    r.minX = Math.min(r.minX, p.x);
    r.maxX = Math.max(r.maxX, p.x);
    r.minZ = Math.min(r.minZ, p.z);
    r.maxZ = Math.max(r.maxZ, p.z);
  }
  return r;
}

function area(r: Box): number {
  return (r.maxX - r.minX) * (r.maxZ - r.minZ);
}

function dist(a: DrawingPoint, b: DrawingPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function fmtM(v: number): string {
  return `${Math.round(v * 100) / 100}`;
}

function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6 + 0;
}
