import { MapNode } from './venue-route-graph';
import { Adjacency } from './venue-route-pathfinding';

/** Route geometry, ported from the ITPO app's routeGeometry.ts, in world x/z metres. */
export interface Point { x: number; z: number; }
export interface RouteSegment { x0: number; z0: number; x: number; z: number; d0: number; d: number; length: number; }
export interface RouteGeometry { points: Point[]; segments: RouteSegment[]; totalLength: number; }

/**
 * The walked polyline for a node path, following each edge's traced walkway. A hall or amenity is joined to
 * the network by a straight link into its centre; the drawn route stops where that link leaves the walkway,
 * at the building's frontage, so it never crosses a roof.
 */
export function journeyPolyline(path: string[], adjacency: Adjacency, nodeMap: Record<string, MapNode>): Point[] {
  const out: Point[] = [];
  const isBuilding = (id: string) => nodeMap[id]?.category === 'hall' || nodeMap[id]?.category === 'amenity';
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i];
    const entry = adjacency[from]?.find(item => item.nodeId === to);
    if (!entry) continue;
    if (entry.edge.kind === 'link' && ((i === 1 && isBuilding(from)) || (i === path.length - 1 && isBuilding(to)))) continue;
    let points = entry.edge.points?.map(([x, z]) => ({ x, z })) ?? [nodeMap[from], nodeMap[to]].map(n => ({ x: n.x, z: n.z }));
    if (entry.edge.from !== from) points = points.reverse();
    for (const p of points) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.z - out[out.length - 1].z) > 1e-3) out.push(p);
  }
  // Where an edge runs past a junction without stopping there (j66-j24 passes j25), the node path goes out along a
  // spur and back over the same line. Cut every such loop: from a point back to where the line last touched it.
  for (let i = 0; i < out.length; i++) for (let j = out.length - 1; j > i + 1; j--)
    if (Math.hypot(out[j].x - out[i].x, out[j].z - out[i].z) < 1) { out.splice(i + 1, j - i); break; }
  return out;
}

/** venue-walkways.json `satellite`: the z18 tiles the satellite image is stitched from, and its pixel fit to world X/Z. */
export interface SatelliteFit { zoom: number; tileOrigin: [number, number]; tileSize: number; fit: { x: number[]; z: number[] }; }

/** World X/Z of a latitude / longitude: Web Mercator pixels on the satellite image, then the image's fit. */
export function worldFromLatLon(lat: number, lon: number, { zoom, tileOrigin, tileSize, fit }: SatelliteFit): Point {
  const n = 2 ** zoom, px = ((lon + 180) / 360 * n - tileOrigin[0]) * tileSize;
  const py = ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileOrigin[1]) * tileSize;
  return { x: fit.x[0] * px + fit.x[1] * py + fit.x[2], z: fit.z[0] * px + fit.z[1] * py + fit.z[2] };
}

/** Annotate a polyline with cumulative distances; zero-length segments are dropped. */
export function buildRouteGeometry(points: Point[]): RouteGeometry {
  const segments: RouteSegment[] = [], kept: Point[] = [];
  let cumulative = 0;
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (!previous) { kept.push(point); continue; }
    const length = Math.hypot(point.x - previous.x, point.z - previous.z);
    if (length < 1e-6) continue;
    segments.push({ x0: previous.x, z0: previous.z, x: point.x, z: point.z, d0: cumulative, d: cumulative + length, length });
    cumulative += length; kept.push(point);
  }
  return { points: kept, segments, totalLength: cumulative };
}

/** The point `distance` along the route, with the heading (radians about +y, three.js yaw) of its segment. */
export function positionAtDistance(geometry: RouteGeometry, distance: number, out: { x: number; z: number; yaw: number }) {
  const { segments } = geometry;
  if (!segments.length) return null;
  const clamped = Math.max(0, Math.min(distance, geometry.totalLength));
  let lo = 0, hi = segments.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (segments[mid].d < clamped) lo = mid + 1; else hi = mid; }
  const s = segments[lo], t = (clamped - s.d0) / s.length;
  out.x = s.x0 + (s.x - s.x0) * t; out.z = s.z0 + (s.z - s.z0) * t; out.yaw = Math.atan2(s.x - s.x0, s.z - s.z0);
  return out;
}

/**
 * Round the corners, as the app's buildRoundedPath does for its SVG track: each corner becomes a quadratic
 * curve whose radius is capped at half the shorter adjoining segment, so it stays inside the polyline.
 */
export function roundCorners(points: Point[], radius: number, steps = 6): Point[] {
  if (points.length < 3 || radius <= 0) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1], corner = points[i], next = points[i + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.z - previous.z), outLength = Math.hypot(next.x - corner.x, next.z - corner.z);
    if (inLength < 1e-6 || outLength < 1e-6) continue;
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const entry = { x: corner.x + (previous.x - corner.x) / inLength * r, z: corner.z + (previous.z - corner.z) / inLength * r };
    const exit = { x: corner.x + (next.x - corner.x) / outLength * r, z: corner.z + (next.z - corner.z) / outLength * r };
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      out.push({ x: a * entry.x + b * corner.x + c * exit.x, z: a * entry.z + b * corner.z + c * exit.z });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
