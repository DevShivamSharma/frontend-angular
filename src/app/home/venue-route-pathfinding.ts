import { canPassThrough, canStepThroughGate, GateAccess, MapEdge, MapNode } from './venue-route-graph';

export interface AdjacencyEntry { nodeId: string; distance: number; edge: MapEdge; }
export type Adjacency = Record<string, AdjacencyEntry[]>;

/** Walking distance in metres: the edge's polyline, or the straight line between its ends. */
function edgeLength(edge: MapEdge, from: MapNode, to: MapNode): number {
  const points = edge.points;
  if (!points) return Math.hypot(to.x - from.x, to.z - from.z);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
}

/** Walkable neighbours: inactive edges skipped, one-way edges only `from` -> `to`, wrong-way gate steps left out. */
export function buildAdjacency(edges: MapEdge[], gateAccess: Record<string, GateAccess>, nodeMap: Record<string, MapNode>): Adjacency {
  const adjacency: Adjacency = {};
  const add = (fromId: string, toId: string, edge: MapEdge) => {
    const from = nodeMap[fromId], to = nodeMap[toId];
    if (!from || !to || !canStepThroughGate(fromId, toId, gateAccess, nodeMap)) return;
    (adjacency[fromId] ??= []).push({ nodeId: toId, distance: edgeLength(edge, from, to), edge });
  };
  for (const edge of edges) {
    if (!edge.active) continue;
    add(edge.from, edge.to, edge);
    if (edge.direction !== 'one-way') add(edge.to, edge.from, edge);
  }
  return adjacency;
}

export interface RouteResult {
  path: string[];
  /** Total route length in metres along the traced walkways. */
  totalDistance: number;
}

/**
 * Dijkstra's shortest path. The app scans for the nearest node each step; the explorer's graph is a few
 * hundred nodes and "closest point" plans run it up to ~200 times, so this uses a binary heap instead.
 * Returns null when the two nodes are not connected. Closed gates can start or end a route, never be passed.
 */
export function findShortestPath(startId: string, endId: string, adjacency: Adjacency, nodeMap: Record<string, MapNode>,
  gateAccess: Record<string, GateAccess>): RouteResult | null {
  if (startId === endId) return { path: [startId], totalDistance: 0 };
  if (!nodeMap[startId] || !nodeMap[endId]) return null;
  const distances = new Map<string, number>([[startId, 0]]), previous = new Map<string, string>(), visited = new Set<string>();
  const heap: [number, string][] = [[0, startId]];
  const push = (item: [number, string]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [distance, currentId] = pop();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    if (currentId === endId) break;
    // A closed gate reached on the way is a dead end, not a way through.
    if (currentId !== startId && !canPassThrough(currentId, gateAccess)) continue;
    for (const { nodeId, distance: step } of adjacency[currentId] ?? []) {
      if (visited.has(nodeId)) continue;
      const candidate = distance + step;
      if (candidate < (distances.get(nodeId) ?? Infinity)) { distances.set(nodeId, candidate); previous.set(nodeId, currentId); push([candidate, nodeId]); }
    }
  }
  const total = distances.get(endId);
  if (total === undefined) return null;
  const path = [endId];
  for (let cursor = endId; cursor !== startId;) {
    const prev = previous.get(cursor);
    if (!prev) return null;
    path.unshift(prev); cursor = prev;
  }
  return { path, totalDistance: total };
}
