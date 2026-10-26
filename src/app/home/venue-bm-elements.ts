import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { venueBatchSemantics } from './venue-classify';

/**
 * Elements copied from the Bharat Mandapam CAD model (scripts/extract-bm-elements.mjs) and fitted onto the
 * earlier model. An element that is on replaces the matching earlier parts: inside its own footprint, or all of them
 * (manifest `cut`).
 * Turning one off brings the earlier part back exactly as before.
 */
export const VENUE_BM_ELEMENTS: Readonly<Record<string, boolean>> = {
  tunnel: true,
  forecourt: true,
  amphitheatre1: true,
  amphitheatre2: true,
  // The CAD Hall 14 is an oval of 144 x 103 m; the earlier drum is 94 x 85 m and carries the Hall 14 interior.
  hall14: false,
};

export interface BmElementManifest {
  elements: { id: string; label: string; replaces: string[]; cut: 'footprint' | 'all'; footprint: [number, number][]; tags: Record<string, string>; materials: Record<string, string> }[];
}
export interface BmElementsResult { added: string[]; earlierTrianglesRemoved: number; earlierMeshesHidden: number }

/** Load venue-bm-elements.glb/json and apply them. Failure leaves the earlier model untouched. */
export async function prepareBmElements(root: T.Group, asset: (path: string) => string, signal: AbortSignal,
    classify: (o: T.Object3D) => string | null = () => null): Promise<BmElementsResult> {
  const [glbResponse, jsonResponse] = await Promise.all([fetch(asset('venue-bm-elements.glb'), { signal }), fetch(asset('venue-bm-elements.json'), { signal })]);
  if (!glbResponse.ok || !jsonResponse.ok) throw new Error('Bharat Mandapam elements unavailable');
  const [bytes, manifest] = await Promise.all([glbResponse.arrayBuffer(), jsonResponse.json() as Promise<BmElementManifest>]);
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
  signal.throwIfAborted();
  return applyBmElements(root, gltf.scene, manifest, VENUE_BM_ELEMENTS, classify);
}

/** Attach the enabled elements and cut the earlier parts they replace. Runs before batching and navigation. */
export function applyBmElements(root: T.Group, elements: T.Object3D, manifest: BmElementManifest,
    enabled: Readonly<Record<string, boolean>> = VENUE_BM_ELEMENTS, classify: (o: T.Object3D) => string | null = () => null): BmElementsResult {
  root.updateMatrixWorld(true);
  // The attribute set (with or without UV) the earlier meshes have per material and batch semantics, so an added
  // part lands in an existing batch instead of opening a draw call of its own.
  const materials = new Map<string, T.Material>(), attributeSets = new Map<string, Map<string, number>>();
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.set(m.name, m);
    if (Array.isArray(o.material)) return;
    const key = `${o.material.uuid}|${classify(o)}|${venueBatchSemantics(o)}`, sets = attributeSets.get(key) ?? new Map<string, number>();
    const set = Object.keys(o.geometry.attributes).sort().join(',');
    sets.set(set, (sets.get(set) ?? 0) + 1); attributeSets.set(key, sets);
  });
  /** Pick ground or not, as an existing batch of this material has it (flat parts prefer ground), and that batch's UV use. */
  const settle = (o: T.Mesh, flat: boolean) => {
    const key = () => `${(o.material as T.Material).uuid}|${classify(o)}|${venueBatchSemantics(o)}`;
    const options = flat ? ['ground', undefined] : [undefined, 'ground'];
    let sets: Map<string, number> | undefined;
    for (const role of options) {
      if (role) o.userData['venueRole'] = role; else delete o.userData['venueRole'];
      if ((sets = attributeSets.get(key()))) break;
    }
    if (!sets) { if (flat) o.userData['venueRole'] = 'ground'; else delete o.userData['venueRole']; }
    return !!sets && [...sets].sort((x, y) => y[1] - x[1])[0][0].split(',').includes('uv');
  };
  const result: BmElementsResult = { added: [], earlierTrianglesRemoved: 0, earlierMeshesHidden: 0 };
  for (const element of manifest.elements) {
    const group = elements.children.find(o => o.userData['bmElement'] === element.id);
    if (!group || !enabled[element.id]) continue;
    // Cut first, so the new parts are never cut themselves.
    const patterns = element.replaces.map(source => new RegExp(source));
    const earlier: T.Mesh[] = [];
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      for (let n: T.Object3D | null = o; n; n = n.parent)
        if (patterns.some(p => p.test(n!.name.replace(/_/g, ' ')))) { earlier.push(o); return; }
    });
    for (const mesh of earlier) {
      const removed = element.cut === 'all' ? hide(mesh) : cutInside(mesh, element.footprint);
      result.earlierTrianglesRemoved += removed;
      if (removed && !mesh.visible) result.earlierMeshesHidden++;
    }
    root.add(group);
    group.updateMatrixWorld(true);
    Object.assign(group.userData, element.tags);
    group.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      o.userData['bmElement'] = element.id;
      // "…with daylight slots" is a bronze panel, not a light: keep it out of the light/label batches.
      o.name = o.name.replace(/daylight/gi, 'day-lit');
      const source = o.material as T.MeshStandardMaterial, target = materials.get(source.userData['explorerMaterial']);
      // Drawn with the earlier model's material: same Natural/Color palette and finishes, same batches.
      if (target) { o.material = target; source.dispose(); }
      // Lawns, beds, flush edges and paving lie flat at grade: ground, like the earlier garden's lawns.
      const box = new T.Box3().setFromObject(o);
      conformGeometry(o, settle(o, box.max.y - box.min.y < .3 && box.max.y < .8));
      o.castShadow = o.receiveShadow = true;
    });
    result.added.push(element.id);
  }
  return result;
}

