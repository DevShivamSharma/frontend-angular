import { test, expect } from '@playwright/test';
import * as T from 'three';
import { createVisitorCollisionWorld, VISITOR_RADIUS, VISITOR_HEIGHT } from '../src/app/home/visitor-collision';
import { createVisitorNavigation, campusWalkable, slideVisitor, visitorGroundHeight, visitorBodyClear, portalCoordinates } from '../src/app/home/visitor-navigation';
import { measureInteriorHalls } from '../src/app/home/venue-interiors';
import { measureCCLevels, buildCCInteriors } from '../src/app/home/cc-interiors';
import { planVisitorRoute } from '../src/app/home/visitor-routing';
import { visitorGeometry } from './visitor-fixture';
import { referenceVenueGeometry } from './venue-reference-fixture';
import { createVisitorAvatar } from '../src/app/home/visitor-avatar';

test('body collider encloses the animated character including feet and swinging arms', () => {
  const avatar = createVisitorAvatar(), point = new T.Vector3();
  let radius = 0, height = 0;
  for (let i = 0; i < 100; i++) {
    avatar.update(.02, 5.5, false); avatar.root.updateMatrixWorld(true);
    avatar.root.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      const attribute = o.geometry.getAttribute('position');
      for (let j = 0; j < attribute.count; j++) {
        point.fromBufferAttribute(attribute, j).applyMatrix4(o.matrixWorld);
        radius = Math.max(radius, Math.hypot(point.x, point.z)); height = Math.max(height, point.y);
      }
    });
  }
  expect(radius).toBeLessThan(VISITOR_RADIUS); expect(height).toBeLessThan(VISITOR_HEIGHT);
  avatar.dispose();
});

