import type { FloorAreaKind as AreaKind, HallFloor } from '../../../core/api/api.models';
import type {
  PlanObject,
  PlanSeat,
  PlanStall,
  PlanZone,
  StallSide,
} from '../../../core/plans/plans.models';
import type { MultiPolygon, Point } from '../../../core/venues/floor-plan.models';

/**
 * Plan geometry in floor metres (origin top-left, y down), shared by the canvas and the
 * auto-fill dialogs. The server checks every change against the rules; what is here only
 * proposes, so a dialog can show what fits before asking.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPS = 1e-6;

/** Floor kinds a stall or seat may not stand on (pillars are kept clear by the dialogs). */
const BLOCKING: ReadonlySet<AreaKind> = new Set([
  'outside',
  'wall',
  'void',
  'facility',
  'unavailable',
  'passage',
  'fire_curtain',
  'no_build',
  'utility',
  'entry',
]);

export const ZONE_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export function newId(): string {
  return crypto.randomUUID();
}

export function round(n: number, step = 0.001): number {
  return Math.round(n / step) * step;
}

export function snap(n: number, step: number): number {
  return Math.round(Math.round(n / step) * step * 1000) / 1000;
}

export function polygonArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

export function pointInRing(p: Point, ring: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}

export function pointInMulti(p: Point, g: MultiPolygon): boolean {
  return g.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((r) => pointInRing(p, r)));
}

export function ringBox(ring: Point[]): Rect {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function rectRing(r: Rect): Point[] {
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ];
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap - EPS &&
    b.x < a.x + a.width + gap - EPS &&
    a.y < b.y + b.height + gap - EPS &&
    b.y < a.y + a.height + gap - EPS
  );
}

export function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/** Whether a rectangle lies inside a ring: its corners are in, and no corner of the ring is in it. */
export function rectInRing(r: Rect, ring: Point[]): boolean {
  const corners = rectRing({
    x: r.x + EPS,
    y: r.y + EPS,
    width: r.width - 2 * EPS,
    height: r.height - 2 * EPS,
  });
  if (!corners.every((c) => pointInRing(c, ring))) return false;
  return !ring.some(
    ([x, y]) =>
      x > r.x + EPS && x < r.x + r.width - EPS && y > r.y + EPS && y < r.y + r.height - EPS,
  );
}

export function stallRect(s: Pick<PlanStall, 'x' | 'y' | 'width' | 'depth'>): Rect {
  return { x: s.x, y: s.y, width: s.width, height: s.depth };
}

/** The hall as the planner sees it: where its floor is, and what blocks or stands on it. */
export interface PlannerFloor {
  width: number;
  depth: number;
  /** Outline(s) of the floor. */
  floor: MultiPolygon;
  /** Boxes of what nothing may stand on. */
  blocked: Rect[];
  /** Boxes of pillars; stalls may be built around them, seats may not. */
  pillars: Rect[];
}

export function plannerFloor(f: HallFloor): PlannerFloor {
  if (f.geometry) {
    const g = f.geometry;
    return {
      width: f.width,
      depth: f.depth,
      floor: g.boundary,
      blocked: g.objects
        .filter((o) => BLOCKING.has(o.kind as AreaKind))
        .flatMap((o) => o.geometry.map((p) => ringBox(p[0]))),
      pillars: g.objects
        .filter((o) => o.kind === 'column')
        .flatMap((o) => o.geometry.map((p) => ringBox(p[0]))),
    };
  }
  return {
    width: f.width,
    depth: f.depth,
    floor: [[rectRing({ x: 0, y: 0, width: f.width, height: f.depth })]],
    blocked: f.areas
      .filter((a) => BLOCKING.has(a.kind))
      .map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height })),
    pillars: f.areas
      .filter((a) => a.kind === 'column')
      .map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height })),
  };
}

/** Whether a rectangle stands on the floor, clear of what blocks it. */
export function onOpenFloor(r: Rect, floor: PlannerFloor): boolean {
  const ok = floor.floor.some(
    (poly) => rectInRing(r, poly[0]) && !poly.slice(1).some((hole) => ringsMeet(r, hole)),
  );
  return ok && !floor.blocked.some((b) => overlaps(r, b));
}

function ringsMeet(r: Rect, ring: Point[]): boolean {
  return overlaps(r, ringBox(ring));
}

/** The zone a point lies in, the last drawn first. */
export function zoneAt(p: Point, zones: PlanZone[]): PlanZone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (pointInRing(p, zones[i].polygon)) return zones[i];
  }
  return null;
}

export function centre(r: Rect): Point {
  return [r.x + r.width / 2, r.y + r.height / 2];
}

/** Where the hall's ways out are: entry areas and helper cards that show an exit. */
export function exitPoints(f: HallFloor): Point[] {
  const fromAreas: Point[] = f.geometry
    ? f.geometry.objects
        .filter((o) => o.kind === 'entry')
        .flatMap((o) => o.geometry.map((p) => centre(ringBox(p[0]))))
    : f.areas.filter((a) => a.kind === 'entry').map((a) => centre(a));
  const fromCards: Point[] = (f.iconGroups ?? [])
    .filter((g) => g.icons.some((i) => i.kind === 'emergency-exit'))
    .map((g) => [g.x, g.y]);
  return [...fromAreas, ...fromCards];
}

