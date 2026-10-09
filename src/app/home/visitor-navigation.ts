import * as T from 'three';
import { InteriorHall, InteriorObstacle, hallToWorld, worldToHall, walkable } from './venue-interiors';

export type GroundPoint = [number, number];
export interface VisitorPortal {
  hall: InteriorHall;
  position: T.Vector3;
  /** Unit direction from the doorway out onto the campus. */
  outward: T.Vector3;
  width: number;
  approach: number;
}
export interface VisitorNavigation {
  portals: VisitorPortal[];
  buildings: { id: string; polygon: GroundPoint[] }[];
  hazards: GroundPoint[][];
  bounds: T.Box2;
  spawn: T.Vector3;
  heading: number;
}
const cross = (a: GroundPoint, b: GroundPoint, p: GroundPoint) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
export function convexFootprint(points: GroundPoint[]): GroundPoint[] {
  const sorted = [...new Map(points.map(p => [p.map(n => n.toFixed(3)).join(','), p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: GroundPoint[]) => {
    const result: GroundPoint[] = [];
    for (const p of ps) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
export function inFootprint(polygon: GroundPoint[], x: number, z: number, margin = 0): boolean {
  return polygon.length >= 3 && polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return cross(a, b, [x, z]) >= margin * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}
export function portalCoordinates(portal: VisitorPortal, point: T.Vector3) {
  const x = point.x - portal.position.x, z = point.z - portal.position.z;
  return { along: x * portal.outward.x + z * portal.outward.z,
    across: x * portal.outward.z - z * portal.outward.x };
}
export function inDoorway(portal: VisitorPortal, point: T.Vector3, extra = 0): boolean {
  const p = portalCoordinates(portal, point);
  return Math.abs(p.across) < portal.width / 2 + extra && p.along > -8 && p.along < portal.approach;
}
function worldOutline(hall: InteriorHall): GroundPoint[] {
  return hall.outline.map(([x, z]) => { const p = hallToWorld(hall, x, 0, z); return [p.x, p.z]; });
}
/** Derive a doorway on a real footprint, with clear furniture access on the inside. */
export function createPortal(hall: InteriorHall, obstacles: InteriorObstacle[], outsideClear: (p: T.Vector3) => boolean = () => true): VisitorPortal {
  const outline = worldOutline(hall);
  const preferred = hall.entrance.some(n => Math.abs(n) > .1)
    ? hallToWorld(hall, ...[hall.entrance[0], 0, hall.entrance[1]] as [number, number, number])
    : new T.Vector3(-35, hall.center.y, 55);
  const candidates: { position: T.Vector3; outward: T.Vector3; cost: number }[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = new T.Vector3(outline[i][0], hall.center.y, outline[i][1]);
    const b = new T.Vector3(outline[(i + 1) % outline.length][0], hall.center.y, outline[(i + 1) % outline.length][1]);
    const edge = b.clone().sub(a), length = edge.length();
    if (length < .1) continue;
    const outward = new T.Vector3(edge.z, 0, -edge.x).normalize();
    const nearest = length < 7 ? .5 : T.MathUtils.clamp(preferred.clone().sub(a).dot(edge) / edge.lengthSq(), 3 / length, 1 - 3 / length);
    for (const t of [nearest, .25, .5, .75]) {
      const position = a.clone().addScaledVector(edge, t);
      let clear = true;
      for (let d = 2.2; d <= 10; d += .5) {
        const local = worldToHall(hall, position.clone().addScaledVector(outward, -d));
        if (!walkable(hall, obstacles, local.x, local.z)) { clear = false; break; }
      }
      let approachClear = true;
      for (let d = 1; d <= (hall.level ? 35 : 15); d += 1) {
        if (!outsideClear(position.clone().addScaledVector(outward, d))) { approachClear = false; break; }
      }
      candidates.push({ position, outward, cost: position.distanceToSquared(preferred) + (clear ? 0 : 1e7) + (approachClear ? 0 : 1e8) });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  if (!candidates.length) throw new Error(`No visitor entrance could be fitted to ${hall.label}`);
  return { hall, position: candidates[0].position, outward: candidates[0].outward, width: 4.4,
    approach: hall.level ? 30 : 10 };
}
/** Read the unbatched model once. Only lightweight convex polygons are used per step. */
export function createVisitorNavigation(root: T.Group, halls: InteriorHall[], obstacles: Map<string, InteriorObstacle[]>): VisitorNavigation {
  const points = new Map<string, GroundPoint[]>(), hazards: GroundPoint[][] = [];
  const bounds = new T.Box2();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    let name = o.name;
    for (let p = o.parent; p && p !== root; p = p.parent) name += ' ' + p.name;
    const id = name.match(/PHOTO_HALL_(12A|14|12|11|10|[1-9])(?:_| ).*roof/i)?.[1];
    const hazard = /(?:basin|water_body|reflecting_pool)/i.test(name) && !/spray|jet|lamp/i.test(name);
    const ground = /SITE_GROUND/.test(name);
    if (!id && !hazard && !ground) return;
    const polygon: GroundPoint[] = [], attribute = o.geometry.getAttribute('position'), p = new T.Vector3();
    for (let i = 0; i < attribute.count; i++) {
      p.fromBufferAttribute(attribute, i).applyMatrix4(o.matrixWorld);
      polygon.push([p.x, p.z]);
      if (ground) bounds.expandByPoint(new T.Vector2(p.x, p.z));
    }
    if (id) points.set('hall' + id, [...(points.get('hall' + id) ?? []), ...polygon]);
    if (hazard) hazards.push(convexFootprint(polygon));
  });
  for (const h of halls) if (!h.level || h.level === 1) points.set(h.level ? 'cc' : h.id, worldOutline(h));
  const buildings = [...points].map(([id, ps]) => ({ id, polygon: convexFootprint(ps) }));
  const portals = halls.filter(h => !h.level || h.level === 1).map(h => createPortal(h, obstacles.get(h.id) ?? [], p =>
    !buildings.some(b => b.id !== (h.level ? 'cc' : h.id) && inFootprint(b.polygon, p.x, p.z, -.6)) &&
    !hazards.some(poly => inFootprint(poly, p.x, p.z, -.6))));
  // Gate 6 is the existing photographed main arrival, in the model's authored coordinates.
  const spawn = new T.Vector3(.5 * -302 + Math.sqrt(3) / 2 * 151, .35,
    -Math.sqrt(3) / 2 * -302 + .5 * 151);
  bounds.expandByPoint(new T.Vector2(spawn.x, spawn.z)).expandByScalar(22);
  return { portals, buildings,
    hazards, bounds, spawn, heading: Math.PI * 5 / 6 };
}
export function campusWalkable(nav: VisitorNavigation, point: T.Vector3): boolean {
  if (!nav.bounds.containsPoint(new T.Vector2(point.x, point.z))) return false;
  if (nav.hazards.some(p => inFootprint(p, point.x, point.z, -.45))) return false;
  return !nav.buildings.some(building => {
    if (!inFootprint(building.polygon, point.x, point.z, -.45)) return false;
    const portal = nav.portals.find(p => (p.hall.level ? 'cc' : p.hall.id) === building.id);
    return !portal || !inDoorway(portal, point);
  });
}
/** Substeps stop a slow frame or fast walking from tunnelling through walls. */
export function slideVisitor(position: T.Vector3, dx: number, dz: number, allowed: (p: T.Vector3) => boolean): number {
  const startX = position.x, startZ = position.z;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .18));
  const trial = position.clone();
  for (let i = 0; i < count; i++) {
    trial.copy(position); trial.x += dx / count;
    if (allowed(trial)) position.x = trial.x;
    trial.copy(position); trial.z += dz / count;
    if (allowed(trial)) position.z = trial.z;
  }
  return Math.hypot(position.x - startX, position.z - startZ);
}
