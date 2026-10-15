import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { prepareReferenceConcourse } from '../src/app/home/venue-reference-concourse';
import { createVisitorCollisionWorld } from '../src/app/home/visitor-collision';
import { visitorGeometry } from './visitor-fixture';

function sourceModel() {
  const root = visitorGeometry(), bytes = readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const materials = json.materials.map((definition: any) => {
    const material = new T.MeshStandardMaterial(); material.name = definition.name;
    material.userData = definition.extras ?? {}; return material;
  });
  for (const node of json.nodes) {
    const object = root.getObjectByName((node.name ?? '').replace(/ /g, '_'));
    if (!object || node.mesh === undefined) continue;
    json.meshes[node.mesh].primitives.forEach((primitive: any, index: number) => {
      const mesh = object.children[index] as T.Mesh; mesh.material = materials[primitive.material];
      mesh.geometry.computeVertexNormals();
    });
  }
  return root;
}

function buffers(root: T.Group) {
  const originals: { mesh: T.Mesh; positions: Uint8Array; index?: Uint8Array; material: T.Material | T.Material[] }[] = [];
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const position = object.geometry.getAttribute('position').array;
    const index = object.geometry.index?.array;
    originals.push({ mesh: object, positions: new Uint8Array(position.buffer).slice(),
      index: index && new Uint8Array(index.buffer).slice(), material: object.material });
  });
  return originals;
}

test('reference concourse finishes preserve the real source topology, boundary and material ownership', () => {
  test.setTimeout(90_000);
  const root = sourceModel(), originals = buffers(root), count = originals.length;
  prepareReferenceConcourse(root);
  expect(root.userData['referenceConcourse'].coverage).toEqual({ paving: 6, sandstone: 4 });
  expect(buffers(root)).toHaveLength(count);
  const textures = new Set<T.Texture>();
  let protectedCount = 0;
  for (const before of originals) {
    const mesh = before.mesh, geometry = mesh.geometry;
    expect(Buffer.from(geometry.getAttribute('position').array.buffer).equals(Buffer.from(before.positions))).toBe(true);
    if (before.index) expect(Buffer.from(geometry.index!.array.buffer).equals(Buffer.from(before.index))).toBe(true);
    if (mesh.userData['referenceConcourse']) {
      expect(Array.from(geometry.getAttribute('uv1').array).every(Number.isFinite)).toBe(true);
      const material = mesh.material as T.MeshStandardMaterial;
      expect(material.userData['referenceMaterial']).toBe(true);
      expect(material.map?.channel).toBe(1); textures.add(material.map!);
    } else {
      protectedCount++; expect(mesh.material).toBe(before.material);
    }
  }
  expect(protectedCount).toBeGreaterThan(100);
  expect(textures.size).toBe(2);
  for (const texture of textures) {
    expect(texture.image.width).toBe(512); expect(texture.image.height).toBe(512);
    expect(texture.minFilter).toBe(T.LinearMipmapLinearFilter);
    expect(texture.generateMipmaps).toBe(true);
  }
  const after = originals.map(({ mesh }) => [mesh.geometry, mesh.material]);
  prepareReferenceConcourse(root);
  originals.forEach(({ mesh }, i) => {
    expect(mesh.geometry).toBe(after[i][0]); expect(mesh.material).toBe(after[i][1]);
  });
});

test('finishes keep walk clearance, solid pavilion walls and shared source UVs unchanged', () => {
  const root = new T.Group(), shared = new T.MeshStandardMaterial();
  shared.name = 'GATE_PATH pedestrian paving'; shared.userData['architecturalCategory'] = 'stone';
  const geometry = new T.BoxGeometry(12, .15, 24);
  const path = new T.Mesh(geometry, shared); path.name = 'PHOTO_PATH Central covered promenade paving';
  path.position.y = -.075;
  const unrelated = new T.Mesh(geometry, shared); unrelated.name = 'Unrelated reference floor'; unrelated.position.x = 30;
  const wallMaterial = new T.MeshStandardMaterial(); wallMaterial.name = 'PM_Precinct red sandstone';
  const wall = new T.Mesh(new T.BoxGeometry(.4, 4, 10), wallMaterial);
  wall.name = 'PHOTO_CENTRAL_GARDEN sandstone display portals'; wall.position.set(5, 2, 0);
  root.add(path, unrelated, wall);
  const originalUV = Array.from(geometry.getAttribute('uv').array);
  const before = createVisitorCollisionWorld(root, []);
  const probes = Array.from({ length: 25 }, (_, i) => new T.Vector3(-3 + i * .35, 0, 0));
  const clearance = probes.map(p => before.blocked(p));
  expect(clearance.some(Boolean)).toBe(true); expect(clearance.some(v => !v)).toBe(true);
  prepareReferenceConcourse(root);
  const after = createVisitorCollisionWorld(root, []);
  expect(probes.map(p => after.blocked(p))).toEqual(clearance);
  expect(after.faceCount).toBe(before.faceCount);
  expect(path.geometry).not.toBe(geometry); expect(unrelated.geometry).toBe(geometry);
  expect(unrelated.material).toBe(shared);
  expect(Array.from(path.geometry.getAttribute('uv').array)).toEqual(originalUV);
  expect(Array.from(unrelated.geometry.getAttribute('uv').array)).toEqual(originalUV);
  expect(root.children).toHaveLength(3);
});
