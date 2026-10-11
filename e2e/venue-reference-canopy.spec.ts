import { expect, test } from '@playwright/test';
import * as T from 'three';
import { visitorGeometry } from './visitor-fixture';
import { prepareReferenceCanopies } from '../src/app/home/venue-reference-canopy';
import { batchVenue } from '../src/app/home/venue-batching';

function meshes(root: T.Object3D): T.Mesh[] {
  const result: T.Mesh[] = [];
  root.traverse(object => { if (object instanceof T.Mesh) result.push(object); });
  return result;
}

test('reference canopy replaces actual opaque roofs with open infill while preserving every ground support', () => {
  const root = visitorGeometry();
  const originals = meshes(root).map(mesh => ({ mesh, geometry: mesh.geometry,
    material: mesh.material, matrix: mesh.matrixWorld.clone() }));
  const supports = originals.filter(({ mesh }) => /PHOTO_(CENTRAL_SPINE|GARDEN_TO_FOUNTAIN|HALLS).*columns_trusses/.test(mesh.parent!.name));
  const roofs = originals.filter(({ mesh }) => /^(PHOTO_GARDEN_TO_FOUNTAIN_cross_canopy|PHOTO_HALLS_corrected_covered_approach)_roof_panels$/.test(mesh.parent!.name));
  expect(supports).toHaveLength(3); expect(roofs).toHaveLength(4);

  prepareReferenceCanopies(root);
  const coverage = root.userData['referenceCanopyCoverage'];
  expect(coverage.infillQuads).toBe(484);
  expect(coverage.sourceFamilies.sort()).toEqual(['CENTRAL_SPINE', 'GARDEN_TO_FOUNTAIN', 'HALLS']);
  expect(coverage.newGroundSupports).toBe(0);
  expect(coverage.frameMembers).toBeGreaterThan(100);
  expect(coverage.frameMembers).toBeLessThan(2_600);
  const roofSet = new Set(roofs.map(item => item.mesh));
  const supportSet = new Set(supports.map(item => item.mesh));
  for (const original of originals) {
    if (roofSet.has(original.mesh)) { expect(original.mesh.parent).toBeNull(); continue; }
    // No changes to columns, trusses, walls, ground, stairs or unrelated roofs.
    expect(original.mesh.geometry).toBe(original.geometry);
    expect(original.mesh.matrixWorld.equals(original.matrix)).toBe(true);
    if (!supportSet.has(original.mesh)) expect(original.mesh.material).toBe(original.material);
  }
  const added = meshes(root).filter(mesh => mesh.name.startsWith('REFERENCE_canopy_'));
  expect(added).toHaveLength(2);
  let triangles = 0;
  for (const mesh of added) {
    const positions = mesh.geometry.getAttribute('position');
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    mesh.geometry.computeBoundingBox();
    // New detail cannot block the existing character/camera walking corridor.
    expect(mesh.geometry.boundingBox!.min.y).toBeGreaterThan(6.5);
    const indices = Array.from(mesh.geometry.index!.array);
    expect(indices.every(index => index >= 0 && index < positions.count)).toBe(true);
    expect(mesh.geometry.getAttribute('normal').count).toBe(positions.count);
    triangles += indices.length / 3;
  }
  expect(triangles).toBeLessThan(32_000);
  const screen = added.find(mesh => mesh.name === 'REFERENCE_canopy_perforated_infill')!;
  const material = screen.material as T.MeshStandardMaterial;
  expect(material.alphaTest).toBeGreaterThan(0);
  expect(material.transparent).toBe(false);
  const texture = material.alphaMap as T.DataTexture;
  expect(texture.image.width).toBe(256); expect(texture.image.height).toBe(256);
  const data = texture.image.data as Uint8Array;
  let holes = 0;
  for (let i = 1; i < data.length; i += 4) if (data[i] === 0) holes++;
  expect(holes / (256 * 256)).toBeGreaterThan(.3);
  expect(holes / (256 * 256)).toBeLessThan(.8);
  expect(material.clone().alphaMap).toBe(texture);
  expect(material.userData['referenceMaterial']).toBe(true);

  const before = meshes(root).map(mesh => mesh.uuid);
  prepareReferenceCanopies(root);
  expect(meshes(root).map(mesh => mesh.uuid)).toEqual(before);
  // Static batching keeps the alpha-tested infill and physical frame buffers valid.
  batchVenue(root, () => null, () => 'canopy-test');
  const visibleScreen = meshes(root).find(mesh => mesh.material === material)!;
  expect(visibleScreen).toBeTruthy();
  expect(visibleScreen.geometry.getAttribute('uv').count).toBe(visibleScreen.geometry.getAttribute('position').count);
});

test('removed source resources are disposed only after their last scene user releases them', () => {
  const root = visitorGeometry();
  const all = meshes(root);
  const roof = all.find(mesh => mesh.parent!.name === 'PHOTO_GARDEN_TO_FOUNTAIN_cross_canopy_roof_panels')!;
  const alias = new T.Mesh(roof.geometry, roof.material); alias.name = 'unrelated shared roof'; root.add(alias);
  let geometryDisposals = 0, materialDisposals = 0;
  roof.geometry.addEventListener('dispose', () => geometryDisposals++);
  (roof.material as T.Material).addEventListener('dispose', () => materialDisposals++);
  const unused = all.filter(mesh => mesh.parent!.name === 'PHOTO_GARDEN_TO_FOUNTAIN_cross_canopy_roof_panels')[1];
  let unusedGeometryDisposals = 0;
  unused.geometry.addEventListener('dispose', () => unusedGeometryDisposals++);
  prepareReferenceCanopies(root);
  expect(alias.parent).toBe(root);
  expect(alias.geometry).toBe(roof.geometry); expect(alias.material).toBe(roof.material);
  expect(geometryDisposals).toBe(0); expect(materialDisposals).toBe(0);
  expect(unusedGeometryDisposals).toBe(1);
  prepareReferenceCanopies(root);
  expect(unusedGeometryDisposals).toBe(1);
});
