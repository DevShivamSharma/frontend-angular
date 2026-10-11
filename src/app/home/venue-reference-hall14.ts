import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CENTER = new T.Vector3(-223.60107421875, 0, 4.908121585845947);
const ANGLE = Math.PI / 3;
const FRONT = 82 * Math.PI / 180;
const CENTRAL = 38 * Math.PI / 180;
const RX = 44.05, RZ = 48.28;
const normalName = (name: string) => name.replace(/_/g, ' ');

interface Vertex { values: Record<string, number[]>; point: T.Vector3 }

/** Preserve the source's unobserved rear elevation; remove only the observed front sector. */
function retainRear(source: T.Object3D, local: T.Matrix4, replaced: Set<T.BufferGeometry>) {
  source.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const geometry = object.geometry, positions = geometry.getAttribute('position');
    const attributes = Object.entries(geometry.attributes) as [string, T.BufferAttribute][];
    const output = new Map(attributes.map(([name]) => [name, [] as number[]]));
    const matrix = new T.Matrix4().multiplyMatrices(local, object.matrixWorld);
    const edge = (RZ / RX) * Math.cos(FRONT) / Math.sin(FRONT);
    const planes = [(p: T.Vector3) => p.z - edge * p.x, (p: T.Vector3) => p.z + edge * p.x];
    const clip = (polygon: Vertex[], distance: (v: Vertex) => number) => {
      const result: Vertex[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b);
        if (da >= 0) result.push(a);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          result.push({ point: a.point.clone().lerp(b.point, t), values: Object.fromEntries(
            attributes.map(([name]) => [name, a.values[name].map((value, k) => T.MathUtils.lerp(value, b.values[name][k], t))])) });
        }
      }
      return result;
    };
    const emit = (polygon: Vertex[]) => {
      for (let i = 1; i < polygon.length - 1; i++) for (const vertex of [polygon[0], polygon[i], polygon[i + 1]])
        for (const [name] of attributes) output.get(name)!.push(...vertex.values[name]);
    };
    const count = geometry.index?.count ?? positions.count;
    for (let i = 0; i < count; i += 3) {
      let remainder: Vertex[] = [0, 1, 2].map(j => {
        const index = geometry.index?.getX(i + j) ?? i + j;
        return { point: new T.Vector3().fromBufferAttribute(positions, index).applyMatrix4(matrix),
          values: Object.fromEntries(attributes.map(([name, attribute]) => [name,
            Array.from({ length: attribute.itemSize }, (_, k) => attribute.getComponent(index, k))])) };
      });
      for (const plane of planes) {
        emit(clip(remainder, vertex => -plane(vertex.point)));
        remainder = clip(remainder, vertex => plane(vertex.point));
        if (remainder.length < 3) break;
      }
    }
    const replacement = new T.BufferGeometry();
    for (const [name, attribute] of attributes)
      replacement.setAttribute(name, new T.Float32BufferAttribute(output.get(name)!, attribute.itemSize, attribute.normalized));
    if (replacement.hasAttribute('normal')) replacement.normalizeNormals();
    else replacement.computeVertexNormals();
    replacement.computeBoundingBox(); replacement.computeBoundingSphere();
    object.geometry = replacement;
    replaced.add(geometry);
  });
}

/** Observed Hall14 frontage in DJI_20250217153134_0009_D, 8–31 seconds.
 * Registered source footprint/roof and approximate height are retained. The film
 * supports facade form and finish, not surveyed dimensions or the unseen rear.
 */
