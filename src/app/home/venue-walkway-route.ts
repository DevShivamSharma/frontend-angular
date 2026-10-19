import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SiteRegistration } from './venue-site-detail';

interface WalkwayEdge { a: number; b: number; length: number; path: boolean }
interface WalkwayGraph { nodes: T.Vector2[]; edges: WalkwayEdge[]; adjacency: number[][] }
interface Snap { edge: number; point: T.Vector2; distance: number }

// Gates further than this from any walkway are left out rather than joined by a
// straight line that could cross a building.
const GATE_REACH = 40;
const ROUTE_WIDTH = 1.8, ROUTE_HEIGHT = .45;

/** Walkway centrelines in world X/Z, split at every crossing like prepare-venue-roads.cjs. */
export function buildWalkwayGraph(registration: SiteRegistration): WalkwayGraph {
  const { x, z } = registration.affine;
  const world = ([u, v]: [number, number]) => new T.Vector2(x[0] * u + x[1] * v + x[2], z[0] * u + z[1] * v + z[2]);
  const segments = (registration.walkways?.paths ?? []).flatMap(way => {
    const points = way.points.map(world);
    return points.slice(1).map((b, i) => ({ a: points[i], b, path: way.type === 'path', cuts: [0, 1] }));
  });
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const s = segments[i], o = segments[j];
    const u = s.b.clone().sub(s.a), v = o.b.clone().sub(o.a), d = u.cross(v);
    if (Math.abs(d) < 1e-8) continue;
    const q = o.a.clone().sub(s.a), t = q.cross(v) / d, w = q.cross(u) / d;
    if (t >= -1e-7 && t <= 1 + 1e-7 && w >= -1e-7 && w <= 1 + 1e-7) { s.cuts.push(T.MathUtils.clamp(t, 0, 1)); o.cuts.push(T.MathUtils.clamp(w, 0, 1)); }
  }
  const nodes: T.Vector2[] = [], edges: WalkwayEdge[] = [];
  // Snapped ends round-trip through image pixels, so merge within half a metre.
  const node = (p: T.Vector2) => {
    let i = nodes.findIndex(n => n.distanceTo(p) < .5);
    if (i < 0) { i = nodes.length; nodes.push(p); }
    return i;
  };
  for (const s of segments) {
    s.cuts.sort((a, b) => a - b);
    for (let i = 1; i < s.cuts.length; i++) {
      const a = node(s.a.clone().lerp(s.b, s.cuts[i - 1])), b = node(s.a.clone().lerp(s.b, s.cuts[i]));
      if (a !== b) edges.push({ a, b, length: nodes[a].distanceTo(nodes[b]), path: s.path });
    }
  }
  const adjacency = nodes.map(() => [] as number[]);
  edges.forEach((e, i) => { adjacency[e.a].push(i); adjacency[e.b].push(i); });
  return { nodes, edges, adjacency };
}

function snap(graph: WalkwayGraph, point: T.Vector2, pathsOnly = false): Snap | undefined {
  let best: Snap | undefined;
  const line = new T.Line3(), closest = new T.Vector3(), p = new T.Vector3(point.x, 0, point.y);
  graph.edges.forEach((e, edge) => {
    if (pathsOnly && !e.path) return;
    const a = graph.nodes[e.a], b = graph.nodes[e.b];
    line.set(new T.Vector3(a.x, 0, a.y), new T.Vector3(b.x, 0, b.y)).closestPointToPoint(p, true, closest);
    const distance = closest.distanceTo(p);
    if (!best || distance < best.distance) best = { edge, point: new T.Vector2(closest.x, closest.z), distance };
  });
  return best;
}

