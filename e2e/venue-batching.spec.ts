import { expect, test } from '@playwright/test';
import * as T from 'three';
import { batchVenue } from '../src/app/home/venue-batching';

test('venue batching preserves transformed geometry, UVs and destination boundaries', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial();
  const geometry = new T.BoxGeometry(2,3,4);
  for (let i=0;i<4;i++) {
    const mesh = new T.Mesh(geometry,material);
    mesh.position.set(i*10,2,3); mesh.rotation.y=i*.2;
    mesh.userData['destinationId'] = i<2 ? 'hall1' : 'gate6'; root.add(mesh);
  }
  root.updateMatrixWorld(true);
  const expected = new T.Box3().setFromObject(root);
  const classify = (o:T.Object3D) => o.userData['destinationId'];
  batchVenue(root,classify,()=> 'same');
  expect(root.children).toHaveLength(2);
  const actual = new T.Box3().setFromObject(root);
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(.00001);
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(.00001);
  expect(root.children.map(classify).sort()).toEqual(['gate6','hall1']);
  const meshes = root.children as T.Mesh[];
  expect(meshes.reduce((sum,m)=>sum+m.geometry.index!.count,0)).toBe(geometry.index!.count*4);
  expect(meshes.reduce((sum,m)=>sum+m.geometry.getAttribute('uv').count,0)).toBe(geometry.getAttribute('uv').count*4);
});

test('venue batching retains transparent sort order and floor visibility hierarchy', () => {
  const root = new T.Group(), geometry = new T.BoxGeometry();
  const glass = new T.MeshStandardMaterial({transparent:true,opacity:.5});
  const floor = new T.Group(); floor.userData['cc_level']=1; floor.visible=false; root.add(floor);
  for(let i=0;i<2;i++) {root.add(new T.Mesh(geometry,glass));floor.add(new T.Mesh(geometry,new T.MeshStandardMaterial()));}
  const original = [...root.children];
  batchVenue(root,()=>null,()=> 'same');
  expect(root.children).toEqual(original);
  expect(floor.children).toHaveLength(2); expect(floor.visible).toBe(false);
});

test('batching preserves every road furniture instance and shared buffers', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial();
  const geometry = new T.BoxGeometry(), dispose = { count: 0 };
  geometry.addEventListener('dispose', () => dispose.count++);
  const instances = new T.InstancedMesh(geometry, material, 3);
  for (let i = 0; i < instances.count; i++)
    instances.setMatrixAt(i, new T.Matrix4().makeTranslation(i * 12, 1, 8));
  root.add(instances, new T.Mesh(geometry, material), new T.Mesh(geometry, material));
  const matrices = instances.instanceMatrix.array.slice();
  batchVenue(root, () => null, () => 'same');
  expect(instances.parent).toBe(root);
  expect(instances.count).toBe(3);
  expect(instances.instanceMatrix.array).toEqual(matrices);
  expect(root.children).toHaveLength(2);
  expect(dispose.count).toBe(0);
});
