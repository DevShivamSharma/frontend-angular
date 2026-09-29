import type { Footprint, Point, Rect } from '../geometry/placement-rules';
import { pointInPolygon, polygonBounds } from '../geometry/placement-rules';
import { rotate, stallPolygon } from '../geometry/polygon-geometry';
import type { GateSide, Stall } from '../models/stall.model';

/**
 * Geometry of the drafting workspace.
 *
 * Two coordinate systems meet here. The planner stores metres, centre-origin, X right and Z down
 * (`posX`/`posZ`). Architects think in CAD coordinates: origin at the plan's bottom-left corner,
 * Y up, angles counter-clockwise from +X. Everything typed or shown to the user is CAD; every
 * stored value stays planner world. `CadFrame` is the only conversion between the two.
 */

export interface CadPoint {
  x: number;
  y: number;
}

export class CadFrame {
  constructor(readonly minX: number, readonly maxZ: number) {}

  static of(bounds: Rect): CadFrame {
    return new CadFrame(bounds.minX, bounds.maxZ);
  }

  toCad(p: Point): CadPoint {
    return { x: p.x - this.minX, y: this.maxZ - p.z };
  }

  toWorld(c: CadPoint): Point {
    return { x: c.x + this.minX, z: this.maxZ - c.y };
  }
}

/** World unit vector of a CAD angle (degrees, counter-clockwise, Y up). */
export function cadDirection(degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  return { x: Math.cos(t), z: -Math.sin(t) };
}