// ---- drawings -------------------------------------------------------------------------------

/** Metres a line of drawing text is tall; its width follows the text. */
export const TEXT_HEIGHT = 1;

export function segmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The box a drawing's text takes, from where it starts. */
export function textBox(o: Pick<PlanObject, 'points' | 'text'>): Rect {
  const [x, y] = o.points[0];
  const width = Math.max(1, (o.text ?? '').length) * TEXT_HEIGHT * 0.6;
  return { x, y: y - TEXT_HEIGHT / 2, width, height: TEXT_HEIGHT };
}

/** The outline a drawing is drawn and picked by; a circle as a ring of 64 points. */
export function objectOutline(o: Pick<PlanObject, 'kind' | 'points' | 'text'>): {
  points: Point[];
  closed: boolean;
} {
  const [a, b] = o.points;
  switch (o.kind) {
    case 'rect': {
      const r = {
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]),
        height: Math.abs(b[1] - a[1]),
      };
      return { points: rectRing(r), closed: true };
    }
    case 'circle': {
      const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const points = Array.from({ length: 64 }, (_, i) => {
        const t = (i / 64) * Math.PI * 2;
        return [a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)] as Point;
      });
      return { points, closed: true };
    }
    case 'text':
      return { points: rectRing(textBox(o)), closed: true };
    default:
      return { points: o.points, closed: false };
  }
}

// ---- numbering ------------------------------------------------------------------------------

