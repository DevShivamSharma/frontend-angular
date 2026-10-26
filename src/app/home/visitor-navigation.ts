import * as T from 'three';
import { InteriorHall, InteriorObstacle, hallToWorld, worldToHall, walkable } from './venue-interiors';
import { createVisitorCollisionWorld, VisitorCollisionWorld, VISITOR_RADIUS, VISITOR_HEIGHT, VISITOR_STEP } from './visitor-collision';
import { VISITOR_RAMP_LANDING } from './visitor-doorway';

export type GroundPoint = [number, number];
export interface VisitorPortal {
  hall: InteriorHall;
  position: T.Vector3;
  /** Unit direction from the doorway out onto the campus. */
  outward: T.Vector3;
  width: number;
  approach: number;
}
/** The renderer and movement share these exact standing body locations. */
export interface VisitorGuardPlacement {
  id: string;
  portalId: string;
  position: T.Vector3;
  heading: number;
  radius: number;
  height: number;
}
export interface VisitorNavigation {
  portals: VisitorPortal[];
  buildings: { id: string; polygon: GroundPoint[] }[];
  hazards: GroundPoint[][];
  bounds: T.Box2;
  spawn: T.Vector3;
  heading: number;
  arrivalLabel?: string;
  geometry?: VisitorCollisionWorld;
  /** Assign only after the corresponding visible guard instances were created. */
  guards?: VisitorGuardPlacement[];
  /** Height of the walkable surface (paving, roads, lawns), where the model's ground is not flat. */
  groundAt?: (x: number, z: number) => number | undefined;
}
/** Top of the near-flat ground surfaces on a 1 m grid (the Bharat Mandapam paving sits up to 0.7 m above grade). */
function groundHeightGrid(meshes: T.Mesh[]): (x: number, z: number) => number | undefined {
  const box = new T.Box3();
  for (const mesh of meshes) box.union(new T.Box3().setFromObject(mesh));
  const x0 = Math.floor(box.min.x), z0 = Math.floor(box.min.z), width = Math.ceil(box.max.x) - x0 + 1, depth = Math.ceil(box.max.z) - z0 + 1;
  const heights = new Float32Array(width * depth).fill(NaN);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), normal = new T.Vector3(), e = new T.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    const count = index?.count ?? position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(position, index ? index.getX(t) : t).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
      normal.subVectors(b, a).cross(e.subVectors(c, a));
      const area = normal.length();
      if (area < 1e-6 || Math.abs(normal.y) / area < .9) continue;
      const det = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      const set = (x: number, z: number) => {
        const w1 = ((x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)) / det, w2 = ((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) / det;
        if (w1 < -1e-6 || w2 < -1e-6 || w1 + w2 > 1 + 1e-6) return;
        const y = a.y + w1 * (b.y - a.y) + w2 * (c.y - a.y), k = (Math.floor(x) - x0) * depth + Math.floor(z) - z0;
        if (!(heights[k] >= y)) heights[k] = y;
      };
      for (let x = Math.floor(Math.min(a.x, b.x, c.x)); x <= Math.max(a.x, b.x, c.x); x++)
        for (let z = Math.floor(Math.min(a.z, b.z, c.z)); z <= Math.max(a.z, b.z, c.z); z++) set(x + .5, z + .5);
      set((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
    }
  }
  return (x, z) => {
    const i = Math.floor(x) - x0, j = Math.floor(z) - z0;
    if (i < 0 || j < 0 || i >= width || j >= depth) return undefined;
    const y = heights[i * depth + j];
    return Number.isNaN(y) ? undefined : y;
  };
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
/** Read the unbatched model once, before disconnected meshes are merged for rendering. */
export function createVisitorNavigation(root: T.Group, halls: InteriorHall[], obstacles: Map<string, InteriorObstacle[]>, interiorLayer?: T.Group,
  arrival?: { position: T.Vector3; heading: number; label: string }): VisitorNavigation {
  const points = new Map<string, GroundPoint[]>(), hazards: GroundPoint[][] = [], groundSurfaces: T.Mesh[] = [];
  const bounds = new T.Box2();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    let name = o.name;
    for (let p = o.parent; p && p !== root; p = p.parent) name += ' ' + p.name;
    // The earlier model by name; the Bharat Mandapam model by the roles venue-bharat-mandapam.ts sets.
    const role = o.userData['venueRole'];
    const id = name.match(/PHOTO_HALL_(12A|14|12|11|10|[1-9])(?:_| ).*roof/i)?.[1] ?? (role === 'hallRoof' ? o.userData['hall'] as string : undefined);
    const hazard = (/(?:basin|water_body|reflecting_pool)/i.test(name) && !/spray|jet|lamp/i.test(name)) || role === 'water';
    const ground = /SITE_GROUND/.test(name) || role === 'ground';
    if (role === 'ground' && o.visible) groundSurfaces.push(o);
    if (!id && !hazard && !ground) return;
    // Ground in the Bharat Mandapam model is millions of vertices: its bounds come from the box.
    if (role === 'ground' && !id && !hazard) {
      const box = new T.Box3().setFromObject(o);
      bounds.expandByPoint(new T.Vector2(box.min.x, box.min.z)).expandByPoint(new T.Vector2(box.max.x, box.max.z));
      return;
    }
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
  const spawn = arrival?.position.clone() ?? new T.Vector3(.5 * -302 + Math.sqrt(3) / 2 * 151, .35,
    -Math.sqrt(3) / 2 * -302 + .5 * 151);
  bounds.expandByPoint(new T.Vector2(spawn.x, spawn.z)).expandByScalar(22);
  return { portals, buildings, groundAt: groundSurfaces.length ? groundHeightGrid(groundSurfaces) : undefined,
    hazards, bounds, spawn, heading: arrival?.heading ?? Math.PI * 5 / 6, arrivalLabel: arrival?.label ?? 'Gate 6',
    geometry: createVisitorCollisionWorld(root, portals, interiorLayer,
      Math.max(3, ...halls.map(h => h.center.y + h.height))) };
}
export function visitorGroundHeight(nav: VisitorNavigation, point: T.Vector3, hall?: InteriorHall): number {
  const ramp = nav.portals.find(p => p.hall.level && (!hall || hall.id === p.hall.id) && inDoorway(p, point));
  if (ramp) return T.MathUtils.lerp(ramp.position.y, .24,
    T.MathUtils.clamp((portalCoordinates(ramp, point).along - VISITOR_RAMP_LANDING) / (ramp.approach - VISITOR_RAMP_LANDING), 0, 1));
  if (hall) {
    const local = worldToHall(hall, point);
    return hall.center.y + (hall.elevation?.(local.x, local.z) ?? 0);
  }
  const ground = nav.groundAt?.(point.x, point.z);
  if (ground !== undefined) return ground;
  return Math.hypot(point.x - nav.spawn.x, point.z - nav.spawn.z) < 34 ? nav.spawn.y : .24;
}
export function visitorBodyClear(nav: VisitorNavigation, point: T.Vector3, hall?: InteriorHall): boolean {
  const ground = visitorGroundHeight(nav, point, hall);
  for (const guard of nav.guards ?? []) {
    if (guard.position.y + guard.height <= ground + VISITOR_STEP || guard.position.y >= ground + VISITOR_HEIGHT) continue;
    const radius = VISITOR_RADIUS + guard.radius + .03;
    if ((point.x - guard.position.x) ** 2 + (point.z - guard.position.z) ** 2 < radius * radius) return false;
  }
  return !nav.geometry?.blocked(new T.Vector3(point.x, ground, point.z));
}
export function visitorHallWalkable(nav: VisitorNavigation, hall: InteriorHall, obstacles: InteriorObstacle[], point: T.Vector3): boolean {
  const local = worldToHall(hall, point);
  return walkable(hall, obstacles, local.x, local.z) && visitorBodyClear(nav, point, hall);
}
export function campusWalkable(nav: VisitorNavigation, point: T.Vector3): boolean {
  if (!nav.bounds.containsPoint(new T.Vector2(point.x, point.z))) return false;
  if (nav.hazards.some(p => inFootprint(p, point.x, point.z, -VISITOR_RADIUS))) return false;
  return !nav.buildings.some(building => {
    if (!inFootprint(building.polygon, point.x, point.z, -VISITOR_RADIUS)) return false;
    const portal = nav.portals.find(p => (p.hall.level ? 'cc' : p.hall.id) === building.id);
    return !portal || !inDoorway(portal, point, -VISITOR_RADIUS);
  }) && visitorBodyClear(nav, point);
}
/** Substeps stop a slow frame or fast walking from tunnelling through walls. */
export function slideVisitor(position: T.Vector3, dx: number, dz: number, allowed: (p: T.Vector3) => boolean): number {
  const startX = position.x, startZ = position.z;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .12));
  const trial = position.clone();
  for (let i = 0; i < count; i++) {
    trial.copy(position); trial.x += dx / count; trial.z += dz / count;
    if (allowed(trial)) { position.copy(trial); continue; }
    trial.copy(position); trial.x += dx / count;
    if (allowed(trial)) position.x = trial.x;
    trial.copy(position); trial.z += dz / count;
    if (allowed(trial)) position.z = trial.z;
  }
  return Math.hypot(position.x - startX, position.z - startZ);
}
