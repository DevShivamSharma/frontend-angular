/**
 * Walking-route graph for the explorer, ported from the ITPO app's mapGraph.ts.
 * The graph is src/assets/venue/venue-walkways.json, built by scripts/build-venue-walkways.cjs
 * from the satellite-traced walkways. Node x/z are venue world metres (the three.js scene x/z),
 * and each edge keeps the walkway polyline it follows so a drawn route stays on the paths.
 *
 * Every edge carries `active` and `direction`, and every gate an `access`. The bundled values are
 * the venue's normal state; live overrides keep the app's shape (`edges`, `gates`, `locations`) so
 * a backend source can replace them later without touching the routing code.
 */

export type MapNodeCategory = 'gate' | 'hall' | 'amenity' | 'junction';

/** `entry` gates can only start a route, `exit` gates only end one; `closed` gates are never passed through. */
export type GateAccess = 'both' | 'entry' | 'exit' | 'closed';

export interface MapNode {
  id: string;
  label: string;
  category: MapNodeCategory;
  x: number;
  z: number;
  /** Gates only. */
  access?: GateAccess;
  /** Outside the property (roads, metro, bus stop, parking): which side of a gate a step is on. */
  outside?: boolean;
}

export type PathDirection = 'two-way' | 'one-way';

export interface MapEdge {
  /** `${from}-${to}`, the key overrides use. */
  id: string;
  from: string;
  to: string;
  /** Inactive paths are left out of routing entirely. */
  active: boolean;
  direction: PathDirection;
  /** `path`, `service` and `road` follow a traced line; `link` joins a place to the network. */
  kind?: 'path' | 'service' | 'road' | 'link';
  /** World x/z polyline from `from` to `to`. */
  points?: [number, number][];
}

export interface PathOverride { active?: boolean; direction?: PathDirection; }
export interface GateOverride { access?: GateAccess; }
export interface PathOverrides {
  edges?: Record<string, PathOverride> | unknown[];
  nodes?: unknown[];
  gates?: Record<string, GateOverride>;
  locations?: unknown[];
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  nodeMap: Record<string, MapNode>;
  /** Gates, halls and amenities: every point that can be a route's end. */
  selectableNodes: MapNode[];
}

export function createMapGraph(nodes: MapNode[], edges: MapEdge[]): MapGraph {
  const nodeMap: Record<string, MapNode> = {};
  for (const node of nodes) nodeMap[node.id] = node;
  return { nodes, edges, nodeMap, selectableNodes: nodes.filter(node => node.category !== 'junction') };
}

const EDGE_ID_SEPARATOR = '-';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDirection = (value: unknown): value is PathDirection => value === 'two-way' || value === 'one-way';
const isCategory = (value: unknown): value is MapNodeCategory => value === 'gate' || value === 'hall' || value === 'amenity' || value === 'junction';
const isGateAccess = (value: unknown): value is GateAccess => value === 'both' || value === 'entry' || value === 'exit' || value === 'closed';
const isPoint = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);

function toNode(raw: unknown): MapNode | null {
  if (!isRecord(raw)) return null;
  const { id, label, category, x, z, access, outside } = raw;
  if (typeof id !== 'string' || !id || !isCategory(category) || !isFiniteNumber(x) || !isFiniteNumber(z)) return null;
  const node: MapNode = { id, label: typeof label === 'string' ? label : id, category, x, z };
  if (isGateAccess(access)) node.access = access;
  if (outside === true) node.outside = true;
  return node;
}

function toEdge(raw: unknown, nodeMap: Record<string, MapNode>): MapEdge | null {
  if (!isRecord(raw)) return null;
  const { id, from, to, active, direction, kind, points } = raw;
  if (typeof from !== 'string' || typeof to !== 'string' || !nodeMap[from] || !nodeMap[to] || from === to) return null;
  const edge: MapEdge = { id: typeof id === 'string' && id ? id : `${from}${EDGE_ID_SEPARATOR}${to}`, from, to,
    active: typeof active === 'boolean' ? active : true, direction: isDirection(direction) ? direction : 'two-way' };
  if (kind === 'path' || kind === 'service' || kind === 'road' || kind === 'link') edge.kind = kind;
  if (Array.isArray(points) && points.length >= 2 && points.every(isPoint)) edge.points = points;
  return edge;
}

