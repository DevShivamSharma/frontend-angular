import { planBounds } from '../geometry/hall-plan';
import { interiorPoint, isCustomStall, stallArea, stallSizeText } from '../geometry/footprint-view';
import { polygonBounds, type Point, type Rect } from '../geometry/placement-rules';
import { openEdgeList, stallPolygon } from '../geometry/polygon-geometry';
import type { Hall } from '../models/hall.model';
import type { GateSide, Stall } from '../models/stall.model';

/**
 * What the exhibitor view shows of a saved layout, derived from the saved stalls only: the exact
 * outline (rotation and custom shapes included), which sides are open, size, area and the label
 * placement. Nothing here is invented: a value the layout does not hold is left out.
 */

export interface ExhibitorStall {
  /** `String(stall.id)`, for selection. */
  id: string;
  stall: Stall;
  name: string;
  /** World outline in plan metres (x right, z down), as `stallPolygon` gives it. */
  outline: Point[];
  /** Every edge of `outline`: open (customer-facing) or closed (a wall). */
  edges: Array<{ a: Point; b: Point; open: boolean }>;
  bounds: Rect;
  area: number;
  sizeText: string;
  /** Inline / corner / peninsula / island, from the saved open sides. */
  kind: StallKind;
  size: SizeBucket;
  /** "Corner · 2 open sides". */
  frontage: string;
  available: boolean;
  label: StallLabel;
}

/** Where the stall name goes: inside the shape, turned upright when the stall is tall and narrow. */
export interface StallLabel {
  at: Point;
  /** Font size in metres. */
  font: number;
  vertical: boolean;
}

/** How many sides face an aisle, in the names exhibitors know from trade-show plans. */
export type StallKind = 'INLINE' | 'CORNER' | 'OPPOSITE' | 'PENINSULA' | 'ISLAND' | 'OTHER';

export const STALL_KINDS: ReadonlyArray<{ kind: StallKind; label: string }> = [
  { kind: 'INLINE', label: 'Inline' },
  { kind: 'CORNER', label: 'Corner' },
  { kind: 'OPPOSITE', label: 'Opposite sides' },
  { kind: 'PENINSULA', label: 'Peninsula' },
  { kind: 'ISLAND', label: 'Island' },
  { kind: 'OTHER', label: 'Other shapes' }
];

/** Floor-area bands for filtering; 12 m² is the standard shell-scheme stall. */
export type SizeBucket = 'SMALL' | 'MEDIUM' | 'LARGE';

export const SIZE_BUCKETS: ReadonlyArray<{ bucket: SizeBucket; label: string; maxArea: number }> = [
  { bucket: 'SMALL', label: 'Up to 12 m²', maxArea: 12 },
  { bucket: 'MEDIUM', label: '12–30 m²', maxArea: 30 },
  { bucket: 'LARGE', label: 'Over 30 m²', maxArea: Infinity }
];

export function sizeBucket(area: number): SizeBucket {
  return SIZE_BUCKETS.find(b => area <= b.maxArea)!.bucket;
}

export interface StallFilters {
  query: string;
  onlyAvailable: boolean;
  /** Empty: every size. */
  sizes: ReadonlySet<SizeBucket>;
  /** Empty: every kind. */
  kinds: ReadonlySet<StallKind>;
}

export function matchesFilters(stall: ExhibitorStall, f: StallFilters): boolean {
  return (!f.onlyAvailable || stall.available) &&
    (!f.sizes.size || f.sizes.has(stall.size)) &&
    (!f.kinds.size || f.kinds.has(stall.kind)) &&
    matchesQuery(stall, f.query);
}

/** Cancelled stalls are not on offer (a split parent is cancelled and replaced by its parts). */
export function exhibitorStalls(stalls: readonly Stall[]): ExhibitorStall[] {
  return stalls
    .filter(s => s.status !== 'CANCELLED')
    .map(toExhibitorStall)
    .sort((a, b) => byName(a.name, b.name));
}

export function toExhibitorStall(stall: Stall): ExhibitorStall {
  const outline = stallPolygon(stall);
  const open = new Set(openEdgeList(stall).map(e => e.index));
  const bounds = polygonBounds(outline);
  const kind = stallKind(stall, open.size);
  const area = stallArea(stall);
  return {
    id: String(stall.id),
    stall,
    name: stall.name,
    outline,
    edges: outline.map((a, i) => ({ a, b: outline[(i + 1) % outline.length], open: open.has(i) })),
    bounds,
    area,
    sizeText: stallSizeText(stall),
    kind,
    size: sizeBucket(area),
    frontage: frontageText(kind, open.size),
    available: stall.status === 'AVAILABLE',
    label: stallLabel(stall.name, outline, bounds),
  };
}