/** CAD angle of the world vector a -> b, 0-360. */
export function cadAngle(a: Point, b: Point): number {
  const deg = (Math.atan2(-(b.z - a.z), b.x - a.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

const clean = (v: number) => Math.round(v * 1e6) / 1e6;

// --- stall orientation ------------------------------------------------------------------------------

/** One quarter turn clockwise on the plan: the top (BACK) edge becomes the right edge. */
const QUARTER_CW: Record<GateSide, GateSide> = { BACK: 'RIGHT', RIGHT: 'FRONT', FRONT: 'LEFT', LEFT: 'BACK' };
const FLIP_Z: Record<GateSide, GateSide> = { BACK: 'FRONT', FRONT: 'BACK', LEFT: 'LEFT', RIGHT: 'RIGHT' };

export function turnSides(sides: readonly GateSide[], quarterTurnsCw: number): GateSide[] {
  const k = ((quarterTurnsCw % 4) + 4) % 4;
  return sides.map(s => {
    let side = s;
    for (let i = 0; i < k; i++) side = QUARTER_CW[side];
    return side;
  });
}

type Oriented = Pick<Stall, 'posX' | 'posZ' | 'width' | 'length' | 'openSides' | 'gateSide'> &
  Partial<Pick<Stall, 'rotation' | 'footprint' | 'openEdges'>>;

/**
 * A rectangle turned by a whole number of quarter turns is stored unrotated, with width and
 * length swapped and its open sides turned: the booking portal only knows axis-aligned stalls,
 * and a 0-rotation stall is what every other planner tool expects.
 */
export function normaliseRightAngle<T extends Oriented>(stall: T): T {
  const base = { ...stall, posX: clean(stall.posX), posZ: clean(stall.posZ) };
  const r = (((stall.rotation ?? 0) % 360) + 360) % 360;
  if (stall.footprint && stall.footprint.length >= 3) return { ...base, rotation: clean(r) };
  const k = Math.round(r / 90);
  if (Math.abs(r - k * 90) > 0.01) return { ...base, rotation: clean(r) };
  const sides = turnSides(stall.openSides, k);
  return {
    ...base,
    rotation: 0,
    width: k % 2 ? stall.length : stall.width,
    length: k % 2 ? stall.width : stall.length,
    openSides: sides,
    gateSide: sides[0] ?? stall.gateSide
  };
}

export function translate<T extends Oriented>(stall: T, d: Point): T {
  return { ...stall, posX: clean(stall.posX + d.x), posZ: clean(stall.posZ + d.z) };
}

/** Turn a stall about `centre`. `cwDegrees` is clockwise on the plan (the stored sense). */
export function rotateAbout<T extends Oriented>(stall: T, centre: Point, cwDegrees: number): T {
  const p = rotate({ x: stall.posX - centre.x, z: stall.posZ - centre.z }, cwDegrees);
  return normaliseRightAngle({
    ...stall,
    posX: centre.x + p.x,
    posZ: centre.z + p.z,
    rotation: (stall.rotation ?? 0) + cwDegrees
  });
}

/** Mirror a stall in the line a-b. */
export function mirrorIn<T extends Oriented>(stall: T, a: Point, b: Point): T {
  const len = dist(a, b);
  if (len < 1e-9) return stall;
  const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  const rel = { x: stall.posX - a.x, z: stall.posZ - a.z };
  const along = rel.x * u.x + rel.z * u.z;
  const reflected = { x: 2 * along * u.x - rel.x, z: 2 * along * u.z - rel.z };
  const theta = (Math.atan2(u.z, u.x) * 180) / Math.PI;

  // Reflection in a line at angle theta = rotation by 2*theta after flipping the local Z axis.
  let footprint = stall.footprint;
  let openEdges = stall.openEdges;
  if (footprint && footprint.length >= 3) {
    const n = footprint.length;
    footprint = footprint.map(p => ({ x: p.x, z: -p.z })).reverse();
    openEdges = (openEdges ?? []).map(i => (((n - 2 - i) % n) + n) % n);
  }
  const sides = stall.openSides.map(s => FLIP_Z[s]);
  return normaliseRightAngle({
    ...stall,
    posX: a.x + reflected.x,
    posZ: a.z + reflected.z,
    rotation: 2 * theta - (stall.rotation ?? 0),
    openSides: sides,
    gateSide: sides[0] ?? stall.gateSide,
    ...(footprint ? { footprint, openEdges } : {})
  });
}

// --- generating stalls ----------------------------------------------------------------------------

export interface StallSize {
  /** Frontage: the side that faces the aisle, metres. */
  width: number;
  /** Depth, metres. */
  depth: number;
}

export interface RowSpec {
  start: Point;
  end: Point;
  size: StallSize;
  /** Space between neighbouring stalls along the row. */
  gap: number;
  /** false: stalls sit to the left of the drawing direction (CAD sense); true: to the right. */
  flip: boolean;
  /** A second row behind the first, back to back, opening the other way. */
  backToBack: boolean;
}

export type NewFootprint = Footprint & { width: number; length: number; openSides: GateSide[]; gateSide: GateSide; rotation: number };

/**
 * STALLROW: the drawn line is the aisle edge. Stalls fill the line, their front opening onto it,
 * as many whole stalls as fit.
 */
export function rowFootprints(spec: RowSpec): NewFootprint[] {
  const length = dist(spec.start, spec.end);
  const { width, depth } = spec.size;
  if (length < 1e-6 || width <= 0 || depth <= 0) return [];
  const u = { x: (spec.end.x - spec.start.x) / length, z: (spec.end.z - spec.start.z) / length };
  // CAD "left" of the direction, in world axes.
  const side = spec.flip ? -1 : 1;
  const n = { x: u.z * side, z: -u.x * side };
  const count = Math.floor((length + spec.gap + 1e-6) / (width + spec.gap));
  const rotation = (Math.atan2(u.z, u.x) * 180) / Math.PI + (spec.flip ? 180 : 0);

  const out: NewFootprint[] = [];
  const place = (offset: number, turn: number) => {
    for (let i = 0; i < count; i++) {
      const along = i * (width + spec.gap) + width / 2;
      out.push(normaliseRightAngle({
        posX: spec.start.x + u.x * along + n.x * offset,
        posZ: spec.start.z + u.z * along + n.z * offset,
        width,
        length: depth,
        rotation: rotation + turn,
        openSides: ['FRONT'],
        gateSide: 'FRONT'
      }));
    }
  };
  place(depth / 2, 0);
  if (spec.backToBack) place(depth * 1.5, 180);
  return out;
}

/**
 * ISLAND: a block with aisles all round, one or two stalls deep, every stall opening onto the
 * aisle it touches (corner stalls onto two). The long side of the drawn box is the frontage.
 */
export function islandFootprints(a: Point, b: Point, size: StallSize): NewFootprint[] {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
  const horizontal = maxX - minX >= maxZ - minZ;
  const along = horizontal ? maxX - minX : maxZ - minZ;
  const across = horizontal ? maxZ - minZ : maxX - minX;
  const cols = Math.floor(along / size.width + 1e-6);
  const rows = Math.min(2, Math.floor(across / size.depth + 1e-6));
  const out: NewFootprint[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sides: GateSide[] = [];
      if (horizontal) {
        if (r === 0) sides.push('BACK');
        if (r === rows - 1) sides.push('FRONT');
        if (c === 0) sides.push('LEFT');
        if (c === cols - 1) sides.push('RIGHT');
        out.push({
          posX: clean(minX + c * size.width + size.width / 2),
          posZ: clean(minZ + r * size.depth + size.depth / 2),
          width: size.width,
          length: size.depth,
          rotation: 0,
          openSides: sides,
          gateSide: sides[0]
        });
      } else {
        if (r === 0) sides.push('LEFT');
        if (r === rows - 1) sides.push('RIGHT');
        if (c === 0) sides.push('BACK');
        if (c === cols - 1) sides.push('FRONT');
        out.push({
          posX: clean(minX + r * size.depth + size.depth / 2),
          posZ: clean(minZ + c * size.width + size.width / 2),
          width: size.depth,
          length: size.width,
          rotation: 0,
          openSides: sides,
          gateSide: sides[0]
        });
      }
    }
  }
  return out;
}

/**
 * ARRAY (rectangular): the offsets of every copy, the original (0, 0) excluded. Spacing is in
 * CAD sense: rows go up (+Y), columns go right (+X).
 */
export function arrayOffsets(rows: number, cols: number, rowSpacing: number, colSpacing: number): Point[] {
  const out: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      out.push({ x: c * colSpacing, z: -r * rowSpacing });
    }
  }
  return out;
}

