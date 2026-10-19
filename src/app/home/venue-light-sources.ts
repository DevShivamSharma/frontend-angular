import * as T from 'three';
import type { Gate9Light } from './venue-gate9';
import type { Triple } from './venue.models';
import type { VisitorPortal } from './visitor-navigation';

export type VenueLightKind = Gate9Light['kind'] | 'bollard' | 'entrance';
export interface VenueLightSource {
  kind: VenueLightKind;
  position: Triple;
  aim?: Triple;
  ground?: Triple;
  name: string;
}

/** Only luminous faces glow, never the graphite poles or luminaire housings. */
export function isVenueEmitter(material: T.MeshStandardMaterial): boolean {
  return /diffuser|kiosk glazing|ENTRY sign|recessed line lights/i.test(material.name) ||
    ['reference_fixture_light', 'conceptual_edge_light'].includes(material.userData['architecturalCategory']);
}

/** Recover separate fixtures from already-merged GLB meshes, before venue batching.
 * Weld face seams, then sample long canopy strips along their actual geometry.
 */
function emitterPositions(mesh: T.Mesh): T.Vector3[] {
  const geometry = mesh.geometry, position = geometry.getAttribute('position');
  if (!position) return [];
  const parent = Array.from({ length: position.count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const welded = new Map<string, number>();
  const vertices: T.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    vertices.push(p);
    const key = [p.x, p.y, p.z].map(v => Math.round(v * 1000)).join(',');
    const previous = welded.get(key);
    if (previous === undefined) welded.set(key, i); else join(i, previous);
  }
  const index = geometry.index;
  for (let i = 0; i + 2 < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i;
    join(a, index ? index.getX(i + 1) : i + 1);
    join(a, index ? index.getX(i + 2) : i + 2);
  }
  const components = new Map<number, T.Vector3[]>();
  vertices.forEach((p, i) => { const key = find(i); const group = components.get(key) ?? []; group.push(p); components.set(key, group); });
  const result: T.Vector3[] = [];
  for (const points of components.values()) {
    const bounds = new T.Box3().setFromPoints(points), center = bounds.getCenter(new T.Vector3());
    const size = bounds.getSize(new T.Vector3());
    if (size.length() < 8) { result.push(center); continue; }
    const furthest = (from: T.Vector3) => points.reduce((a, b) => b.distanceToSquared(from) > a.distanceToSquared(from) ? b : a);
    const a = furthest(points[0]), b = furthest(a), axis = b.clone().sub(a).normalize();
    const width = Math.max(...points.map(p => p.clone().sub(a).cross(axis).length()));
    if (width < 3) {
      const count = Math.ceil(a.distanceTo(b) / 14);
      for (let i = 0; i < count; i++) result.push(a.clone().lerp(b, (i + .5) / count).setY(center.y));
    } else {
      // Curved CC soffit rings: retain the perimeter, never a light at its empty centre.
      const samples: T.Vector3[] = [];
      for (const p of points) if (samples.every(q => q.distanceToSquared(p) > 12 ** 2)) samples.push(p.clone());
      result.push(...samples);
    }
  }
  return result;
}

/** Capture actual fixture world positions before batching destroys their identities. */
export function collectVenueLightSources(root: T.Group, gate9: Gate9Light[], portals: VisitorPortal[]): VenueLightSource[] {
  root.updateMatrixWorld(true);
  const sources: VenueLightSource[] = gate9.map((light, i) => ({ ...light, name: `Gate 9 ${light.kind} ${i}` }));
  const receivers: { mesh: T.Mesh; bounds: T.Box3 }[] = [];
  const gateLintels: T.Mesh[] = [];
  root.traverseVisible(object => {
    if (!(object instanceof T.Mesh)) return;
    for (let node: T.Object3D | null = object; node; node = node.parent)
      if (node.userData['supersededBySiteReference']) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const gate = object.name.match(/^PHOTO_GATE_([^ _]+)[ _]sandstone[ _]lintel$/i);
    if (gate && !['6', '9'].includes(gate[1])) gateLintels.push(object);
    if (/GROUND|paving|pavement|road|floor|plaza|walkway|lawn/i.test(object.name) && !/roof|canopy|wall|rail|marking|label/i.test(object.name))
      receivers.push({ mesh: object, bounds: new T.Box3().setFromObject(object) });
    // The authoritative Gate 9 manifest includes aiming and the corrected shelter.
    for (let node: T.Object3D | null = object; node; node = node.parent)
      if (node.name === 'GATE9 photographic entrance') return;
    if (!materials.some(m => m instanceof T.MeshStandardMaterial && isVenueEmitter(m))) return;
    if (/projector|cornice/i.test(object.name)) return; // facade accents remain emissive
    for (const p of emitterPositions(object)) {
      const kind: VenueLightKind = /bollard/i.test(object.name) ? 'bollard' :
        /canopy|concourse/i.test(object.name) ? 'canopy' : p.y > 14 ? 'flood' : 'lamp';
      if (sources.some(s => new T.Vector3(...s.position).distanceToSquared(p) < 2 ** 2)) continue;
      sources.push({ kind, position: p.toArray() as Triple, name: object.name });
    }
  });

  // Small downlight bars at the existing hall/CC doorways. Positions follow the
  // actual visitor portals, not hall bounding-box centres or invented roads.
  const fixtures = new T.Group(); fixtures.name = 'Venue entrance downlights';
  const housing = new T.MeshStandardMaterial({ color: 0x343934, roughness: .8 });
  const diffuser = new T.MeshStandardMaterial({ color: 0xffefd7, roughness: .5 });
  diffuser.name = 'Venue entrance warm diffuser';
  const housingGeometry = new T.BoxGeometry(1.6, .12, .32);
  const diffuserGeometry = new T.PlaneGeometry(1.45, .24); diffuserGeometry.rotateX(Math.PI / 2);
  const gateHousing = new T.CylinderGeometry(.22, .22, .12, 8);
  const gateFace = new T.CircleGeometry(.18, 8); gateFace.rotateX(Math.PI / 2);
  for (const lintel of gateLintels) {
    const bottom = new T.Box3().setFromObject(lintel).min.y;
    for (const p of emitterPositions(lintel)) {
      p.y = bottom - .07;
      const body = new T.Mesh(gateHousing, housing), face = new T.Mesh(gateFace, diffuser);
      body.name = `${lintel.name} downlight housing`; face.name = `${lintel.name} downlight diffuser`;
      body.position.copy(p); face.position.copy(p).y -= .065;
      fixtures.add(body, face);
      sources.push({ kind: 'lamp', position: [p.x, p.y - .13, p.z], name: `${lintel.name} downlight` });
    }
  }
  for (const portal of portals) {
    if (portal.hall.level && portal.hall.level > 1) continue;
    const p = portal.position.clone().addScaledVector(portal.outward, .35); p.y += 3.2;
    const body = new T.Mesh(housingGeometry, housing), face = new T.Mesh(diffuserGeometry, diffuser);
    body.name = `Venue ${portal.hall.id} entrance housing`; face.name = `Venue ${portal.hall.id} entrance diffuser`;
    body.position.copy(p); face.position.copy(p).y -= .065;
    body.rotation.y = face.rotation.y = Math.atan2(portal.outward.x, portal.outward.z);
    fixtures.add(body, face);
    sources.push({ kind: 'entrance', position: [p.x, p.y - .12, p.z],
      aim: portal.position.clone().addScaledVector(portal.outward, 2.5).toArray() as Triple,
      name: `${portal.hall.id} entrance` });
  }
  if (fixtures.children.length) root.add(fixtures);
  else { housing.dispose(); diffuser.dispose(); }
  if (!portals.length) { housingGeometry.dispose(); diffuserGeometry.dispose(); }
  if (!gateLintels.length) { gateHousing.dispose(); gateFace.dispose(); }

  // Locate the receiving surface once. No floating light circles, roof decals,
  // or per-frame raycasts. A missing ground hit simply omits the distant pool.
  const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  for (const source of sources) {
    const p = new T.Vector3(...source.position), at = source.aim ? new T.Vector3(...source.aim) : p;
    ray.set(new T.Vector3(at.x, p.y - .15, at.z), down); ray.far = Math.max(4, p.y + 10);
    const candidates = receivers.filter(({ bounds: b }) => at.x >= b.min.x && at.x <= b.max.x && at.z >= b.min.z && at.z <= b.max.z).map(r => r.mesh);
    const hit = ray.intersectObjects(candidates, false)[0];
    if (hit) source.ground = [hit.point.x, hit.point.y + .035, hit.point.z];
  }
  root.userData['nightLighting'] = { sourceCount: sources.length, kinds: Object.fromEntries(
    [...new Set(sources.map(s => s.kind))].map(kind => [kind, sources.filter(s => s.kind === kind).length])) };
  return sources;
}