/** The kind from the open sides. Custom (e.g. L-shaped) outlines have no trade-show name. */
export function stallKind(stall: Pick<Stall, 'footprint' | 'openSides'>, openCount: number): StallKind {
  if (isCustomStall(stall)) return 'OTHER';
  const has = (side: GateSide) => stall.openSides.includes(side);
  switch (openCount) {
    case 1: return 'INLINE';
    case 2: return (has('FRONT') && has('BACK')) || (has('LEFT') && has('RIGHT')) ? 'OPPOSITE' : 'CORNER';
    case 3: return 'PENINSULA';
    case 4: return 'ISLAND';
    default: return 'OTHER';
  }
}

export function frontageText(kind: StallKind, openCount: number): string {
  const sides = `${openCount} open ${openCount === 1 ? 'side' : 'sides'}`;
  switch (kind) {
    case 'INLINE': return `Inline · ${sides}`;
    case 'CORNER': return `Corner · ${sides}`;
    case 'OPPOSITE': return `Open on opposite sides · ${sides}`;
    case 'PENINSULA': return `Peninsula · ${sides}`;
    case 'ISLAND': return 'Island · all sides open';
    default: return openCount ? sides : 'No open side';
  }
}

export function kindLabel(kind: StallKind): string {
  return STALL_KINDS.find(k => k.kind === kind)!.label;
}

/**
 * The largest name that fits the stall (about 0.6 em per character), at most 1.1 m high. A
 * narrow, tall stall gets its name turned upright when that makes it noticeably larger.
 */
export function stallLabel(name: string, outline: Point[], bounds: Rect): StallLabel {
  const w = bounds.maxX - bounds.minX;
  const l = bounds.maxZ - bounds.minZ;
  const chars = Math.max(name.length, 3) * 0.6;
  const across = Math.min(1.1, (w * 0.86) / chars, l * 0.42);
  const upright = Math.min(1.1, (l * 0.86) / chars, w * 0.42);
  const vertical = upright > across * 1.15;
  return { at: interiorPoint(outline), font: vertical ? upright : across, vertical };
}

/** "12A-2 B" before "12A-10 A": names compared with their numbers as numbers. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Search by stall name or stall number, ignoring case and spaces. */
export function matchesQuery(stall: ExhibitorStall, query: string): boolean {
  const q = squash(query);
  return !q || squash(stall.name).includes(q) || squash(stall.stall.stallNumber ?? '').includes(q);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/**
 * The part of the plan to frame: the hall's geometry, every stall, and the gate captions, icons
 * and north arrow around it, plus a margin.
 */
export function planFrame(hall: Hall, stalls: readonly ExhibitorStall[], margin = 3): Rect {
  const r = { ...planBounds(hall) };
  const grow = (minX: number, minZ: number, maxX: number, maxZ: number): void => {
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) return;
    r.minX = Math.min(r.minX, minX);
    r.minZ = Math.min(r.minZ, minZ);
    r.maxX = Math.max(r.maxX, maxX);
    r.maxZ = Math.max(r.maxZ, maxZ);
  };
  for (const s of stalls) grow(s.bounds.minX, s.bounds.minZ, s.bounds.maxX, s.bounds.maxZ);
  // Gate captions are top-left anchored; ~0.45 m per character at their 0.75 m font.
  for (const m of hall.markers ?? []) {
    grow(m.position?.x, m.position?.z, m.position?.x + String(m.text ?? '').length * 0.45, m.position?.z + 1);
  }
  for (const a of hall.amenities ?? []) grow(a.position?.x - 2, a.position?.z - 1.5, a.position?.x + 2, a.position?.z + 2.5);
  const c = hall.compass;
  if (c) {
    const half = (c.size > 0 ? c.size : 5) / 2;
    grow(c.position?.x - half, c.position?.z - half, c.position?.x + half, c.position?.z + half);
  }
  return { minX: r.minX - margin, minZ: r.minZ - margin, maxX: r.maxX + margin, maxZ: r.maxZ + margin };
}
