import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { Footprint, Point } from './placement-rules';

// The package's runtime export is a CommonJS object; Vite exposes it as the default.
const { difference, intersection } = polygonClipping;

export const EPS = 1e-6;
export const ring = (p: Point[]): Polygon => [[...p, p[0]].map(v => [v.x, v.z])];
export const edges = (p: Point[]): [Point, Point][] => p.map((a, i) => [a, p[(i + 1) % p.length]]);
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.z * b.z;
export function area(p: MultiPolygon): number {
  return p.reduce((total, poly) => total + poly.reduce((sum, r, i) => {
    const a = Math.abs(r.reduce((s, v, j) => {
      const w = r[(j + 1) % r.length];
      return s + v[0] * w[1] - v[1] * w[0];
    }, 0)) / 2;
    return sum + (i === 0 ? a : -a);
  }, 0), 0);
}
export function overlaps(a: Point[], b: Point[]): boolean {
  return area(intersection(ring(a), ring(b))) > EPS * EPS;
}
export function contained(p: Point[], floor: MultiPolygon): boolean {
  return area(difference(ring(p), floor)) <= EPS * EPS;
}
export function rotate(p: Point, degrees: number): Point {
  const t = degrees * Math.PI / 180;
  return { x: p.x * Math.cos(t) - p.z * Math.sin(t), z: p.x * Math.sin(t) + p.z * Math.cos(t) };
}
export function stallPolygon(f: Footprint): Point[] {
  if (f.footprint && f.footprint.length >= 3) {
    return f.footprint.map(v => {
      const p = rotate(v, f.rotation ?? 0);
      return { x: p.x + f.posX, z: p.z + f.posZ };
    });
  }
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
    const p = rotate({ x: x * f.width / 2, z: z * f.length / 2 }, f.rotation ?? 0);
    return { x: p.x + f.posX, z: p.z + f.posZ };
  });
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return Math.hypot(p.x - a.x - t * ab.x, p.z - a.z - t * ab.z);
}
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (u: Point, v: Point) => u.x * v.z - u.z * v.x;
  const ab = sub(b, a), cd = sub(d, c), ac = sub(c, a);
  const den = cross(ab, cd);
  if (Math.abs(den) > EPS * EPS) {
    const t = cross(ac, cd) / den, u = cross(ac, ab) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
export function distance(a: Point[], b: Point[]): number {
  return Math.min(...edges(a).flatMap(([p, q]) => edges(b).map(([r, s]) => segmentDistance(p, q, r, s))));
}
export function closestPoints(a: Point[], b: Point[]): [Point, Point] {
  let best: [Point, Point] = [a[0], b[0]], gap = Infinity;
  const consider = (p: Point, c: Point, d: Point, reverse: boolean) => {
    const cd = sub(d, c), t = Math.max(0, Math.min(1, dot(sub(p, c), cd) / dot(cd, cd)));
    const q = { x: c.x + t * cd.x, z: c.z + t * cd.z }, next = Math.hypot(p.x - q.x, p.z - q.z);
    if (next < gap) { gap = next; best = reverse ? [q, p] : [p, q]; }
  };
  for (const p of a) for (const [c, d] of edges(b)) consider(p, c, d, false);
  for (const p of b) for (const [c, d] of edges(a)) consider(p, c, d, true);
  return best;
}
/** Exact segment containment: split at every ring crossing, including narrow notches/holes. */
export function segmentInsideFloor(a: Point, b: Point, floor: MultiPolygon): boolean {
  const rings = floor.map(poly => poly.map(r => r.map(([x, z]) => ({ x, z }))));
  const on = (p: Point, r: Point[]) => edges(r).some(([c, d]) => pointSegmentDistance(p, c, d) <= EPS);
  const inside = (p: Point, r: Point[]) => {
    let result = false;
    for (const [c, d] of edges(r)) if ((c.z > p.z) !== (d.z > p.z) && p.x < (d.x - c.x) * (p.z - c.z) / (d.z - c.z) + c.x) result = !result;
    return result;
  };
  const usable = (p: Point) => rings.some(poly => (on(p, poly[0]) || inside(p, poly[0])) && poly.slice(1).every(h => on(p, h) || !inside(p, h)));
  const ab = sub(b, a), cuts = [0, 1];
  for (const poly of rings) for (const r of poly) for (const [c, d] of edges(r)) {
    const cd = sub(d, c), ac = sub(c, a), den = ab.x * cd.z - ab.z * cd.x;
    if (Math.abs(den) <= EPS * EPS) continue;
    const t = (ac.x * cd.z - ac.z * cd.x) / den, u = (ac.x * ab.z - ac.z * ab.x) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  return usable(a) && usable(b) && cuts.slice(1).every((t, i) => {
    const m = (t + cuts[i]) / 2;
    return usable({ x: a.x + m * ab.x, z: a.z + m * ab.z });
  });
}
export const sideIndexes: Record<string, number> = { BACK: 0, RIGHT: 1, FRONT: 2, LEFT: 3 };
export function normal(p: Point[], side: number): Point {
  const a = p[side], b = p[(side + 1) % p.length], size = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.z - a.z) / size, z: -(b.x - a.x) / size };
}
export function corridor(p: Point[], side: number, width: number): Point[] {
  const a = p[side], b = p[(side + 1) % p.length], n = normal(p, side);
  return [a, b, { x: b.x + n.x * width, z: b.z + n.z * width },
    { x: a.x + n.x * width, z: a.z + n.z * width }];
}
export function openSides(f: Footprint): string[] {
  return f.openSides?.length ? f.openSides : [f.gateSide ?? 'FRONT'];
}
/**
 * Every open frontage as an edge of `stallPolygon(f)`: a rectangle's open sides (BACK = edge 0,
 * RIGHT = 1, FRONT = 2, LEFT = 3), or a custom stall's `openEdges`. `label` names it in messages.
 */
export function openEdgeList(f: Footprint): Array<{ index: number; label: string }> {
  if (f.footprint && f.footprint.length >= 3) {
    return (f.openEdges ?? [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < f.footprint!.length)
      .map(i => ({ index: i, label: `Edge ${i + 1}` }));
  }
  return openSides(f).map(side => ({ index: sideIndexes[side], label: side }));
}
/** Positive-length shared edge; the single open normals must point away from it. */
export function backToBack(a: Footprint, b: Footprint): boolean {
  const ap = stallPolygon(a), bp = stallPolygon(b), as = openEdgeList(a), bs = openEdgeList(b);
  if (as.length !== 1 || bs.length !== 1) return false;
  const an = normal(ap, as[0].index), bn = normal(bp, bs[0].index);
  if (dot(an, bn) > -1 + EPS) return false;
  return edges(ap).some(([p, q], i) => edges(bp).some(([r, s], j) => {
    const tangent = sub(q, p), len = Math.hypot(tangent.x, tangent.z);
    const unit = { x: tangent.x / len, z: tangent.z / len };
    const n = normal(ap, i);
    if (dot(n, normal(bp, j)) > -1 + EPS || dot(an, n) > -1 + EPS) return false;
    if (Math.abs(dot(sub(r, p), n)) > EPS || Math.abs(dot(sub(s, p), n)) > EPS) return false;
    const lo = Math.min(dot(sub(r, p), unit), dot(sub(s, p), unit));
    const hi = Math.max(dot(sub(r, p), unit), dot(sub(s, p), unit));
    return Math.min(len, hi) - Math.max(0, lo) > EPS;
  }));
}
