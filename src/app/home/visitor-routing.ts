import * as T from 'three';
import { InteriorHall, InteriorObstacle } from './venue-interiors';
import { VisitorNavigation, VisitorPortal, campusWalkable, inDoorway, portalCoordinates, visitorBodyClear, visitorHallWalkable } from './visitor-navigation';
import { VISITOR_RADIUS } from './visitor-collision';

type Allowed = (point: T.Vector3) => boolean;
const groundDistance = (a: T.Vector3, b: T.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Check the whole swept segment, including thin walls and furniture. */
export function visitorSegmentClear(a: T.Vector3, b: T.Vector3, allowed: Allowed): boolean {
  const steps = Math.max(1, Math.ceil(groundDistance(a, b) / .12));
  const point = a.clone();
  for (let i = 0; i <= steps; i++) {
    point.lerpVectors(a, b, i / steps);
    if (!allowed(point)) return false;
  }
  return true;
}

/** Bounded A* on the collision map. Runs on request, never in the render loop. */
export function findVisitorPath(start: T.Vector3, goal: T.Vector3, bounds: T.Box2, allowed: Allowed, step = 2, limit = 60000): T.Vector3[] | null {
  if (!allowed(start) || !allowed(goal)) return null;
  if (visitorSegmentClear(start, goal, allowed)) return [start.clone(), goal.clone()];
  interface Node { x: number; z: number; point: T.Vector3; cost: number; score: number; parent?: Node; }
  const heap: Node[] = [], costs = new Map<string, number>(), clearEdges = new Map<string, boolean>();
  const push = (node: Node) => {
    let index = heap.length; heap.push(node);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].score <= node.score) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = node;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
        if (last.score <= heap[child].score) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  push({ x: 0, z: 0, point: start.clone(), cost: 0, score: groundDistance(start, goal) });
  costs.set('0,0', 0);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let visited = 0; heap.length && visited < limit; visited++) {
    const node = pop();
    if (node.cost !== costs.get(`${node.x},${node.z}`)) continue;
    if (groundDistance(node.point, goal) <= step * 2 && visitorSegmentClear(node.point, goal, allowed)) {
      const path = [goal.clone()];
      for (let previous: Node | undefined = node; previous; previous = previous.parent) path.push(previous.point);
      path.reverse();
      // Keep only corners with a fully clear line of travel between them.
      const smooth = [path[0]];
      for (let i = 0; i < path.length - 1;) {
        let next = path.length - 1;
        while (next > i + 1 && !visitorSegmentClear(path[i], path[next], allowed)) next--;
        smooth.push(path[next]); i = next;
      }
      return smooth;
    }
    for (const [dx, dz] of directions) {
      const x = node.x + dx, z = node.z + dz, key = `${x},${z}`;
      const cost = node.cost + Math.hypot(dx, dz) * step;
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      const point = new T.Vector3(start.x + x * step, start.y, start.z + z * step);
      if (point.x < bounds.min.x || point.x > bounds.max.x || point.z < bounds.min.y || point.z > bounds.max.y) continue;
      const fromKey = `${node.x},${node.z}`, edgeKey = fromKey < key ? `${fromKey}:${key}` : `${key}:${fromKey}`;
      let clear = clearEdges.get(edgeKey);
      if (clear === undefined) { clear = visitorSegmentClear(node.point, point, allowed); clearEdges.set(edgeKey, clear); }
      if (!clear) continue;
      costs.set(key, cost);
      // A modest heuristic weight favours prompt route selection on the campus;
      // every edge and smoothed segment still receives the full collision check.
      push({ x, z, point, cost, score: cost + 1.15 * groundDistance(point, goal), parent: node });
    }
  }
  return null;
}

/** Outdoor A* collision: do not take shortcuts through another hall's open doorway.
 * Precompute the same convex half-planes and body clearance used by campus
 * collision. A* samples these many times; avoid allocating vectors, looking up
 * portals or recalculating every edge length for each sample. */
