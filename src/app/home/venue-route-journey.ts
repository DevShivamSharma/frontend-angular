import { CLOSEST_POINT, findLocation, LocationSelection, NavigationLocation } from './venue-route-locations';
import { canEndAt, canStartAt, GateAccess, MapNode } from './venue-route-graph';
import { Adjacency, findShortestPath } from './venue-route-pathfinding';

/**
 * A planned walk, ported from the ITPO app's journey.ts. The explorer routes on one outdoor level, so a
 * journey is a single leg; the app's floors and transitions come back when the Convention Centre levels do.
 */
export interface Journey {
  start: MapNode;
  end: MapNode;
  /** Every node walked, junctions included, in order. */
  path: string[];
  /** Named places passed between start and end. */
  via: MapNode[];
  totalMeters: number;
}

export type JourneyProblem =
  | { reason: 'same' }
  | { reason: 'exitOnlyStart'; node: MapNode }
  | { reason: 'entryOnlyEnd'; node: MapNode }
  | { reason: 'noRoute' };

export type JourneyResult = { journey: Journey } | { problem: JourneyProblem };

export interface PlanContext {
  locations: NavigationLocation[];
  adjacency: Adjacency;
  nodeMap: Record<string, MapNode>;
  gateAccess: Record<string, GateAccess>;
}

/** Its chosen point, or every point of the group. "Closest" never lands on a closed gate. */
function candidatesFor(selection: LocationSelection, locations: NavigationLocation[], gateAccess: Record<string, GateAccess>) {
  if (selection.pointId !== CLOSEST_POINT) return [selection.pointId];
  return (findLocation(selection.locationId, locations)?.nodeIds ?? []).filter(id => gateAccess[id] !== 'closed');
}

/**
 * The journey between two picker selections. A group left on "Closest" resolves to whichever of its points
 * gives the shortest route; gates that cannot be used that way round are skipped, and a gate picked
 * explicitly the wrong way round is reported instead.
 */
export function planJourney(source: LocationSelection, destination: LocationSelection, { locations, adjacency, nodeMap, gateAccess }: PlanContext): JourneyResult {
  const explicitStart = source.pointId !== CLOSEST_POINT, explicitEnd = destination.pointId !== CLOSEST_POINT;
  if (explicitStart && explicitEnd && source.pointId === destination.pointId) return { problem: { reason: 'same' } };
  if (explicitStart && nodeMap[source.pointId] && !canStartAt(source.pointId, gateAccess)) return { problem: { reason: 'exitOnlyStart', node: nodeMap[source.pointId] } };
  if (explicitEnd && nodeMap[destination.pointId] && !canEndAt(destination.pointId, gateAccess)) return { problem: { reason: 'entryOnlyEnd', node: nodeMap[destination.pointId] } };
  const starts = candidatesFor(source, locations, gateAccess).filter(id => canStartAt(id, gateAccess));
  const ends = candidatesFor(destination, locations, gateAccess).filter(id => canEndAt(id, gateAccess));
  let best: { path: string[]; totalDistance: number } | null = null;
  for (const startId of starts) for (const endId of ends) {
    if (startId === endId) continue;
    const route = findShortestPath(startId, endId, adjacency, nodeMap, gateAccess);
    if (route && (!best || route.totalDistance < best.totalDistance)) best = route;
  }
  if (!best) {
    // Both sides narrowed to the same single point reads better as "same place" than "no route".
    if (starts.length === 1 && ends.length === 1 && starts[0] === ends[0]) return { problem: { reason: 'same' } };
    return { problem: { reason: 'noRoute' } };
  }
  const path = best.path;
  return { journey: {
    start: nodeMap[path[0]], end: nodeMap[path[path.length - 1]], path, totalMeters: best.totalDistance,
    via: path.slice(1, -1).map(id => nodeMap[id]).filter(node => node.category !== 'junction'),
  } };
}

const WALKING_DETOUR_FACTOR = 1.15;
/** The app's estimate: x1.15 detour, rounded to 10 m. */
export const walkingMeters = (meters: number) => Math.max(10, Math.round(meters * WALKING_DETOUR_FACTOR / 10) * 10);
/** Average adult pace, ~5 km/h, floored at a minute. */
export const walkingMinutes = (meters: number) => Math.max(1, Math.round(walkingMeters(meters) / 83));

export function problemMessage(problem: JourneyProblem): string {
  switch (problem.reason) {
    case 'same': return 'Source and destination are the same place. Please pick a different destination.';
    case 'exitOnlyStart': return `${problem.node.label} is exit only and can't be used as a starting point.`;
    case 'entryOnlyEnd': return `${problem.node.label} is entry only and can't be used as a destination.`;
    default: return 'No route is available between these points right now - a path or gate may be closed. Please try again shortly or pick another point.';
  }
}