/** 0 → A, 25 → Z, 26 → AA. */
export function letters(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A → 0, AA → 26. */
export function letterIndex(s: string): number {
  let n = 0;
  for (const c of s.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export type NumberStyle = 'numbers' | 'letters';

/**
 * Stall numbers under one island, from `start` (blank: after the highest already used), skipping
 * any taken.
 */
export function stallNumbers(
  stalls: PlanStall[],
  island: string | null,
  style: NumberStyle,
  count: number,
  start: string,
): string[] {
  const taken = new Set(
    stalls
      .filter((s) => (s.islandNumber ?? '') === (island ?? ''))
      .map((s) => s.stallNumber.toUpperCase()),
  );
  const value = (s: string) => (style === 'numbers' ? Number(s) : letterIndex(s));
  let next = 0;
  if (start.trim()) {
    next =
      style === 'numbers'
        ? Math.max(1, Math.floor(Number(start)) || 1)
        : Math.max(0, letterIndex(start.trim()));
  } else {
    const used = [...taken]
      .filter((s) => (style === 'numbers' ? /^\d+$/.test(s) : /^[A-Z]+$/.test(s)))
      .map(value);
    next = used.length ? Math.max(...used) + 1 : style === 'numbers' ? 1 : 0;
  }
  const out: string[] = [];
  while (out.length < count) {
    const label = style === 'numbers' ? String(next) : letters(next);
    if (!taken.has(label)) out.push(label);
    next++;
  }
  return out;
}

// ---- auto booths ----------------------------------------------------------------------------

export interface BoothFill {
  /** Where to fill: a zone's outline, or the hall's. */
  region: Point[];
  width: number;
  depth: number;
  aisle: number;
  margin: number;
  /** Most booths; null: as many as fit. */
  count: number | null;
  pillarClearance: number;
  /** Try grid offsets so booths sit between pillars. */
  shiftForPillars: boolean;
  /** Keep booths that have a pillar in them. */
  sellPillarStands: boolean;
}

/**
 * Booths on a grid with an aisle between each, inside the region and on open floor, clear of
 * stalls and seats already there. Rows run from the top-left.
 */
export function fillBooths(
  fill: BoothFill,
  floor: PlannerFloor,
  stalls: PlanStall[],
  seats: PlanSeat[],
): Rect[] {
  const box = ringBox(fill.region);
  const stepX = fill.width + fill.aisle;
  const stepY = fill.depth + fill.aisle;
  if (fill.width <= 0 || fill.depth <= 0 || stepX <= 0 || stepY <= 0) return [];
  const taken = [...stalls.map(stallRect), ...seats.map(stallRect)];
  const pillars = floor.pillars.map((p) => grow(p, fill.pillarClearance));
  const place = (ox: number, oy: number): Rect[] => {
    const out: Rect[] = [];
    const x0 = box.x + fill.margin + ox;
    const y0 = box.y + fill.margin + oy;
    for (let y = y0; y + fill.depth <= box.y + box.height - fill.margin + EPS; y += stepY) {
      for (let x = x0; x + fill.width <= box.x + box.width - fill.margin + EPS; x += stepX) {
        const r = { x: round(x), y: round(y), width: fill.width, height: fill.depth };
        if (!rectInRing(fill.margin > 0 ? grow(r, fill.margin - EPS) : r, fill.region)) continue;
        if (!onOpenFloor(r, floor)) continue;
        if (taken.some((t) => overlaps(r, t))) continue;
        if (!fill.sellPillarStands && pillars.some((p) => overlaps(r, p))) continue;
        out.push(r);
        if (fill.count !== null && out.length >= fill.count) return out;
      }
    }
    return out;
  };
  let best = place(0, 0);
  if (fill.shiftForPillars && floor.pillars.length && !fill.sellPillarStands) {
    // Half-metre steps across one period of the grid; the offset that fits most wins.
    for (let ox = 0; ox < stepX - EPS; ox += 0.5) {
      for (let oy = 0; oy < stepY - EPS; oy += 0.5) {
        if (!ox && !oy) continue;
        const tried = place(ox, oy);
        if (tried.length > best.length) best = tried;
      }
    }
  }
  return best;
}

// ---- seats ----------------------------------------------------------------------------------

export type Front = 'top' | 'bottom' | 'left' | 'right';

export interface SeatBlock {
  rows: number;
  perRow: number;
  width: number;
  depth: number;
  gap: number;
  rowGap: number;
}

/** A block of seats with its top-left at (x, y); rows go down, seats left to right. */
export function seatBlock(
  b: SeatBlock,
  x: number,
  y: number,
): Array<Rect & { row: number; seat: number }> {
  const out: Array<Rect & { row: number; seat: number }> = [];
  for (let r = 0; r < b.rows; r++) {
    for (let s = 0; s < b.perRow; s++) {
      out.push({
        x: round(x + s * (b.width + b.gap)),
        y: round(y + r * (b.depth + b.rowGap)),
        width: b.width,
        height: b.depth,
        row: r,
        seat: s + 1,
      });
    }
  }
  return out;
}

export function blockSize(b: SeatBlock): { width: number; depth: number } {
  return {
    width: b.perRow * b.width + Math.max(0, b.perRow - 1) * b.gap,
    depth: b.rows * b.depth + Math.max(0, b.rows - 1) * b.rowGap,
  };
}

export interface SeatFill {
  region: Point[];
  width: number;
  depth: number;
  gap: number;
  rowGap: number;
  /** An aisle after every this many seats in a row; 0: none. */
  aisleEvery: number;
  aisleWidth: number;
  front: Front;
  most: number;
  /** Kept from stalls, walls and what blocks, metres. */
  clearance: number;
}

/**
 * Seats filling a region in rows facing the front, numbered from 1 in each row, rows counted
 * from the front. Seats that would stand on something are left out, leaving gaps.
 */
export function fillSeats(
  fill: SeatFill,
  floor: PlannerFloor,
  stalls: PlanStall[],
  seats: PlanSeat[],
): Array<Rect & { row: number; seat: number }> {
  const box = ringBox(fill.region);
  const sideways = fill.front === 'left' || fill.front === 'right';
  // Work in the front's frame: u along a row, v away from the front. A seat is `width` along
  // its row and `depth` away from the front; facing sideways, it is turned on the floor.
  const along = sideways ? box.height : box.width;
  const away = sideways ? box.width : box.height;
  const [sw, sd] = [fill.width, fill.depth];
  const [rw, rh] = sideways ? [fill.depth, fill.width] : [fill.width, fill.depth];
  const c = fill.clearance;
  const keepOut = [
    ...floor.blocked,
    ...floor.pillars,
    ...stalls.map(stallRect),
    ...seats.map(stallRect),
  ].map((r) => grow(r, c));
  const out: Array<Rect & { row: number; seat: number }> = [];
  let row = 0;
  for (let v = c; v + sd <= away - c + EPS && out.length < fill.most; v += sd + fill.rowGap) {
    let seat = 0;
    let inRow = 0;
    let placedInRow = 0;
    for (let u = c; u + sw <= along - c + EPS && out.length < fill.most;) {
      const [lx, ly] = sideways ? [v, u] : [u, v];
      // Rows from the front: flip the axis when the front is at the bottom or right.
      const x = fill.front === 'right' ? box.x + box.width - lx - rw : box.x + lx;
      const y = fill.front === 'bottom' ? box.y + box.height - ly - rh : box.y + ly;
      const r = { x: round(x), y: round(y), width: rw, height: rh };
      seat++;
      if (
        rectInRing(r, fill.region) &&
        onFloorOnly(r, floor) &&
        !keepOut.some((k) => overlaps(r, k))
      ) {
        out.push({ ...r, row, seat });
        placedInRow++;
      }
      inRow++;
      u += sw + fill.gap;
      if (fill.aisleEvery > 0 && inRow % fill.aisleEvery === 0) u += fill.aisleWidth - fill.gap;
    }
    if (placedInRow) row++;
  }
  return out;
}

function onFloorOnly(r: Rect, floor: PlannerFloor): boolean {
  return floor.floor.some((poly) => rectInRing(r, poly[0]));
}

/** Rows already used, so new seats continue after them. */
export function nextRow(seats: PlanSeat[]): number {
  return seats.length ? Math.max(...seats.map((s) => letterIndex(s.rowLabel))) + 1 : 0;
}

/** Open sides of a new stall: the side facing the aisle in front of it. */
export const DEFAULT_OPEN: StallSide[] = ['bottom'];