/** The bundled graph from venue-walkways.json. Malformed entries are dropped. */
export function parseMapGraph(raw: unknown): MapGraph {
  const source = isRecord(raw) ? raw : {};
  const nodes = (Array.isArray(source['nodes']) ? source['nodes'] : []).map(toNode).filter((node): node is MapNode => !!node);
  const nodeMap = createMapGraph(nodes, []).nodeMap;
  const edges = (Array.isArray(source['edges']) ? source['edges'] : []).map(edge => toEdge(edge, nodeMap)).filter((edge): edge is MapEdge => !!edge);
  return createMapGraph(Object.values(nodeMap), edges);
}

/** A live replacement graph when the override carries usable `nodes` and `edges`, otherwise the bundled one. */
export function resolveMapGraph(remote: PathOverrides | null | undefined, bundled: MapGraph): MapGraph {
  if (!remote || !Array.isArray(remote.nodes) || !Array.isArray(remote.edges)) return bundled;
  const graph = parseMapGraph({ nodes: remote.nodes, edges: remote.edges });
  return graph.nodes.length && graph.edges.length ? graph : bundled;
}

/** Edges with live overrides applied. A one-way override written `${to}-${from}` flips the edge. */
export function applyPathOverrides(edges: MapEdge[], overrides: PathOverrides | null | undefined): MapEdge[] {
  const entries = overrides?.edges;
  if (!isRecord(entries)) return edges;
  const byId = new Map<string, { override: PathOverride; reversed: boolean }>();
  for (const [key, override] of Object.entries(entries)) {
    if (!override || typeof override !== 'object') continue;
    const [from, to, ...rest] = key.split(EDGE_ID_SEPARATOR);
    if (!from || !to || rest.length) continue;
    byId.set(`${from}${EDGE_ID_SEPARATOR}${to}`, { override: override as PathOverride, reversed: false });
    if (!byId.has(`${to}${EDGE_ID_SEPARATOR}${from}`)) byId.set(`${to}${EDGE_ID_SEPARATOR}${from}`, { override: override as PathOverride, reversed: true });
  }
  if (!byId.size) return edges;
  return edges.map(edge => {
    const match = byId.get(edge.id);
    if (!match) return edge;
    const next: MapEdge = { ...edge };
    if (typeof match.override.active === 'boolean') next.active = match.override.active;
    if (isDirection(match.override.direction)) {
      next.direction = match.override.direction;
      if (match.override.direction === 'one-way' && match.reversed) {
        next.from = edge.to; next.to = edge.from; next.points = edge.points && [...edge.points].reverse();
      }
    }
    return next;
  });
}

/** Every gate's access: the bundled value with any valid override on top. */
export function resolveGateAccess(overrides: PathOverrides | null | undefined, nodes: MapNode[]): Record<string, GateAccess> {
  const gates = overrides?.gates && typeof overrides.gates === 'object' ? overrides.gates : {};
  const access: Record<string, GateAccess> = {};
  for (const node of nodes) {
    if (node.category !== 'gate') continue;
    const override = gates[node.id]?.access;
    access[node.id] = isGateAccess(override) ? override : (node.access ?? 'both');
  }
  return access;
}

/**
 * Whether stepping between neighbours respects gate access. A gate's links to `outside` nodes are its outer
 * side and links to venue nodes its inner side; links between two gates are not restricted.
 */
export function canStepThroughGate(fromId: string, toId: string, gateAccess: Record<string, GateAccess>, nodeMap: Record<string, MapNode>): boolean {
  const from = nodeMap[fromId], to = nodeMap[toId];
  if (!from || !to) return true;
  if (from.category === 'gate' && to.category === 'gate') return true;
  if (gateAccess[fromId] === 'entry' && to.outside) return false;
  if (gateAccess[fromId] === 'exit' && !to.outside) return false;
  if (gateAccess[toId] === 'entry' && !from.outside) return false;
  if (gateAccess[toId] === 'exit' && from.outside) return false;
  return true;
}

export const canStartAt = (nodeId: string, gateAccess: Record<string, GateAccess>) => gateAccess[nodeId] !== 'exit';
export const canEndAt = (nodeId: string, gateAccess: Record<string, GateAccess>) => gateAccess[nodeId] !== 'entry';
/** Closed gates can only be a route's first or last stop. */
export const canPassThrough = (nodeId: string, gateAccess: Record<string, GateAccess>) => gateAccess[nodeId] !== 'closed';

export const GATE_ACCESS_SUFFIX: Record<GateAccess, string> = { both: '', entry: ' (Entry only)', exit: ' (Exit only)', closed: ' (Closed)' };
