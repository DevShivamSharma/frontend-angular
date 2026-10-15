import { expect, test } from '@playwright/test';
import * as T from 'three';
import { referenceVenueGeometry } from './venue-reference-fixture';
import { prepareGroundPhotoDetails, preparePhotoEntrances } from '../src/app/home/venue-ground-photos';
import { createVisitorNavigation, campusWalkable } from '../src/app/home/visitor-navigation';
import { measureInteriorHalls } from '../src/app/home/venue-interiors';
import { capturePedestrianPaths, planPedestrianRoutes, samplePedestrianRoute } from '../src/app/home/venue-pedestrians';

test('photo details fit authored paths and supports; pedestrian loops avoid the resulting geometry', () => {
  const root = referenceVenueGeometry();
  prepareGroundPhotoDetails(root, new T.Texture());
  const roof = root.getObjectByName('REFERENCE_canopy_perforated_infill') as T.Mesh;
  const floor = root.getObjectByName('PHOTO_covered_walk_continuous_paving') as T.Mesh;
  const roofPoints = roof.geometry.getAttribute('position'), floorPoints = floor.geometry.getAttribute('position');
  expect(floorPoints.count).toBeGreaterThan(roofPoints.count);
  expect(root.userData['coveredFloorCoverage'].roofQuads).toBe(484);
  expect(root.userData['coveredFloorCoverage'].fountainTriangles).toBeGreaterThan(0);
  expect(Array.from({length:roofPoints.count}, (_,i) =>
    Math.abs(floorPoints.getX(i)-roofPoints.getX(i)) < .0001 &&
    Math.abs(floorPoints.getZ(i)-roofPoints.getZ(i)) < .0001).every(Boolean)).toBe(true);
  expect(Array.from({length:floorPoints.count}, (_,i) => Math.abs(floorPoints.getY(i)-.186) < .0001).every(Boolean)).toBe(true);
  const border = root.getObjectByName('PHOTO_concourse_tactile_border') as T.Mesh;
  border.geometry.computeBoundingBox();
  expect(border.geometry.boundingBox!.min.y).toBeGreaterThan(.186);
  const coverage = root.userData['groundPhotoDetails'];
  expect(coverage.strips).toBeGreaterThan(100);
  expect(coverage.columnSleeves).toBeGreaterThan(10);
  expect(coverage.columnSleeves).toBeLessThan(200);
  expect(coverage.banners).toBeGreaterThan(5);
  const nav = createVisitorNavigation(root, measureInteriorHalls(root), new Map());
  preparePhotoEntrances(root, nav.portals);
  expect(root.userData['photoEntrances'].count).toBe(3);
  const onPath = capturePedestrianPaths(root), routes = planPedestrianRoutes(nav, onPath);
  expect(routes.length).toBeGreaterThan(8);
  const point = new T.Vector3(), tangent = new T.Vector3();
  let blockedSamples = 0, maxTangentError = 0;
  for (const route of routes) {
    const perimeter = 2 * route.length + 2 * Math.PI * route.radius;
    for (let d = 0; d < perimeter; d += .2) {
      samplePedestrianRoute(route, d, point, tangent);
      if (!onPath(point) || !campusWalkable(nav, point)) blockedSamples++;
      maxTangentError = Math.max(maxTangentError, Math.abs(tangent.length() - 1));
    }
    for (const seam of [0, route.length, route.length + Math.PI * route.radius, 2 * route.length + Math.PI * route.radius, perimeter]) {
      const before = new T.Vector3(), direction = new T.Vector3();
      samplePedestrianRoute(route, seam - .001, before, direction);
      samplePedestrianRoute(route, seam + .001, point, tangent);
      expect(point.distanceTo(before)).toBeCloseTo(.002, 5);
      expect(direction.dot(tangent)).toBeGreaterThan(.999);
    }
  }
  expect(blockedSamples).toBe(0);
  expect(maxTangentError).toBeLessThan(.000001);
  const count = root.getObjectByName('PHOTO_ground_concourse_details')!.children.length;
  prepareGroundPhotoDetails(root);
  expect(root.getObjectByName('PHOTO_ground_concourse_details')!.children).toHaveLength(count);
  let triangles = 0;
  root.getObjectByName('PHOTO_ground_concourse_details')!.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    triangles += o.geometry.index!.count / 3;
    expect(Array.from(o.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
  });
  expect(triangles).toBeLessThan(15000);
});
