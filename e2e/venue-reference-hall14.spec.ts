import { expect, test } from '@playwright/test';
import * as T from 'three';
import { prepareReferenceHall14 } from '../src/app/home/venue-reference-hall14';
import { visitorGeometry } from './visitor-fixture';
import { measureInteriorHalls, hallToWorld } from '../src/app/home/venue-interiors';
import { createVisitorNavigation, visitorBodyClear } from '../src/app/home/visitor-navigation';

test('Hall14 observed front has a cream crown, recessed balconies and a clear real-model entrance', () => {
  test.setTimeout(90_000);
  const root = visitorGeometry();
  const roof = root.getObjectByName('PHOTO_HALL_14_standing_seam_roof')!;
  const roofBounds = new T.Box3().setFromObject(roof);
  const hall1 = root.getObjectByName('PHOTO_HALL_1_detailed_envelope')!;
  const hall1Bounds = new T.Box3().setFromObject(hall1);
  prepareReferenceHall14(root);
  const observed = root.getObjectByName('REFERENCE_HALL_14 observed frontage')!;
  expect(observed.userData['referenceSeconds']).toEqual([8, 16, 31]);
  expect(new T.Box3().setFromObject(roof).equals(roofBounds)).toBe(true);
  expect(new T.Box3().setFromObject(hall1).equals(hall1Bounds)).toBe(true);
  expect(root.getObjectByName('ROOF_LABEL_H14')).toBeUndefined();
  const cream = observed.getObjectByName('REFERENCE_H14 REFERENCE_H14_cream fascia') as T.Mesh;
  expect((cream.material as T.MeshStandardMaterial).userData['referenceFinish'].color).toBe('#d8d0b7');
  const localPoint = (x: number, y: number, z: number) => observed.localToWorld(new T.Vector3(x, y, z));
  const facing = new T.Vector3(0, 0, -1).transformDirection(observed.matrixWorld);
  const ray = new T.Raycaster(localPoint(0, 21, 70), facing);
  const upper = ray.intersectObjects(root.children, true)[0];
  expect(upper.object).toBe(cream);
  ray.set(localPoint(0, 10, 70), facing);
  const middle = ray.intersectObjects(observed.children, true)[0];
  expect(middle.object.name).toBe('Hall14 recessed entrance glazing');
  expect(middle.distance).toBeGreaterThan(upper.distance + 3);
  // The retained source and replacement must meet on an ellipse, not a circle.
  const retainedEnvelope = root.getObjectByName('PHOTO_HALL_14_detailed_envelope')!;
  expect(retainedEnvelope).toBeTruthy();
  for (const degrees of [-82.4, -81.6, 81.6, 82.4]) {
    const a = degrees * Math.PI / 180;
    const start = localPoint(65 * Math.sin(a), 21, 70 * Math.cos(a));
    const direction = localPoint(0, 21, 0).sub(start).normalize();
    ray.set(start, direction);
    const hits = ray.intersectObjects([retainedEnvelope, observed], true);
    expect(hits.some(hit => hit.distance < 30), `Closed frontage seam at ${degrees} degrees`).toBe(true);
  }
  const halls = measureInteriorHalls(root), hall = halls.find(h => h.id === 'hall14')!;
  expect(hall).toBeTruthy();
  const entrance = hallToWorld(hall, hall.entrance[0], 0, hall.entrance[1]);
  expect(observed.worldToLocal(entrance.clone()).z).toBeGreaterThan(35);
  const nav = createVisitorNavigation(root, halls, new Map());
  const portal = nav.portals.find(p => p.hall.id === 'hall14')!;
  for (let d = -7; d <= 10; d += .2) {
    const p = portal.position.clone().addScaledVector(portal.outward, d);
    expect(visitorBodyClear(nav, p, d < 0 ? hall : undefined), `Hall14 doorway at ${d}`).toBe(true);
  }
  const count = root.children.length;
  prepareReferenceHall14(root);
  expect(root.children.length).toBe(count);
});
