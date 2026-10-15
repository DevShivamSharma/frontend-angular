import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VisitorPortal } from './visitor-navigation';

const S = new T.Vector3(.5, 0, -Math.sqrt(3) / 2);
const U = new T.Vector3(Math.sqrt(3) / 2, 0, .5);
const KEY = 'groundPhotoDetails';

/** Ground photos supplied 14 October: details fitted to the registered model.
 * Keep all surfaces static/batched. No new routes or relocated hall footprints.
 * Call before collision capture so the column sleeves are solid to visitors. */
export function prepareGroundPhotoDetails(root: T.Group, bannerTexture?: T.Texture) {
  if (root.userData[KEY]) return;
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const group = new T.Group(); group.name = 'PHOTO_ground_concourse_details';
  const floor: T.BufferGeometry[] = [], border: T.BufferGeometry[] = [], bases: T.BufferGeometry[] = [], banners: T.BufferGeometry[] = [];
  const columns: { point: T.Vector3; along: T.Vector3 }[] = [];
  let strips = 0;
  root.traverse(object => {
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
    const name = `${object.name} ${object.parent?.name}`;
    const geometry = object.geometry, attr = geometry.getAttribute('position');
    const transform = inverse.clone().multiply(object.matrixWorld);
    if (object.userData['referenceConcourse']?.finish === 'paving') {
      const indices = geometry.index;
      if (!indices) return;
      for (let i = 0; i < indices.count; i += 6) {
        const ids = [...new Set(Array.from({ length: 6 }, (_, k) => indices.getX(i + k)))];
        if (ids.length !== 4) continue;
        const p = ids.map(id => new T.Vector3().fromBufferAttribute(attr, id).applyMatrix4(transform));
        if (Math.max(...p.map(v => v.y)) - Math.min(...p.map(v => v.y)) > .02) continue;
        const center = p.reduce((sum, v) => sum.add(v), new T.Vector3()).multiplyScalar(.25);
        p.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
        // Each authored strip is short along the path, wide across it.
        let longest = 0;
        for (let j = 1; j < 4; j++) if (p[j].distanceTo(p[(j + 1) % 4]) > p[longest].distanceTo(p[(longest + 1) % 4])) longest = j;
        const [a, b, c, d] = [0, 1, 2, 3].map(j => p[(longest + j) % 4]);
        const width = a.distanceTo(b);
        if (width < 5) continue;
        for (const fraction of [.14, .86]) {
          const x = a.clone().lerp(b, fraction), y = d.clone().lerp(c, fraction);
          floor.push(ribbon(x, y, .32, .018));
          border.push(ribbon(x, y, .64, .009)); strips++;
        }
      }
    }
    if (!/PHOTO_(CENTRAL_SPINE_continuous_canopy|HALLS_corrected_covered_approach)_columns_trusses/.test(name)) return;
    const points: T.Vector3[] = [];
    for (let i = 0; i < attr.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(attr, i).applyMatrix4(transform);
      if (p.y < .6 && p.y > -.1 && !points.some(q => q.distanceToSquared(p) < .001)) points.push(p);
    }
    const clusters: T.Vector3[][] = [];
    for (const p of points) {
      const cluster = clusters.find(c => c.some(q => q.distanceToSquared(p) < 1));
      if (cluster) cluster.push(p); else clusters.push([p]);
    }
    for (const cluster of clusters) {
      const point = new T.Box3().setFromPoints(cluster).getCenter(new T.Vector3()).setY(.18);
      if (!columns.some(c => c.point.distanceToSquared(point) < 1)) columns.push({ point, along: /CENTRAL_SPINE/.test(name) ? U : S });
    }
  });
  const stone = finish('PHOTO charcoal stone column bases', 0x3d4241, .7);
  const tactile = finish('PHOTO yellow tactile paving', 0xd4b66a, .65);
  tactile.map = tactileTile();
  const cobble = finish('PHOTO grey tactile border', 0x858d85, .85);
  for (const { point, along } of columns) {
    // A tapered stone sleeve on the existing support, never a new column.
    const base = new T.CylinderGeometry(.72, .9, 1.05, 4, 1).rotateY(Math.PI / 4);
    base.rotateY(Math.atan2(along.x, along.z)); base.translate(point.x, point.y + .525, point.z); bases.push(base);
  }
  // The event photograph supplies the actual banner artwork. UVs select only
  // the sign in the untouched photo; the rest of the reference is never shown.
  if (bannerTexture) {
    bannerTexture.colorSpace = T.SRGBColorSpace; bannerTexture.anisotropy = 4;
    columns.sort((a, b) => a.point.dot(a.along) - b.point.dot(b.along));
    columns.forEach(({ point, along }, i) => {
      if (i % Math.ceil(columns.length / 32)) return;
      const across = new T.Vector3(along.z, 0, -along.x);
      const center = point.clone().addScaledVector(along, .25).setY(3.45);
      const p = [[-.95, 1.2], [.95, 1.2], [.62, -1.2], [-.62, -1.2]].map(([x, y]) => center.clone().addScaledVector(across, x).add(new T.Vector3(0, y, 0)));
      // The first quad faces -along: its +across edge is the viewer's left.
      const uv = [414 / 720, 1 - 111 / 1280, 94 / 720, 1 - 137 / 1280, 180 / 720, 1 - 594 / 1280, 290 / 720, 1 - 597 / 1280];
      banners.push(quad(p, uv));
      // Separate front faces keep text readable from either travel direction.
      banners.push(quad([p[1], p[0], p[3], p[2]].map(v => v.clone().addScaledVector(along, .012)), uv));
    });
    const material = finish('PHOTO event banner', 0xffffff, .85); material.map = bannerTexture;
    addMerged(group, banners, material, 'PHOTO_concourse_event_banners');
  }
  addMerged(group, bases, stone, 'PHOTO_concourse_stone_column_bases');
  addMerged(group, border, cobble, 'PHOTO_concourse_tactile_border');
  addMerged(group, floor, tactile, 'PHOTO_concourse_tactile_paving');
  root.add(group); root.updateMatrixWorld(true);
  root.userData[KEY] = { strips, columnSleeves: columns.length, banners: banners.length / 2,
    reference: 'User ground photographs 2026-10-14',
    registration: 'Existing paths and supports; detail sizes and banner spacing estimated from photos' };
}