/**
 * SPLIT: a rectangle into `cols` x `rows` equal parts (plan axes). Outer sides keep being open
 * where the original was open; the new inner edges are closed.
 */
export function splitFootprint(stall: Oriented, cols: number, rows: number): NewFootprint[] {
  const w = stall.width / cols, l = stall.length / rows;
  const out: NewFootprint[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sides = stall.openSides.filter(s =>
        (s === 'BACK' && r === 0) || (s === 'FRONT' && r === rows - 1) ||
        (s === 'LEFT' && c === 0) || (s === 'RIGHT' && c === cols - 1));
      const local = { x: -stall.width / 2 + w * (c + 0.5), z: -stall.length / 2 + l * (r + 0.5) };
      const p = rotate(local, stall.rotation ?? 0);
      out.push({
        posX: clean(stall.posX + p.x),
        posZ: clean(stall.posZ + p.z),
        width: clean(w),
        length: clean(l),
        rotation: stall.rotation ?? 0,
        openSides: sides.length ? sides : ['FRONT'],
        gateSide: sides[0] ?? 'FRONT'
      });
    }
  }
  return out;
}

/**
 * MERGE: unrotated rectangles that exactly tile their bounding box become one stall. Returns null
 * when they do not (a gap, an overlap, a rotated stall), so nothing is guessed.
 */
export function mergeFootprints(stalls: readonly Oriented[]): NewFootprint | null {
  if (stalls.length < 2) return null;
  if (stalls.some(s => (s.rotation ?? 0) % 360 !== 0 || (s.footprint && s.footprint.length >= 3))) return null;
  const rects = stalls.map(s => ({
    minX: s.posX - s.width / 2, maxX: s.posX + s.width / 2,
    minZ: s.posZ - s.length / 2, maxZ: s.posZ + s.length / 2
  }));
  const box = {
    minX: Math.min(...rects.map(r => r.minX)), maxX: Math.max(...rects.map(r => r.maxX)),
    minZ: Math.min(...rects.map(r => r.minZ)), maxZ: Math.max(...rects.map(r => r.maxZ))
  };
  const total = rects.reduce((a, r) => a + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
  const boxArea = (box.maxX - box.minX) * (box.maxZ - box.minZ);
  if (Math.abs(total - boxArea) > 1e-3) return null;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (ox > 1e-6 && oz > 1e-6) return null;
    }
  }
  // A side of the merged stall is open if any part stall was open on that outer side.
  const sides = new Set<GateSide>();
  stalls.forEach((s, i) => {
    const r = rects[i];
    for (const side of s.openSides) {
      if ((side === 'BACK' && Math.abs(r.minZ - box.minZ) < 1e-6) ||
          (side === 'FRONT' && Math.abs(r.maxZ - box.maxZ) < 1e-6) ||
          (side === 'LEFT' && Math.abs(r.minX - box.minX) < 1e-6) ||
          (side === 'RIGHT' && Math.abs(r.maxX - box.maxX) < 1e-6)) sides.add(side);
    }
  });
  const openSides = (['FRONT', 'RIGHT', 'BACK', 'LEFT'] as GateSide[]).filter(s => sides.has(s));
  return {
    posX: clean((box.minX + box.maxX) / 2),
    posZ: clean((box.minZ + box.maxZ) / 2),
    width: clean(box.maxX - box.minX),
    length: clean(box.maxZ - box.minZ),
    rotation: 0,
    openSides: openSides.length ? openSides : ['FRONT'],
    gateSide: openSides[0] ?? 'FRONT'
  };
}

