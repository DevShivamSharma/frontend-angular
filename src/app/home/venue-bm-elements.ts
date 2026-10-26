import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Elements copied from the Bharat Mandapam CAD model (scripts/extract-bm-elements.mjs) and fitted onto the
 * earlier model, in the CAD model's own colours. An element that is on replaces the matching earlier parts: all of
 * them or inside its own footprint (manifest `cut`), plus `inside` parts within the footprint.
 * Turning one off brings the earlier part back exactly as before.
 */
export const VENUE_BM_ELEMENTS: Readonly<Record<string, boolean>> = {
  tunnel: true,
  forecourt: true,
  plaza: true,
  hall14: true,
  amphitheatre1: true,
  amphitheatre2: true,
};

export interface BmElementManifest {
  elements: { id: string; label: string; replaces: string[]; cut: 'footprint' | 'all'; inside?: string[]; roles?: Record<string, string>;
    footprint: [number, number][]; tags: Record<string, string> }[];
}
export interface BmElementsResult { added: string[]; earlierTrianglesRemoved: number; earlierMeshesHidden: number }

/** Load venue-bm-elements.glb/json and apply them. Failure leaves the earlier model untouched. */
export async function prepareBmElements(root: T.Group, asset: (path: string) => string, signal: AbortSignal): Promise<BmElementsResult> {
  const [glbResponse, jsonResponse] = await Promise.all([fetch(asset('venue-bm-elements.glb'), { signal }), fetch(asset('venue-bm-elements.json'), { signal })]);
  if (!glbResponse.ok || !jsonResponse.ok) throw new Error('Bharat Mandapam elements unavailable');
  const [bytes, manifest] = await Promise.all([glbResponse.arrayBuffer(), jsonResponse.json() as Promise<BmElementManifest>]);
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
  signal.throwIfAborted();
  return applyBmElements(root, gltf.scene, manifest);
}

/** Attach the enabled elements and cut the earlier parts they replace. Runs before batching and navigation. */
export function applyBmElements(root: T.Group, elements: T.Object3D, manifest: BmElementManifest,
    enabled: Readonly<Record<string, boolean>> = VENUE_BM_ELEMENTS): BmElementsResult {
  root.updateMatrixWorld(true);
  // The CAD colours stay as they are in the Bharat Mandapam model: they become vertex colours on three shared
  // finishes, so the elements look as there and add only a few draw calls.
  const finishes: Record<string, T.MeshStandardMaterial> = {
    matte: new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .02 }),
    metal: new T.MeshStandardMaterial({ vertexColors: true, roughness: .45, metalness: .55 }),
    glass: new T.MeshStandardMaterial({ vertexColors: true, roughness: .15, metalness: .35, envMapIntensity: 1.2 }),
  };
  for (const [name, material] of Object.entries(finishes)) material.name = `BM CAD ${name}`;
  const result: BmElementsResult = { added: [], earlierTrianglesRemoved: 0, earlierMeshesHidden: 0 };
  const matching = (sources: string[]) => {
    const patterns = sources.map(source => new RegExp(source)), found: T.Mesh[] = [];
    if (!patterns.length) return found;
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      for (let n: T.Object3D | null = o; n; n = n.parent)
        if (patterns.some(p => p.test(n!.name.replace(/_/g, ' ')))) { found.push(o); return; }
    });
    return found;
  };
  for (const element of manifest.elements) {
    const group = elements.children.find(o => o.userData['bmElement'] === element.id);
    if (!group || !enabled[element.id]) continue;
    // Cut first, so the new parts are never cut themselves.
    const count = (removed: number, mesh: T.Mesh) => { result.earlierTrianglesRemoved += removed; if (removed && !mesh.visible) result.earlierMeshesHidden++; };
    for (const mesh of matching(element.replaces)) count(element.cut === 'all' ? hide(mesh) : cutInside(mesh, element.footprint), mesh);
    for (const mesh of matching(element.inside ?? [])) count(cutInside(mesh, element.footprint), mesh);
    root.add(group);
    group.updateMatrixWorld(true);
    Object.assign(group.userData, element.tags);
    const roles = Object.entries(element.roles ?? {}).map(([source, role]) => [new RegExp(source), role] as const);
    group.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      o.userData['bmElement'] = element.id;
      // "…with daylight slots" is a bronze panel, not a light: keep it out of the light/label batches.
      o.name = o.name.replace(/daylight/gi, 'day-lit');
      const source = o.material as T.MeshStandardMaterial;
      o.material = finishes[source.userData['bmFinish'] as string] ?? finishes['matte'];
      conformGeometry(o, source.color);
      source.dispose();
      // Lawns, beds, flush edges, paving and the plaza slabs lie flat at grade: ground (no shadow, no collision).
      const box = new T.Box3().setFromObject(o), name = o.name.replace(/_/g, ' ');
      if (box.max.y - box.min.y < .3 && box.max.y < .8) o.userData['venueRole'] = 'ground';
      for (const [pattern, role] of roles) if (pattern.test(name)) { o.userData['venueRole'] = role; o.userData['hall'] = element.tags['hall']; }
      o.castShadow = o.userData['venueRole'] !== 'ground'; o.receiveShadow = true;
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

/** The CAD data is quantized (Int16 positions in padded strides, Int8 normals): float positions and normals, plus the
 * material's colour on every vertex. */
function conformGeometry(mesh: T.Mesh, color: T.Color) {
  const source = mesh.geometry, geometry = new T.BufferGeometry();
  const position = source.getAttribute('position'), normal = source.getAttribute('normal');
  const p = new Float32Array(position.count * 3), n = new Float32Array(position.count * 3), c = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    p.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    if (normal) n.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
    c.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('position', new T.BufferAttribute(p, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(n, 3));
  geometry.setAttribute('color', new T.BufferAttribute(c, 3));
  if (!normal) geometry.computeVertexNormals();
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  mesh.geometry = geometry;
  source.dispose();
}