/** Recessed timber ceilings and carpet at the three photographed entrances.
 * All added solid detail is overhead; door/ramp clearances remain unchanged. */
export function preparePhotoEntrances(root: T.Group, portals: VisitorPortal[]) {
  if (root.userData['photoEntrances']) return;
  const group = new T.Group(); group.name = 'PHOTO_hall_entrance_finishes';
  const ceilings: T.BufferGeometry[] = [], carpets: T.BufferGeometry[] = [], trim: T.BufferGeometry[] = [];
  let count = 0;
  for (const portal of portals) {
    if (!['hall2', 'hall4', 'hall5'].includes(portal.hall.id)) continue;
    const rotation = new T.Quaternion().setFromAxisAngle(T.Object3D.DEFAULT_UP, Math.atan2(portal.outward.x, portal.outward.z));
    const transform = new T.Matrix4().compose(portal.position, rotation, new T.Vector3(1, 1, 1));
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new T.BoxGeometry(w, h, d).translate(x, y, z).applyMatrix4(transform);
    ceilings.push(box(10, .12, 4.4, 0, 4.8, 1.8));
    for (let z = -.3; z < 4; z += .22) trim.push(box(10, .025, .025, 0, 4.73, z));
    const carpetHeight = Math.max(.24, portal.position.y) - portal.position.y + .02;
    carpets.push(box(6.4, .015, 5.4, 0, carpetHeight, 2.7)); count++;
  }
  addMerged(group, ceilings, finish('PHOTO timber entrance soffits', 0x705039, .65), 'PHOTO_hall_entrance_wood_soffits');
  addMerged(group, trim, finish('PHOTO timber ceiling joints', 0x3c3027, .85), 'PHOTO_hall_entrance_ceiling_joints');
  addMerged(group, carpets, finish('PHOTO red entrance carpet', 0xb91d2a, 1), 'PHOTO_hall_entrance_carpet');
  root.add(group); root.userData['photoEntrances'] = { count, dimensions: 'Estimated; anchored to existing visitor doors' };
}

function finish(name: string, color: number, roughness: number) {
  const material = new T.MeshStandardMaterial({ color, roughness }); material.name = name;
  material.userData = { referenceMaterial: true, architecturalCategory: 'reference_photo' }; return material;
}
function quad(points: T.Vector3[], uv: number[]) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals(); return geometry;
}
function ribbon(a: T.Vector3, b: T.Vector3, width: number, lift: number) {
  const along = b.clone().sub(a), side = new T.Vector3(-along.z, 0, along.x).normalize().multiplyScalar(width / 2);
  const points = [a.clone().add(side), b.clone().add(side), b.clone().sub(side), a.clone().sub(side)];
  points.forEach(p => p.y += lift);
  return quad(points, [0, 0, 0, along.length() / .32, 1, along.length() / .32, 1, 0]);
}
function addMerged(group: T.Group, parts: T.BufferGeometry[], material: T.Material, name: string) {
  if (!parts.length) { material.dispose(); return; }
  const geometry = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose());
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new T.Mesh(geometry, material); mesh.name = name; mesh.receiveShadow = true; group.add(mesh);
}
function tactileTile() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const shade = y < 2 ? .65 : x % 12 < 3 ? .75 : 1, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(shade * 255); data[i + 3] = 255;
  }
  const map = new T.DataTexture(data, size, size); map.wrapS = map.wrapT = T.RepeatWrapping;
  map.generateMipmaps = true; map.minFilter = T.LinearMipmapLinearFilter; map.needsUpdate = true; return map;
}
