import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number];
interface Building { id: number; p: Point[]; holes?: Point[][]; h: number; base: number; roof: string; wall: string; }
interface Railway { id: number; p: Point[]; y: number; w: number; gauge: number; metro: boolean; }
export interface VenueSurroundings { coverage: Point[]; photoExclusion: Point[][][]; buildings: Building[]; railways: Railway[]; }

/** All coordinates are already registered offline through the z18 satellite fit. */
export function insideSurroundings(point: Point, ring: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) &&
      point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  return hit;
}

/** Static volumes and railway ribbons: four active material batches, no added textures or shadow draws. */
export function createVenueSurroundings(data: VenueSurroundings) {
  const group = new T.Group(); group.name = 'Satellite-registered OSM surroundings (Color → Map)';
  const buildings = new T.LOD(), trackDetail = new T.LOD();
  const materials: T.MeshBasicMaterial[] = [];
  const volumes: T.BufferGeometry[] = [], footprints: T.BufferGeometry[] = [];
  const beds: T.BufferGeometry[] = [], structures: T.BufferGeometry[] = [], rails: T.BufferGeometry[] = [];
  const grade = -6.9; // groundGroup adds 6.6 m, matching the existing local map.
  const light = new T.Vector3(-.6, 0, .8).normalize();

  function shape(p: Point[], holes: Point[][] = []) {
    const result = new T.Shape(p.map(([x, z]) => new T.Vector2(x, -z)));
    for (const hole of holes) result.holes.push(new T.Path(hole.map(([x, z]) => new T.Vector2(x, -z))));
    return result;
  }
  function add(bin: T.BufferGeometry[], geometry: T.BufferGeometry, roof: string, wall = roof) {
    if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
    // All batches use the same compact attributes; UVs are unnecessary without textures.
    geometry.deleteAttribute('uv');
    const normals = geometry.getAttribute('normal'), colours = new Float32Array(normals.count * 3);
    const top = new T.Color(roof), side = new T.Color(wall), n = new T.Vector3();
    for (let i = 0; i < normals.count; i++) {
      n.fromBufferAttribute(normals, i);
      const colour = n.y > .5 ? top : side, shade = n.y > .5 ? 1 : .67 + .23 * Math.max(0, n.dot(light));
      colours.set([colour.r * shade, colour.g * shade, colour.b * shade], i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colours, 3)); bin.push(geometry);
  }
  function batch(bin: T.BufferGeometry[], name: string): T.Object3D {
    if (!bin.length) return new T.Group();
    const geometry = mergeGeometries(bin, false); bin.forEach(g => g.dispose());
    if (!geometry) throw new Error('Incompatible surroundings geometry');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false });
    materials.push(material);
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    // Resolve before the transparent campus layers. Depth writes keep roofs and walls solid.
    mesh.renderOrder = -1;
    return mesh;
  }
  function box(bin: T.BufferGeometry[], a: Point, b: Point, width: number, height: number, y: number, colour: string) {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < .1) return;
    const geometry = new T.BoxGeometry(width, height, length);
    geometry.rotateY(Math.atan2(dx, dz)); geometry.translate((a[0] + b[0]) / 2, grade + y + height / 2, (a[1] + b[1]) / 2);
    add(bin, geometry, colour);
  }
  // Joined ribbons follow every OSM vertex. Bounded mitres keep switch junctions from producing spikes.
  function ribbon(p: Point[], width: number, offset: number, y: number) {
    const edges: number[][] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
      const next = p[i === p.length - 1 ? i - 1 : i + 1], sx = next[0] - p[i][0], sz = next[1] - p[i][1];
      const stretch = Math.min(1.6, 1 / Math.max(.01, Math.abs((dx * sx + dz * sz) / length / (Math.hypot(sx, sz) || 1))));
      edges.push([p[i][0] + dz / length * (offset - width / 2) * stretch, grade + y, p[i][1] - dx / length * (offset - width / 2) * stretch,
        p[i][0] + dz / length * (offset + width / 2) * stretch, grade + y, p[i][1] - dx / length * (offset + width / 2) * stretch]);
    }
    const vertices: number[] = [];
    for (let i = 1; i < edges.length; i++) {
      const a = edges[i - 1], b = edges[i];
      vertices.push(...a.slice(0, 3), ...b.slice(0, 3), ...a.slice(3), ...b.slice(0, 3), ...b.slice(3), ...a.slice(3));
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    return geometry;
  }
  for (const b of data.buildings) {
    const outline = shape(b.p, b.holes);
    const volume = new T.ExtrudeGeometry(outline, { depth: b.h - b.base, bevelEnabled: false, steps: 1, curveSegments: 1 });
    volume.rotateX(-Math.PI / 2); volume.translate(0, grade + b.base, 0);
    add(volumes, volume, b.roof, b.wall);
    const footprint = new T.ShapeGeometry(outline); footprint.rotateX(-Math.PI / 2); footprint.translate(0, grade + .04, 0);
    add(footprints, footprint, b.roof);
  }
  // Sleepers are close-view detail only. A fixed cap bounds geometry even if a future extract is denser.
  let sleepers = 0;
  for (const rail of data.railways) {
    const y = rail.y + .12;
    add(beds, ribbon(rail.p, rail.w, 0, y), rail.metro ? '#8e9088' : '#726653');
    for (const offset of [-rail.gauge / 2, rail.gauge / 2])
      add(rails, ribbon(rail.p, .15, offset, y + .12), '#b2afa1');
    let sleeperAt = 0, pierAt = 12, traversed = 0;
    for (let i = 1; i < rail.p.length; i++) {
      const a = rail.p[i - 1], b = rail.p[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < .1) continue;
      if (rail.y > 0) box(structures, a, b, rail.w, 1, rail.y - 1, '#aaa99e');
      const at = (d: number): Point => [a[0] + dx * d / length, a[1] + dz * d / length];
      while (sleeperAt < traversed + length && sleepers < 9000) {
        const p = at(sleeperAt - traversed), half = rail.gauge * .78;
        const ends: Point[] = [[p[0] - dz / length * half, p[1] + dx / length * half], [p[0] + dz / length * half, p[1] - dx / length * half]];
        add(rails, ribbon(ends, .28, 0, y + .05), '#a19680');
        sleeperAt += 3; sleepers++;
      }
      if (rail.y > 0) while (pierAt < traversed + length) {
        const p = at(pierAt - traversed), pier = new T.BoxGeometry(1.5, rail.y - 1, 1.5);
        pier.translate(p[0], grade + (rail.y - 1) / 2, p[1]); add(structures, pier, '#a7a69c'); pierAt += 32;
      }
      traversed += length;
    }
  }
  buildings.addLevel(batch(volumes, 'OSM footprint buildings · walls and roof tones'), 0);
  buildings.addLevel(batch(footprints, 'OSM building footprints · distant LOD'), 3800, .12);
  trackDetail.addLevel(batch(rails, 'Railway rails and sleepers · near LOD'), 0);
  trackDetail.addLevel(new T.Group(), 2300, .12);
  group.add(buildings, trackDetail, batch(beds, 'Railway ballast and metro track beds'), batch(structures, 'Elevated metro and rail bridges'));
  return { group, update(camera: T.PerspectiveCamera, opacity: number) {
    buildings.update(camera); trackDetail.update(camera);
    for (const material of materials) material.opacity = opacity;
  } };
}