// --- picking and selection ------------------------------------------------------------------------

export function footprintBounds(f: Footprint): Rect {
  return polygonBounds(stallPolygon(f));
}

export function boundsOfAll(list: readonly Footprint[]): Rect | null {
  if (!list.length) return null;
  const all = list.map(footprintBounds);
  return {
    minX: Math.min(...all.map(b => b.minX)), maxX: Math.max(...all.map(b => b.maxX)),
    minZ: Math.min(...all.map(b => b.minZ)), maxZ: Math.max(...all.map(b => b.maxZ))
  };
}

/** The top-most stall under a point (the last drawn wins). */
export function stallAt<T extends Footprint & { id: string | number }>(stalls: readonly T[], p: Point): T | null {
  for (let i = stalls.length - 1; i >= 0; i--) {
    if (pointInPolygon(p, stallPolygon(stalls[i]))) return stalls[i];
  }
  return null;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

const inRect = (p: Point, r: Rect) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

/**
 * AutoCAD selection: a window (dragged left to right) takes what lies entirely inside; a
 * crossing (right to left) also takes what it touches.
 */
export function selectInRect<T extends Footprint & { id: string | number }>(
  stalls: readonly T[],
  rect: Rect,
  crossing: boolean
): T[] {
  const corners: Point[] = [
    { x: rect.minX, z: rect.minZ }, { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ }, { x: rect.minX, z: rect.maxZ }
  ];
  return stalls.filter(s => {
    const poly = stallPolygon(s);
    if (poly.every(p => inRect(p, rect))) return true;
    if (!crossing) return false;
    if (poly.some(p => inRect(p, rect))) return true;
    if (corners.some(c => pointInPolygon(c, poly))) return true;
    return poly.some((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return corners.some((c, j) => segmentsCross(a, b, c, corners[(j + 1) % 4]));
    });
  });
}

// --- snapping -------------------------------------------------------------------------------------

export type SnapKind = 'endpoint' | 'midpoint' | 'grid';

export interface SnapResult {
  point: Point;
  kind: SnapKind | null;
}

/** Corners and edge midpoints that object snap can reach. */
export function snapTargets(polygons: readonly Point[][]): { ends: Point[]; mids: Point[] } {
  const ends: Point[] = [];
  const mids: Point[] = [];
  for (const poly of polygons) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      ends.push(a);
      mids.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    });
  }
  return { ends, mids };
}

/** Nearest object-snap point within `tolerance` metres. End points win over midpoints. */
export function objectSnap(p: Point, targets: { ends: Point[]; mids: Point[] }, tolerance: number): SnapResult | null {
  const nearest = (list: Point[]) => {
    let best: Point | null = null, bestD = tolerance;
    for (const t of list) {
      const d = Math.abs(t.x - p.x) + Math.abs(t.z - p.z);
      if (d <= bestD) { best = t; bestD = d; }
    }
    return best;
  };
  const end = nearest(targets.ends);
  if (end) return { point: end, kind: 'endpoint' };
  const mid = nearest(targets.mids);
  return mid ? { point: mid, kind: 'midpoint' } : null;
}

export function gridSnap(p: Point, origin: Point, step: number): Point {
  if (!(step > 0)) return p;
  return {
    x: clean(origin.x + Math.round((p.x - origin.x) / step) * step),
    z: clean(origin.z + Math.round((p.z - origin.z) / step) * step)
  };
}

/** ORTHO: keep the larger of the two deltas from the base point. */
export function orthoFrom(base: Point, p: Point): Point {
  return Math.abs(p.x - base.x) >= Math.abs(p.z - base.z) ? { x: p.x, z: base.z } : { x: base.x, z: p.z };
}

/** POLAR tracking: pull the direction onto the nearest multiple of `increment` degrees when close. */
export function polarFrom(base: Point, p: Point, increment = 45, tolerance = 4): Point {
  const d = dist(base, p);
  if (d < 1e-9) return p;
  const angle = cadAngle(base, p);
  const snapped = Math.round(angle / increment) * increment;
  if (Math.abs(angle - snapped) > tolerance) return p;
  const u = cadDirection(snapped);
  return { x: base.x + u.x * d, z: base.z + u.z * d };
}
