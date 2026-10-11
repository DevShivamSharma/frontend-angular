import { expect, test } from '@playwright/test';
import * as T from 'three';
import { visitorGeometry } from './visitor-fixture';
import { applyReferenceFinish, prepareReferenceMaterials } from '../src/app/home/venue-reference-materials';

test('reference palette reaches the actual hall panels without altering signs, footprints or other halls', () => {
  const root = visitorGeometry();
  const originals: { mesh: T.Mesh; geometry: T.BufferGeometry; material: T.Material | T.Material[] }[] = [];
  root.traverse(o => { if (o instanceof T.Mesh) originals.push({ mesh: o, geometry: o.geometry, material: o.material }); });
  prepareReferenceMaterials(root);
  const coverage = root.userData['referenceMaterialCoverage'];
  for (const id of ['hall1', 'hall2', 'hall3', 'hall4', 'hall5', 'hall6', 'hall14']) expect(coverage[id]).toBeGreaterThan(0);
  let changed = 0, protectedCount = 0;
  for (const { mesh, geometry, material } of originals) {
    expect(mesh.geometry).toBe(geometry);
    if (/sign|label|HALL_8|HALL_9|HALL_10|HALL_11|HALL_12|PHOTO_CC/i.test(mesh.parent!.name)) {
      expect(mesh.material).toBe(material); protectedCount++;
    }
    if (mesh.material !== material) changed++;
  }
  expect(protectedCount).toBeGreaterThan(20); expect(changed).toBeGreaterThan(30);
  const panelColors = new Set<string>();
  root.traverse(o => { if (o instanceof T.Mesh) {
    const m = o.material as T.MeshStandardMaterial;
    if (m.name.startsWith('REFERENCE_PM_Cladding')) panelColors.add(m.color.getHexString());
  } });
  expect(panelColors.size).toBe(7);
  const once = originals.map(o => o.mesh.material);
  prepareReferenceMaterials(root);
  expect(originals.every((o, i) => o.mesh.material === once[i])).toBe(true);
});

test('reference finish survives material cloning and appearance restoration', () => {
  const material = new T.MeshStandardMaterial({ color: '#abcdef' });
  material.userData = { referenceMaterial: true, referenceFinish: { color: '#aa5549', roughness: .7, metalness: .08 } };
  const cloned = material.clone(); cloned.color.set('#ffffff');
  expect(applyReferenceFinish(cloned)).toBe(true);
  expect(cloned.color.getHexString()).toBe('aa5549'); expect(cloned.roughness).toBe(.7);
  const sign = new T.MeshStandardMaterial({ color: '#fedcba' });
  expect(applyReferenceFinish(sign)).toBe(false); expect(sign.color.getHexString()).toBe('fedcba');
});