test('furnished CC entrance has a body-clear route through its actual partitions', () => {
  const previous = globalThis.document;
  const ctx = new Proxy({}, { get: (_, key) => key === 'measureText' ? (() => ({ width: 100 })) : (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) } as any;
  try {
    const root = referenceVenueGeometry();
    const kit = new Map(['stand-island', 'reception-counter', 'ceiling-light', 'steel-beam', 'stone-column', 'floor-deck', 'ceiling-deck', 'linear-light', 'hall-point-light']
      .map(name => [name, visitorGeometry(`src/assets/venue/interiors/${name}.glb`)]));
    const cc = buildCCInteriors(root, kit), layer = new T.Group();
    for (const level of cc.levels) layer.add(level.group);
    const halls = [...measureInteriorHalls(root), ...cc.levels.map(level => level.hall)];
    const obstacles = new Map(cc.levels.map(level => [level.hall.id, level.blocks]));
    const nav = createVisitorNavigation(root, halls, obstacles, layer);
    const destination = nav.portals.find(p => p.hall.level)!;
    for (let d = -5; d < destination.approach; d += .01) {
      const p = destination.position.clone().addScaledVector(destination.outward, d);
      p.y = visitorGroundHeight(nav, p, d < -2.2 ? destination.hall : undefined);
      expect(nav.geometry!.obstacleAt(p), `${destination.hall.id} doorway at ${d}`).toBeUndefined();
    }
    expect(planVisitorRoute(nav, obstacles, undefined, nav.spawn, destination)).not.toBeNull();
    cc.dispose();
  } finally { globalThis.document = previous; }
});

test('full body blocks thin, rotated and reverse-facing walls while sliding along them', () => {
  const root = new T.Group();
  const wall = new T.Mesh(new T.BoxGeometry(.02, 4, 16), new T.MeshBasicMaterial());
  wall.position.y = 2; root.add(wall);
  const world = createVisitorCollisionWorld(root, []), allowed = (p: T.Vector3) => !world.blocked(p);
  expect(allowed(new T.Vector3(-VISITOR_RADIUS / 2, 0, 0))).toBe(false);
  for (const side of [-1, 1]) {
    const p = new T.Vector3(side * 3, 0, -3);
    slideVisitor(p, -side * 30, 4, allowed);
    expect(p.x * side).toBeGreaterThan(VISITOR_RADIUS); expect(p.z).toBeCloseTo(1);
    const stopped = p.clone(); for (let i = 0; i < 30; i++) slideVisitor(p, -side, 0, allowed);
    expect(p.distanceTo(stopped)).toBeLessThan(.001);
  }
  wall.rotation.y = Math.PI / 4;
  const rotated = createVisitorCollisionWorld(root, []);
  const p = new T.Vector3(-5, 0, -3);
  slideVisitor(p, 8, 0, q => !rotated.blocked(q));
  expect(rotated.blocked(p)).toBe(false);
  expect(p.x - p.z).toBeLessThan(-VISITOR_RADIUS);
});

test('mesh collision keeps gaps between pillars, blocks furniture and respects body height', () => {
  const root = new T.Group(), interior = new T.Group(); interior.visible = false;
  const pillars = new T.InstancedMesh(new T.CylinderGeometry(.35, .35, 5, 12), new T.MeshBasicMaterial(), 2);
  pillars.setMatrixAt(0, new T.Matrix4().makeTranslation(-3, 2.5, 0));
  pillars.setMatrixAt(1, new T.Matrix4().makeTranslation(3, 2.5, 0)); interior.add(pillars);
  const canopy = new T.Mesh(new T.BoxGeometry(12, .2, 12), new T.MeshBasicMaterial());
  canopy.position.y = 4; root.add(canopy);
  const table = new T.Mesh(new T.BoxGeometry(2, .2, 2), new T.MeshBasicMaterial());
  table.position.set(0, .9, 4); root.add(table);
  const world = createVisitorCollisionWorld(root, [], interior);
  expect(world.blocked(new T.Vector3())).toBe(false);
  expect(world.blocked(new T.Vector3(2.4, 0, 0))).toBe(true);
  expect(world.blocked(new T.Vector3(0, 0, 4))).toBe(true);
  expect(world.blocked(new T.Vector3(0, 5, 4))).toBe(false);
});

test('actual campus collision covers gate piers, office walls and all hall routes', () => {
  test.setTimeout(120000);
  const root = referenceVenueGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const nav = createVisitorNavigation(root, halls, new Map());
  expect(campusWalkable(nav, nav.spawn), 'Gate 6 spawn must have body clearance').toBe(true);
  for (const pattern of [/PHOTO_GATE_6_left_sandstone_pier/, /PHOTO_ITPO_office_sandstone_structure/]) {
    let object: T.Object3D | undefined; root.traverse(o => { if (pattern.test(o.name)) object = o; });
    expect(object).toBeDefined();
    const box = new T.Box3().setFromObject(object!), p = box.getCenter(new T.Vector3());
    p.y = .35;
    // Probe the actual triangle surfaces, not a fabricated building rectangle.
    let blocked = false;
    for (let x = box.min.x; x <= box.max.x && !blocked; x += .4) for (let z = box.min.z; z <= box.max.z; z += .4) {
      p.x = x; p.z = z; if (pattern.test(nav.geometry!.obstacleAt(p) ?? '')) { blocked = true; break; }
    }
    expect(blocked, object!.name).toBe(true);
  }
  for (const destination of nav.portals) {
    for (let d = -5; d < destination.approach; d += .5) {
      const p = destination.position.clone().addScaledVector(destination.outward, d);
      p.y = visitorGroundHeight(nav, p, d < -2.2 ? destination.hall : undefined);
      const source = nav.geometry!.obstacleAt(p);
      expect(source, `${destination.hall.id} doorway at ${d}`).toBeUndefined();
    }
    // Exercise the manual mover's substeps in both directions against the same
    // prepared roof/frontage geometry as the shipping viewer, including CC slope.
    const allowed = (p: T.Vector3) => visitorBodyClear(nav, p,
      portalCoordinates(destination, p).along < -2.2 ? destination.hall : undefined);
    for (const [from, to] of [[destination.approach, -5], [-5, destination.approach]]) {
      const position = destination.position.clone().addScaledVector(destination.outward, from);
      const target = destination.position.clone().addScaledVector(destination.outward, to);
      expect(allowed(position), `${destination.hall.id} manual sweep start`).toBe(true);
      slideVisitor(position, target.x - position.x, target.z - position.z, allowed);
      expect(Math.hypot(position.x - target.x, position.z - target.z),
        `${destination.hall.id} manual ${from > to ? 'entry' : 'exit'} reaches its clear endpoint`).toBeLessThan(.01);
      expect(allowed(position), `${destination.hall.id} manual sweep end`).toBe(true);
    }
    const route = planVisitorRoute(nav, new Map(), undefined, nav.spawn, destination);
    expect(route, `Clear route to ${destination.hall.id}`).not.toBeNull();
  }
});