function campusAllowed(nav: VisitorNavigation): Allowed {
  const footprints = [...nav.buildings.map(b => b.polygon), ...nav.hazards]
    .filter(p => p.length >= 3).map(polygon => polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], dz = b[1] - a[1];
      return { x: -dz, z: dx, offset: dz * a[0] - dx * a[1] + VISITOR_RADIUS * Math.hypot(dx, dz) };
    }));
  return p => p.x >= nav.bounds.min.x && p.x <= nav.bounds.max.x &&
    p.z >= nav.bounds.min.y && p.z <= nav.bounds.max.y &&
    !footprints.some(edges => edges.every(edge => edge.x * p.x + edge.z * p.z + edge.offset >= 0)) && visitorBodyClear(nav, p);
}

/**
 * A Directions route the visitor can walk. The drawn walkways were traced from the air and run through hall
 * roofs and walls, so inside the campus collision bounds a point in a building is left out and a segment that
 * crosses one is re-routed with the same A* as Go to hall; outside the bounds (roads, the metro) there is no
 * collision data and the drawn line is kept. With a destination doorway the walk ends inside it, as Go to hall does.
 */
export function walkableRoute(nav: VisitorNavigation, obstacles: Map<string, InteriorObstacle[]>, points: T.Vector3[],
  destination?: VisitorPortal): T.Vector3[] | null {
  const outdoors = campusAllowed(nav);
  const inBounds = (p: T.Vector3) => nav.bounds.containsPoint(new T.Vector2(p.x, p.z));
  const route: T.Vector3[] = [];
  for (const point of points) {
    if (inBounds(point) && !outdoors(point)) continue;
    const last = route[route.length - 1];
    if (last && inBounds(last) && inBounds(point) && !visitorSegmentClear(last, point, outdoors)) {
      // Searched from the new point back: a point the trace put inside a glazed pavilion or a fenced yard
      // is sealed in and the search runs out at once, and the point is left out like one in a hall.
      const detour = findVisitorPath(point, last, nav.bounds, outdoors, 2, 8000);
      if (detour) route.push(...detour.reverse().slice(1));
      continue;
    }
    route.push(point);
  }
  if (destination && route.length) {
    const tail = planVisitorRoute(nav, obstacles, undefined, route[route.length - 1], destination);
    if (tail) route.push(...tail.slice(1));
  }
  return route.length >= 2 ? route : null;
}

/** Join an indoor exit, the outdoor route, and the destination's real doorway. */
export function planVisitorRoute(nav: VisitorNavigation, obstacles: Map<string, InteriorObstacle[]>,
  currentHall: InteriorHall | undefined, start: T.Vector3, destination: VisitorPortal): T.Vector3[] | null {
  if (currentHall?.id === destination.hall.id) return [start.clone()];
  if (currentHall?.level && currentHall.level !== 1) return null;
  const route = [start.clone()];
  const inside = (hall: InteriorHall): Allowed => point => {
    return visitorHallWalkable(nav, hall, obstacles.get(hall.id) ?? [], point);
  };
  const doorway = (door: VisitorPortal): Allowed => {
    const hallClear = inside(door.hall);
    return point => inDoorway(door, point, -VISITOR_RADIUS) && portalCoordinates(door, point).along > -2.2
      ? campusWalkable(nav, point) : hallClear(point);
  };
  const append = (goal: T.Vector3, allowed: Allowed, step = 2) => {
    const path = findVisitorPath(route[route.length - 1], goal, nav.bounds, allowed, step);
    if (!path) return false;
    route.push(...path.slice(1)); return true;
  };
  const exterior = (door: VisitorPortal) => door.position.clone().addScaledVector(door.outward, door.approach - 1);
  const interior = (door: VisitorPortal) => door.position.clone().addScaledVector(door.outward, -4.5);
  if (currentHall) {
    const exit = nav.portals.find(p => p.hall.id === currentHall.id);
    if (!exit || !append(interior(exit), inside(currentHall), 1) || !append(exterior(exit), doorway(exit), 1)) return null;
  } else {
    // A manually stopped avatar may already be partway through a doorway.
    const door = nav.portals.find(p => inDoorway(p, start));
    if (door && !append(exterior(door), point => campusWalkable(nav, point), 1)) return null;
  }
  const outdoors = campusAllowed(nav);
  if (!append(exterior(destination), outdoors, 4) && !append(exterior(destination), outdoors, 2)) return null;
  if (!append(interior(destination), doorway(destination), 1)) return null;
  return route;
}
