import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { prepareVenueArchitecturalDetail } from '../src/app/home/venue-architectural-detail';

/** Read real source buffers without requiring image decoding or a GPU. */
function sourceModel() {
  const bytes = readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
  const length = bytes.readUInt32LE(12), data = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = 28 + length;
  const materials = data.materials.map((definition: any) => {
    const material = new T.MeshStandardMaterial();
    material.name = definition.name; material.userData = definition.extras ?? {};
    return material;
  });
  function attribute(index: number) {
    const accessor = data.accessors[index], view = data.bufferViews[accessor.bufferView];
    const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[accessor.type];
    const component = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[accessor.componentType];
    const out: number[] = [];
    for (let i = 0; i < accessor.count; i++) for (let j = 0; j < size; j++) {
      const offset = binary + (view.byteOffset || 0) + (accessor.byteOffset || 0) + i * (view.byteStride || size * component) + j * component;
      out.push(accessor.componentType === 5126 ? bytes.readFloatLE(offset) : bytes.readUIntLE(offset, component));
    }
    return { out, size };
  }
  function node(index: number): T.Object3D {
    const definition = data.nodes[index], group = new T.Group();
    group.name = definition.name; group.userData = definition.extras ?? {};
    if (definition.matrix) { group.matrix.fromArray(definition.matrix); group.matrix.decompose(group.position, group.quaternion, group.scale); }
    else {
      if (definition.translation) group.position.fromArray(definition.translation);
      if (definition.rotation) group.quaternion.fromArray(definition.rotation);
      if (definition.scale) group.scale.fromArray(definition.scale);
    }
    if (definition.mesh !== undefined) for (const p of data.meshes[definition.mesh].primitives) {
      const geometry = new T.BufferGeometry();
      for (const [name, key] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0']]) {
        if (p.attributes[key] === undefined) continue;
        const values = attribute(p.attributes[key]); geometry.setAttribute(name, new T.Float32BufferAttribute(values.out, values.size));
      }
      if (p.indices !== undefined) geometry.setIndex(attribute(p.indices).out);
      group.add(new T.Mesh(geometry, materials[p.material]));
    }
    for (const child of definition.children ?? []) group.add(node(child));
    return group;
  }
  const root = new T.Group();
  for (const index of data.scenes[data.scene ?? 0].nodes) root.add(node(index));
  return root;
}

test('campus detail covers every hall, CC and office without changing source geometry, plans or signs', () => {
  test.setTimeout(90_000);
  const root = sourceModel();
  const originals: { mesh: T.Mesh; positions: ArrayLike<number>; index: ArrayLike<number>; uv?: ArrayLike<number>; material: T.Material }[] = [];
  root.traverse(object => {
    if (object instanceof T.Mesh) originals.push({ mesh: object, positions: object.geometry.attributes['position'].array,
      index: object.geometry.index!.array, uv: object.geometry.attributes['uv']?.array, material: object.material as T.Material });
  });
  prepareVenueArchitecturalDetail(root);
  const coverage = root.userData['architecturalDetailCoverage'];
  for (const id of ['hall1', 'hall2', 'hall3', 'hall4', 'hall5', 'hall6', 'hall8', 'hall9', 'hall10', 'hall11', 'hall12', 'hall12A', 'hall14', 'cc', 'office'])
    expect(coverage[id], `${id} receives material detailing`).toBeGreaterThan(0);
  let protectedMeshes = 0;
  for (const { mesh, positions, index, uv, material } of originals) {
    expect(Buffer.from(mesh.geometry.attributes['position'].array.buffer).equals(Buffer.from((positions as Float32Array).buffer))).toBe(true);
    expect(Buffer.from(mesh.geometry.index!.array.buffer).equals(Buffer.from((index as Uint32Array).buffer))).toBe(true);
    if (uv) expect(Buffer.from(mesh.geometry.attributes['uv'].array.buffer).equals(Buffer.from((uv as Float32Array).buffer))).toBe(true);
    if (/sign|label|floor[ _]plan/i.test(mesh.parent!.name)) {
      protectedMeshes++;
      expect(mesh.material).toBe(material); expect(mesh.geometry.getAttribute('uv1')).toBeUndefined();
    }
    const details = mesh.geometry.getAttribute('uv1');
    if (details) expect(Array.from(details.array).every(Number.isFinite)).toBe(true);
  }
  expect(protectedMeshes).toBeGreaterThan(20);
  const entrance = root.getObjectByName('HALL_14 entrance detail')!;
  expect(entrance.userData['destinationId']).toBe('hall14');
  expect(entrance.position.x).toBeCloseTo(-223.601074);
  const count = root.children.length;
  prepareVenueArchitecturalDetail(root);
  expect(root.children).toHaveLength(count);
});

test('a roof shared with a sign gets its own material, while original UV0 stays intact', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial();
  material.userData['architecturalCategory'] = 'roof';
  const geometry = new T.BoxGeometry(10, 1, 10);
  const hall = new T.Mesh(geometry, material); hall.name = 'PHOTO_HALL_2 roof';
  const label = new T.Mesh(geometry, material); label.name = 'ROOF_LABEL_H2';
  root.add(hall, label);
  prepareVenueArchitecturalDetail(root);
  expect(label.material).toBe(material); expect(label.geometry).toBe(geometry);
  expect(hall.material).not.toBe(material); expect(hall.geometry).not.toBe(geometry);
  expect(hall.geometry.getAttribute('uv1').count).toBe(geometry.getAttribute('position').count);
  expect(Array.from(hall.geometry.getAttribute('uv').array)).toEqual(Array.from(geometry.getAttribute('uv').array));
});