export function prepareReferenceHall14(root: T.Group): void {
  if (root.userData['referenceHall14Prepared']) return;
  const named = (name: string) => {
    let found: T.Object3D | undefined;
    root.traverse(object => { if (normalName(object.name) === normalName(name)) found = object; });
    return found;
  };
  const envelope = named('PHOTO_HALL_14 detailed envelope');
  const entrance = named('PHOTO_HALL_14 glass entrance');
  const roof = named('PHOTO_HALL_14 standing seam roof');
  if (!envelope || !entrance || !roof) return;
  root.updateMatrixWorld(true);
  const transform = new T.Matrix4().compose(CENTER, new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), ANGLE), new T.Vector3(1, 1, 1));
  const local = transform.clone().invert();
  const replaced = new Set<T.BufferGeometry>();
  retainRear(envelope, local, replaced); retainRear(entrance, local, replaced);
  entrance.name = 'PHOTO_HALL_14 retained side glazing';
  root.userData['referenceHall14Prepared'] = true;

  const group = new T.Group(); group.name = 'REFERENCE_HALL_14 observed frontage';
  group.position.copy(CENTER); group.rotation.y = ANGLE;
  group.userData = { hall: '14', destinationId: 'hall14', detailAccents: true,
    reference: 'DJI_20250217153134_0009_D.MP4', referenceSeconds: [8, 16, 31],
    reconstruction: 'Observed front sector only; existing registered footprint and approximate height retained; rear elevation unverified.' };
  const makeMaterial = (name: string, color: string, roughness = .8, metalness = .02, category = 'facade') => {
    const material = new T.MeshStandardMaterial({ name: `REFERENCE_H14_${name}`, color, roughness, metalness });
    material.userData = { architecturalCategory: category, referenceMaterial: true,
      referenceFinish: { color, roughness, metalness } };
    return material;
  };
  const cream = makeMaterial('cream fascia', '#d8d0b7');
  const terra = makeMaterial('terracotta wings', '#a55135');
  const terraLight = makeMaterial('terracotta panel variation', '#ad5a3e');
  const joint = makeMaterial('recessed panel joints', '#724535');
  const slab = makeMaterial('balcony concrete', '#b0ad9c', .9);
  const metal = makeMaterial('dark mullions', '#424644', .4, .55, 'structure');
  const glass = makeMaterial('recessed glazing', '#263d3e', .2, .32, 'glazing');
  const rail = makeMaterial('balustrade glass', '#637570', .28, .1, 'glazing');
  rail.transparent = true; rail.opacity = .42; rail.depthWrite = false;
  const roofFinish = makeMaterial('dark standing seam roof', '#594e47', .77, .3, 'roof');
  const roofRib = makeMaterial('roof seam metal', '#706a5a', .66, .4, 'roof');
  const bins = new Map<T.Material, T.BufferGeometry[]>();
  const add = (geometry: T.BufferGeometry, material: T.Material) => {
    const list = bins.get(material) ?? []; list.push(geometry); bins.set(material, list);
  };
  const surface = (from: number, to: number, bottom: number, top: number, offset: number, material: T.Material) => {
    const segments = Math.max(1, Math.ceil((to - from) / (.8 * Math.PI / 180))), vertices: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = T.MathUtils.lerp(from, to, i / segments), b = T.MathUtils.lerp(from, to, (i + 1) / segments);
      const p = (angle: number, y: number) => [(RX + offset) * Math.sin(angle), y, (RZ + offset) * Math.cos(angle)];
      vertices.push(...p(a, bottom), ...p(b, top), ...p(a, top), ...p(a, bottom), ...p(b, bottom), ...p(b, top));
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals(); add(geometry, material);
  };
  const deck = (from: number, to: number, y: number, depth: number, thickness: number) => {
    const shape = new T.Shape(), segments = Math.ceil((to - from) / (.8 * Math.PI / 180));
    for (let i = 0; i <= segments; i++) {
      const a = T.MathUtils.lerp(from, to, i / segments), x = RX * Math.sin(a), z = -RZ * Math.cos(a);
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    }
    for (let i = segments; i >= 0; i--) {
      const a = T.MathUtils.lerp(from, to, i / segments);
      shape.lineTo((RX - depth) * Math.sin(a), -(RZ - depth) * Math.cos(a));
    }
    shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth: thickness, steps: 1, bevelEnabled: false, curveSegments: 1 });
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, 0); add(geometry, slab);
  };
  const post = (angle: number, y: number, height: number, width: number, material: T.Material, offset = 0) => {
    const geometry = new T.BoxGeometry(width, height, .18);
    geometry.rotateY(angle); geometry.translate((RX + offset) * Math.sin(angle), y + height / 2, (RZ + offset) * Math.cos(angle));
    add(geometry, material);
  };

  // The solid cream crown sits above two open balcony bands; it is not a glass tower.
  surface(-CENTRAL, CENTRAL, 17.05, 25.14, 0, cream);
  surface(-FRONT, FRONT, 24.9, 25.14, .05, cream);
  for (const [from, to] of [[-FRONT, -CENTRAL], [CENTRAL, FRONT]]) {
    surface(from, to, .3, 18.05, -.38, glass);
    surface(from, to, 18.05, 24.9, 0, terra);
    const count = Math.ceil((to - from) / (.125));
    for (let i = 0; i <= count; i++) {
      const a = T.MathUtils.lerp(from, to, i / count);
      surface(a - .010, a + .010, .3, 18.05, .01, i % 3 ? terra : terraLight);
      surface(a - .001, a + .001, 18.05, 24.9, .015, joint);
    }
    for (const y of [6.35, 12.55, 18.05]) surface(from, to, y, y + .14, -.17, metal);
    for (let a = from + .032; a < to; a += .032) post(a, .4, 17.5, .06, metal, -.18);
  }
  // Recessed ground/upper glazing leaves real depth beneath the balcony soffits.
  // Give this observed entry its established name so hall navigation derives the correct front.
  const entranceGlazing = new T.Group(); entranceGlazing.name = 'PHOTO_HALL_14 glass entrance';
  entranceGlazing.userData = { hall: '14', destinationId: 'hall14', referenceMaterial: true };
  const before = bins.get(glass)?.length ?? 0;
  surface(-CENTRAL, CENTRAL, .3, 17.05, -3.4, glass);
  const frontGlass = bins.get(glass)!.splice(before);
  for (const geometry of frontGlass) {
    const mesh = new T.Mesh(geometry, glass); mesh.name = 'Hall14 recessed entrance glazing'; entranceGlazing.add(mesh);
  }
  group.add(entranceGlazing);
  for (const y of [.24, 6.3, 12.5]) deck(-CENTRAL, CENTRAL, y, 4, y < 1 ? .12 : .38);
  for (const y of [6.72, 12.92]) {
    surface(-CENTRAL, CENTRAL, y, y + 1.02, -.12, rail);
    surface(-CENTRAL, CENTRAL, y + 1.02, y + 1.09, -.09, metal);
    surface(-CENTRAL, CENTRAL, y, y + .06, -.09, metal);
    for (let a = -CENTRAL; a <= CENTRAL; a += .07) post(a, y, 1.08, .065, metal, -.06);
  }
  for (const a of [-CENTRAL, CENTRAL]) post(a, .35, 16.7, .55, cream, -.3);
  for (let a = -CENTRAL + .11; a < CENTRAL; a += .11) post(a, .4, 16.6, .075, metal, -3.32);
  for (const [material, geometries] of bins) {
    if (!geometries.length) continue;
    const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);
    // Common attributes allow analytic panels and box/extrusion detail to share one draw call.
    for (const geometry of flat) for (const key of Object.keys(geometry.attributes))
      if (key !== 'position' && key !== 'normal') geometry.deleteAttribute(key);
    const geometry = mergeGeometries(flat, false)!;
    const mesh = new T.Mesh(geometry, material); mesh.name = `REFERENCE_H14 ${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    flat.forEach(g => g.dispose()); geometries.forEach(g => { if (!flat.includes(g)) g.dispose(); });
  }
  root.add(group);
  roof.userData['detailAccents'] = true;
  roof.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    const next = mats.map(material => /steel/i.test(material.name) ? roofRib : roofFinish);
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  // Neither of these floating roof annotations appears on the unobstructed video roof.
  for (const name of ['PHOTO_ROOF_SIGN_BOARD_H14', 'ROOF_LABEL_H14']) {
    const annotation = named(name);
    annotation?.traverse(object => { if (object instanceof T.Mesh) replaced.add(object.geometry); });
    annotation?.removeFromParent();
  }
  const sign = named('ARCH_H14_SIGN');
  if (sign) {
    sign.position.add(new T.Vector3(Math.sin(ANGLE), 0, Math.cos(ANGLE)).multiplyScalar(.5));
    sign.userData['detailAccents'] = true;
    const lettering = makeMaterial('entrance lettering', '#e4e1ce', .7);
    sign.traverse(object => { if (object instanceof T.Mesh) object.material = lettering; });
  }
  // Some glTF meshes share buffers. Dispose only resources no longer referenced by the scene.
  root.traverse(object => { if (object instanceof T.Mesh) replaced.delete(object.geometry); });
  replaced.forEach(geometry => geometry.dispose());
  root.updateMatrixWorld(true);
}