function hide(mesh: T.Mesh): number {
  if (!mesh.visible) return 0;
  mesh.visible = false; mesh.userData['supersededBySiteReference'] = true;
  return (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
}

/** Remove the triangles whose centre lies inside the footprint (world X/Z); a mesh left empty is hidden. */
function cutInside(mesh: T.Mesh, footprint: [number, number][]): number {
  const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  const count = index?.count ?? position.count, kept: number[] = [];
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let t = 0; t + 2 < count; t += 3) {
    const i = index ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)] : [t, t + 1, t + 2];
    a.fromBufferAttribute(position, i[0]).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, i[1]).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, i[2]).applyMatrix4(mesh.matrixWorld);
    if (!inside(footprint, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) kept.push(...i);
  }
  const removed = (count - kept.length) / 3;
  if (!removed) return 0;
  if (!kept.length) { mesh.visible = false; mesh.userData['supersededBySiteReference'] = true; return removed; }
  // glTF meshes can share one geometry between nodes: cut a copy.
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.setIndex(kept);
  return removed;
}

function inside(polygon: [number, number][], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j], [bx, bz] = polygon[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}

/**
 * The CAD data is quantized (Int16 positions in padded strides, Int8 normals) and has no UVs. Give it what the
 * earlier meshes of the same material have: float positions and normals, and a UV (box projection, metres) only when
 * those meshes carry one, so the surface textures tile and the meshes batch with them.
 */
function conformGeometry(mesh: T.Mesh, uvs: boolean) {
  const source = mesh.geometry, geometry = new T.BufferGeometry();
  const position = source.getAttribute('position'), normal = source.getAttribute('normal');
  const p = new Float32Array(position.count * 3), n = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    p.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    if (normal) n.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
  }
  geometry.setAttribute('position', new T.BufferAttribute(p, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(n, 3));
  if (!normal) geometry.computeVertexNormals();
  if (source.index) geometry.setIndex(source.index.clone());
  if (uvs) {
    mesh.updateMatrixWorld(true);
    const uv = new Float32Array(position.count * 2), w = new T.Vector3(), wn = new T.Vector3(), normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      w.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
      wn.set(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]).applyMatrix3(normalMatrix);
      const ax = Math.abs(wn.x), ay = Math.abs(wn.y), az = Math.abs(wn.z);
      uv.set(ay >= ax && ay >= az ? [w.x, w.z] : ax >= az ? [w.z, w.y] : [w.x, w.y], i * 2);
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  mesh.geometry = geometry;
  source.dispose();
}