/** Dijkstra from the destination; returns the shortest walk from whichever gate is nearest on foot. */
export function shortestWalkwayRoute(graph: WalkwayGraph, destination: T.Vector2, gates: T.Vector2[]): T.Vector2[] | undefined {
  // End on a pedestrian walkway at the building's frontage, never inside a service yard.
  const end = snap(graph, destination, true) ?? snap(graph, destination);
  if (!end) return;
  const distance = graph.nodes.map(() => Infinity), previous = graph.nodes.map(() => -1), done = graph.nodes.map(() => false);
  const endEdge = graph.edges[end.edge];
  for (const n of [endEdge.a, endEdge.b]) distance[n] = graph.nodes[n].distanceTo(end.point);
  for (;;) {
    let n = -1;
    distance.forEach((d, i) => { if (!done[i] && d < Infinity && (n < 0 || d < distance[n])) n = i; });
    if (n < 0) break;
    done[n] = true;
    for (const ei of graph.adjacency[n]) {
      const e = graph.edges[ei], next = e.a === n ? e.b : e.a;
      if (distance[n] + e.length < distance[next]) { distance[next] = distance[n] + e.length; previous[next] = n; }
    }
  }
  let best: { cost: number; start: Snap; node: number } | undefined;
  for (const gate of gates) {
    const start = snap(graph, gate);
    if (!start || start.distance > GATE_REACH) continue;
    // node -1: the gate joins the destination's own edge, so walk straight along it.
    const e = graph.edges[start.edge];
    const options = start.edge === end.edge ? [{ node: -1, cost: start.point.distanceTo(end.point) }]
      : [e.a, e.b].map(n => ({ node: n, cost: start.point.distanceTo(graph.nodes[n]) + distance[n] }));
    for (const { node, cost } of options) {
      if (cost < Infinity && (!best || start.distance + cost < best.cost)) best = { cost: start.distance + cost, start, node };
    }
  }
  if (!best) return;
  const route = [best.start.point];
  for (let n = best.node; n >= 0; n = previous[n]) route.push(graph.nodes[n]);
  route.push(end.point);
  return route;
}

/** A flat ribbon plus end discs merged into one mesh: one draw call while a destination is shown. */
function routeGeometry(route: T.Vector2[]) {
  const points = route.filter((p, i) => i === 0 || p.distanceTo(route[i - 1]) > .05);
  if (points.length < 2) return null;
  const positions: number[] = [], index: number[] = [];
  points.forEach((p, i) => {
    const before = i ? p.clone().sub(points[i - 1]).normalize() : points[1].clone().sub(p).normalize();
    const after = i < points.length - 1 ? points[i + 1].clone().sub(p).normalize() : before;
    const d = before.clone().add(after).normalize(), n = new T.Vector2(-d.y, d.x);
    // Mitre the corners, capped so a sharp turn cannot spike outwards.
    const half = ROUTE_WIDTH / 2 / Math.max(.65, n.dot(new T.Vector2(-after.y, after.x)));
    positions.push(p.x + n.x * half, ROUTE_HEIGHT, p.y + n.y * half, p.x - n.x * half, ROUTE_HEIGHT, p.y - n.y * half);
    if (i) index.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  });
  const ribbon = new T.BufferGeometry();
  ribbon.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); ribbon.setIndex(index);
  const ends = [points[0], points[points.length - 1]].map(p => {
    const disc = new T.CircleGeometry(ROUTE_WIDTH * 1.6, 20); disc.rotateX(-Math.PI / 2); disc.translate(p.x, ROUTE_HEIGHT + .01, p.y);
    disc.deleteAttribute('normal'); disc.deleteAttribute('uv');
    return disc;
  });
  const geometry = mergeGeometries([ribbon, ...ends], false)!;
  [ribbon, ...ends].forEach(g => g.dispose());
  return geometry;
}

/** Route line from the nearest gate to the selected hall, along the satellite-traced walkways. */
export function createVenueWalkwayRoute(scene: T.Scene, registration: SiteRegistration,
  destinations: Map<string, T.Vector2>, gates: T.Vector2[]) {
  const graph = buildWalkwayGraph(registration);
  const material = new T.MeshBasicMaterial({ color: '#e39a52', toneMapped: false, depthWrite: false,
    side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const empty = new T.BufferGeometry(), mesh = new T.Mesh(empty, material);
  mesh.name = 'Venue walkway route'; mesh.renderOrder = 2; mesh.visible = false; mesh.frustumCulled = false;
  scene.add(mesh);
  const routes = new Map<string, T.BufferGeometry | null>();
  return {
    show(id: string) {
      const target = destinations.get(id);
      if (!routes.has(id)) {
        const route = target && shortestWalkwayRoute(graph, target, gates);
        routes.set(id, route ? routeGeometry(route) : null);
      }
      const geometry = routes.get(id);
      mesh.visible = !!geometry;
      if (geometry) mesh.geometry = geometry;
    },
    dispose() {
      mesh.removeFromParent(); material.dispose(); empty.dispose();
      routes.forEach(g => g?.dispose());
    },
  };
}
