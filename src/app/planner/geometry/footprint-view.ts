import type { Point } from './placement-rules';
import { polygonArea } from './stall-footprint';
import type { Stall } from '../models/stall.model';

/** True for a custom (polygon) stall with a usable outline. */
export function isCustomStall(stall: Pick<Stall, 'footprint'> | null | undefined): boolean {
  return !!stall?.footprint && stall.footprint.length >= 3;
}

/** Floor area in m²: the real outline for a custom stall (its notch excluded), else width x length. */
export function stallArea(stall: Pick<Stall, 'footprint' | 'width' | 'length'>): number {
  const area = isCustomStall(stall) ? polygonArea(stall.footprint!) : stall.width * stall.length;
  return Math.round(area * 100) / 100;
}

/** Short size text: "7 × 3 m" for a rectangle, "L-shape · 30 m²" / "Custom · 6 corners" otherwise. */
export function stallSizeText(stall: Pick<Stall, 'footprint' | 'width' | 'length'>): string {
  if (!isCustomStall(stall)) return `${stall.width} × ${stall.length} m`;
  const corners = stall.footprint!.length;
  return `${corners === 6 ? 'L-shape' : `${corners}-corner shape`} · ${stallArea(stall)} m²`;
}

/**
 * A point well inside a polygon, for labels: the centroid when it lies inside, otherwise the
 * middle of the longest horizontal run through the shape (an L's centroid can fall in its notch).
 */
export function interiorPoint(poly: Point[]): Point {
  const c = centroid(poly);
  if (inside(c, poly)) return c;
  const zs = poly.map(p => p.z);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  let best: { p: Point; len: number } = { p: c, len: -1 };
  for (let k = 1; k < 20; k++) {
    const z = minZ + ((maxZ - minZ) * k) / 20;
    const hits: number[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if ((a.z <= z) !== (b.z <= z)) hits.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
    });
    hits.sort((x, y) => x - y);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const len = hits[i + 1] - hits[i];
      if (len > best.len) best = { p: { x: (hits[i] + hits[i + 1]) / 2, z }, len };
    }
  }
  return best.p;
}

function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cz = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  });
  if (Math.abs(a) < 1e-12) return poly[0];
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

function inside(p: Point, poly: Point[]): boolean {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) result = !result;
  }
  return result;
}
