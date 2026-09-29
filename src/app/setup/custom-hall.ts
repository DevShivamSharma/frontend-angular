import type { HallOpening, Point } from '../planner/geometry/placement-rules';
import { parseHallIdentity } from '../shared/hall-identity';
import type { HallDraft, ImportedAmenity } from './setup.models';

/**
 * Halls made from any area of an uploaded plan: an area the user picks or draws when none of
 * the suggested outlines fits. Everything comes from the plan's overview (one frame for the
 * whole drawing), cut to the chosen outline and re-centred on it, like the server's own drafts.
 */

/** Facilities and labels this far outside the outline still belong to it (service cores). */
const MARGIN_M = 12;
const MAX_SEGMENTS = 20_000;

export function draftFromArea(overview: HallDraft, polygon: Point[], id: string, label: string): HallDraft {
  const box = boundsOf(polygon);
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const shift = (p: Point): Point => ({ x: round(p.x - cx), z: round(p.z - cz) });
  const near = (p: Point, margin = MARGIN_M) =>
    p.x >= box.minX - margin && p.x <= box.maxX + margin && p.z >= box.minZ - margin && p.z <= box.maxZ + margin;

  const boundary = polygon.map(shift);
  const amenities: ImportedAmenity[] = overview.amenities
    .filter(a => near(a.position))
    .map(a => ({ ...a, id: `${id}-${a.id}`, position: shift(a.position) }));
  const markers = overview.markers.filter(m => near(m.position)).map(m => ({ ...m, position: shift(m.position) }));
  const zones = overview.zones
    .filter(z => pointInPolygon(centroid(z.polygon), polygon))
    .map((z, i) => ({ ...z, id: `z-${i + 1}`, polygon: z.polygon.map(shift) }));
  const blockedAreas = overview.blockedAreas
    .filter(b => pointInPolygon({ x: b.posX, z: b.posZ }, polygon))
    .map(b => ({ ...b, posX: round(b.posX - cx), posZ: round(b.posZ - cz) }));

  const linework: number[] = [];
  const l = overview.linework;
  for (let i = 0; i < l.length && linework.length < MAX_SEGMENTS * 4; i += 4) {
    if (!near({ x: l[i], z: l[i + 1] }, 20) || !near({ x: l[i + 2], z: l[i + 3] }, 20)) continue;
    linework.push(round(l[i] - cx), round(l[i + 1] - cz), round(l[i + 2] - cx), round(l[i + 3] - cz));
  }

  // The hall's own title, when one stands inside the outline ("EXHIBITION HALL - 7").
  // Titles often stand just outside the floor they name, so the nearest one within the margin.
  // "TOWARDS HALL-6", "FROM GATE-10 ... HALL 7" point to other halls: never this one's name.
  const direction = /^\s*(to|towards|from|via)\b|passage\s+to|\bto\s+hall|\bway\s+to\b/i;
  const title = markers
    .filter(m => !direction.test(m.text) && parseHallIdentity(hallText(m.text)))
    .sort((a, b) => Number(pointInPolygon(b.position, boundary)) - Number(pointInPolygon(a.position, boundary)) || Math.hypot(a.position.x, a.position.z) - Math.hypot(b.position.x, b.position.z))[0];
  const identity = title ? parseHallIdentity(hallText(title.text)) : null;

  return {
    id,
    outlineLabel: label,
    name: identity ? `Hall ${identity.halls.join('-')}${identity.floor ? ' ' + identity.floor : ''}` : 'New hall',
    width: round(box.maxX - box.minX),
    length: round(box.maxZ - box.minZ),
    areaM2: Math.round(polygonArea(polygon)),
    boundary,
    amenities,
    markers,
    openings: openingsFor(amenities, boundary),
    zones,
    blockedAreas,
    legends: overview.legends,
    compass: overview.compass ? { ...overview.compass, position: shift(overview.compass.position) } : null,
    linework,
    origin: { x: round(cx + overview.origin.x), z: round(cz + overview.origin.z) }
  };
}

const OPENING_KIND: Record<string, HallOpening['kind']> = {
  'entry-up': 'ENTRY',
  'emergency-exit': 'EMERGENCY',
  'cargo-truck': 'SERVICE'
};

/**
 * Entries, exits and cargo gates on (or right by) the outline, as doors in the hall wall facing
 * into the hall. The same rule the server applies, so an edited or drawn outline keeps its doors.
 */
export function openingsFor(amenities: Array<{ kind: string; label: string; position: Point }>, boundary: Point[]): HallOpening[] {
  const openings: HallOpening[] = [];
  if (boundary.length < 3) return openings;
  for (const a of amenities) {
    const kind = OPENING_KIND[a.kind];
    if (!kind) continue;
    let best: { distance: number; x: number; z: number; edge: number } | null = null;
    for (let i = 0; i < boundary.length; i++) {
      const hit = closestOnSegment(a.position, boundary[i], boundary[(i + 1) % boundary.length]);
      if (!best || hit.distance < best.distance) best = { ...hit, edge: i };
    }
    if (!best || best.distance > 6) continue;
    const position = { x: round(best.x), z: round(best.z) };
    if (openings.some(o => Math.hypot(o.position.x - position.x, o.position.z - position.z) < 3)) continue;
    const p = boundary[best.edge];
    const q = boundary[(best.edge + 1) % boundary.length];
    openings.push({
      id: `o-${openings.length + 1}`,
      label: a.label,
      kind,
      position,
      width: kind === 'EMERGENCY' ? 2 : 4,
      facing: inwardFacing(p, q, position, boundary)
    });
  }
  return openings;
}

function inwardFacing(p: Point, q: Point, at: Point, boundary: Point[]): HallOpening['facing'] {
  const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  let nx = -(q.z - p.z) / len;
  let nz = (q.x - p.x) / len;
  if (!pointInPolygon({ x: at.x + nx * 0.5, z: at.z + nz * 0.5 }, boundary)) {
    nx = -nx;
    nz = -nz;
  }
  if (Math.abs(nx) >= Math.abs(nz)) return nx > 0 ? 'EAST' : 'WEST';
  return nz > 0 ? 'SOUTH' : 'NORTH';
}

/**
 * Why an outline cannot be saved, or null when it is fine: at least three corners, some area,
 * and no edges crossing each other.
 */
export function outlineProblem(points: Point[]): string | null {
  if (points.length < 3) return 'The outline needs at least three corners.';
  if (polygonArea(points) < 1) return 'The outline has no area.';
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
        return 'The outline crosses itself. Move the corner points so its edges do not cross.';
      }
    }
  }
  return null;
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function boundsOf(points: Point[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)),
    maxZ: Math.max(...points.map(p => p.z))
  };
}

export function closestOnSegment(p: Point, a: Point, b: Point): { distance: number; x: number; z: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = dx * dx + dz * dz;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len));
  const x = a.x + t * dx;
  const z = a.z + t * dz;
  return { distance: Math.hypot(p.x - x, p.z - z), x, z };
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    z: points.reduce((s, p) => s + p.z, 0) / points.length
  };
}

/** "EXHIBITION HALL - 7 GROUND FLOOR" -> "HALL-7 GF", which parseHallIdentity reads. */
function hallText(text: string): string {
  const m = /\bhall\s*[-–#]?\s*(\d{1,2}\s*[a-z]?)\b/i.exec(text);
  if (!m) return '';
  const floor = /ground\s*floor|\bg\.?\s?f\b/i.test(text) ? ' GF' : /first\s*floor|\bf\.?\s?f\b/i.test(text) ? ' FF' : '';
  return `hall ${m[1].replace(/\s/g, '')}${floor}`;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
