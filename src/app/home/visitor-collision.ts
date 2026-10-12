import * as T from 'three';
import type { VisitorPortal } from './visitor-navigation';
import { visitorOpening, VISITOR_ENTRANCE_LINING } from './visitor-doorway';

// Encloses the avatar's shoulders, swinging arms and shoes in every heading.
export const VISITOR_RADIUS = .6;
export const VISITOR_HEIGHT = 1.9;
export const VISITOR_STEP = .12;
const SKIN = .015;
type Polygon = T.Vector3[];
type Point2 = { x: number; z: number };
interface Face {
  polygon: Polygon;
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  sliceY?: number;
  slice?: Point2[];
  source: string;
}

/** Retain one side of a plane, including new vertices where an edge crosses it. */
function clip(polygon: Polygon, distance: (p: T.Vector3) => number): Polygon {
  const result: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) result.push(a.clone().lerp(b, da / (da - db)));
  }
  return result;
}

/** Cut exactly the opening drawn by visitor-portals, rather than ignoring a wall mesh. */
function subtractOpening(polygon: Polygon, opening: ReturnType<typeof visitorOpening>): Polygon[] {
  const planes = opening.planes.map(plane => (q: T.Vector3) => -plane.distanceToPoint(q));
  if (planes.some(plane => polygon.every(v => plane(v) < 0))) return [polygon];
  const outside: Polygon[] = [];
  let remainder = polygon;
  for (const plane of planes) {
    const part = clip(remainder, q => -plane(q));
    if (part.length >= 3) outside.push(part);
    remainder = clip(remainder, plane);
    if (remainder.length < 3) break;
  }
  return outside;
}

function overlapsBody(polygon: Point2[], x: number, z: number): boolean {
  let positive = false, negative = false, area = 0;
  const radius2 = (VISITOR_RADIUS + SKIN) ** 2;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dz = b.z - a.z;
    const side = dx * (z - a.z) - dz * (x - a.x);
    positive ||= side > 1e-8; negative ||= side < -1e-8;
    area += a.x * b.z - b.x * a.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
    if ((x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2 < radius2) return true;
  }
  return Math.abs(area) > 1e-8 && !(positive && negative);
}

export interface VisitorCollisionWorld {
  /** A vertical body collider against both sides of the actual model triangles. */
  blocked(position: T.Vector3): boolean;
  obstacleAt(position: T.Vector3): string | undefined;
  readonly faceCount: number;
}

/** Build before render batching. Disconnected pillars stay disconnected; roofs
 * above the avatar and walkable floors do not become invisible ground obstacles. */
export function createVisitorCollisionWorld(root: T.Object3D, portals: VisitorPortal[], interiorLayer?: T.Object3D, maxHeight = Infinity): VisitorCollisionWorld {
  const grids = [2, 16, 128, 2048].map(size => ({ size, cells: new Map<string, Face[]>() }));
  const radius = VISITOR_RADIUS + SKIN;
  let faceCount = 0;
  const openings = portals.map(visitorOpening);
  function add(polygon: Polygon, source: string) {
    const box = new T.Box3().setFromPoints(polygon);
    const face: Face = { polygon, source, minX: box.min.x, maxX: box.max.x, minY: box.min.y,
      maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
    faceCount++;
    const minY = Math.floor((box.min.y - VISITOR_HEIGHT) / 4), maxY = Math.floor((box.max.y - VISITOR_STEP) / 4);
    for (const { size, cells } of grids) {
      const minX = Math.floor((box.min.x - radius) / size), maxX = Math.floor((box.max.x + radius) / size);
      const minZ = Math.floor((box.min.z - radius) / size), maxZ = Math.floor((box.max.z + radius) / size);
      if ((maxX - minX + 1) * (maxZ - minZ + 1) > 128 && size < 2048) continue;
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) for (let y = minY; y <= maxY; y++) {
        const key = `${x},${z},${y}`, bucket = cells.get(key);
        if (bucket) bucket.push(face); else cells.set(key, [face]);
      }
      break;
    }
  }
  function collect(object: T.Object3D, carveEntrances: boolean) {
    object.updateMatrixWorld(true);
    object.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      let name = o.name;
      for (let p = o.parent; p && p !== object; p = p.parent) name += ' ' + p.name;
      // Gate 9 opens before a visitor reaches it. Its stationary piers, fence,
      // cabins and lane barriers still participate in the triangle collider.
      if (/GATE9_moving_leaf_/.test(name)) return;
      // These are explicitly non-solid render layers. Gate 6's panels are hidden
      // by visitor-portals during the visit; its piers and surrounding fence remain solid.
      if (/source.floor.plan|floor.plate|adapted.floor.deck|SITE_GROUND|CONTEXT_GROUND|OUTER_GROUND|LAWNS|asphalt|paving|lane.marking|edge.inlay|leaf.canop|falling.water|water.body|cascade.water|spray|jets|nozzle|PHOTO_GATE_6.*(?:fence.panels|pickets.and.rails)/i.test(name)) return;
      if (carveEntrances) {
        for (let p: T.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      }
      const attribute = o.geometry.getAttribute('position'), index = o.geometry.index;
      if (!attribute) return;
      const count = index?.count ?? attribute.count;
      const instance = new T.Matrix4(), matrix = new T.Matrix4();
      for (let k = 0; k < (o instanceof T.InstancedMesh ? o.count : 1); k++) {
        if (o instanceof T.InstancedMesh) { o.getMatrixAt(k, instance); matrix.multiplyMatrices(o.matrixWorld, instance); }
        else matrix.copy(o.matrixWorld);
        for (let i = 0; i + 2 < count; i += 3) {
          const polygon = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(attribute, index ? index.getX(i + j) : i + j).applyMatrix4(matrix));
          // Discard surfaces outside the supported floors' vertical extent.
          if (polygon.every(p => p.y < .12) || polygon.every(p => p.y > maxHeight)) continue;
          let pieces = [polygon];
          if (carveEntrances || VISITOR_ENTRANCE_LINING.test(name)) {
            const bounds = new T.Box3().setFromPoints(polygon);
            for (const opening of openings) if (opening.bounds.intersectsBox(bounds))
              pieces = pieces.flatMap(part => subtractOpening(part, opening));
          }
          for (const part of pieces) add(part, name);
        }
      }
    });
  }
  collect(root, true);
  if (interiorLayer) collect(interiorLayer, false);
  function collides(face: Face, p: T.Vector3): boolean {
    const bottom = p.y + VISITOR_STEP, top = p.y + VISITOR_HEIGHT;
    if (face.maxY <= bottom || face.minY >= top || p.x < face.minX - radius || p.x > face.maxX + radius ||
        p.z < face.minZ - radius || p.z > face.maxZ + radius) return false;
    if (face.sliceY !== p.y) {
      face.sliceY = p.y;
      face.slice = clip(clip(face.polygon, q => q.y - bottom), q => top - q.y).map(q => ({ x: q.x, z: q.z }));
    }
    return !!face.slice?.length && overlapsBody(face.slice, p.x, p.z);
  }
  return {
    get faceCount() { return faceCount; },
    blocked(p) { return this.obstacleAt(p) !== undefined; },
    obstacleAt(p) {
      for (const { size, cells } of grids) {
        const hit = cells.get(`${Math.floor(p.x / size)},${Math.floor(p.z / size)},${Math.floor(p.y / 4)}`)?.find(face => collides(face, p));
        if (hit) return hit.source;
      }
      return undefined;
    },
  };
}
