import { test, expect } from '@playwright/test';
import * as T from 'three';
import fs from 'node:fs';
import { setMaxListeners } from 'node:events';
import { measureInteriorHalls, hallToWorld, worldToHall, walkable } from '../src/app/home/venue-interiors';
import { measureCCLevels } from '../src/app/home/cc-interiors';
import { createVisitorNavigation, campusWalkable, inFootprint, slideVisitor, portalCoordinates } from '../src/app/home/visitor-navigation';
import { createVisitorAvatar } from '../src/app/home/visitor-avatar';
import { createVenueVisitor, VisitorState } from '../src/app/home/venue-visitor';
import { visitorGeometry, campusRoute } from './visitor-fixture';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('the shipped campus has reachable visitor portals, bounded paths and solid buildings', () => {
  const root = visitorGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const nav = createVisitorNavigation(root, halls, new Map());
  expect(nav.portals.map(p => p.hall.id)).toEqual(['hall1', 'hall2', 'hall3', 'hall4', 'hall5', 'hall14', 'cc-level1']);
  expect(campusWalkable(nav, nav.spawn)).toBe(true);
  expect(campusWalkable(nav, new T.Vector3(10000, 0, 10000))).toBe(false);
  const report = [];
  for (const portal of nav.portals) {
    const exterior = portal.position.clone().addScaledVector(portal.outward, portal.approach - 1);
    expect(campusWalkable(nav, exterior), portal.hall.id + ' approach').toBe(true);
    for (let d = -3; d < portal.approach; d += .2) {
      const p = portal.position.clone().addScaledVector(portal.outward, d);
      if (d > -2.2) expect(campusWalkable(nav, p), `${portal.hall.id} doorway ${d}`).toBe(true);
      else {
        const local = worldToHall(portal.hall, p);
        expect(walkable(portal.hall, [], local.x, local.z), portal.hall.id + ' inside').toBe(true);
      }
    }
    const wall = portal.hall.center.clone();
    expect(campusWalkable(nav, wall), portal.hall.id + ' wall').toBe(false);
    report.push({ id: portal.hall.id, position: portal.position.toArray(), outward: portal.outward.toArray(), approach: exterior.toArray() });
  }
  // Flood fill the navigable exterior from the photographed gate. Each approach must
  // connect to the same campus, not just be a locally valid isolated point.
  const step = 5, queue = [nav.spawn.clone()], seen = new Set(['0,0']);
  const reached = new Set<string>();
  for (let cursor = 0; cursor < queue.length && reached.size < nav.portals.length; cursor++) {
    const p = queue[cursor];
    for (const door of nav.portals) {
      const q = portalCoordinates(door, p);
      if (q.along >= door.approach - 5 && q.along < door.approach + 10 && Math.abs(q.across) < 8) reached.add(door.hall.id);
    }
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = p.clone().add(new T.Vector3(dx, 0, dz));
      const key = `${Math.round((next.x - nav.spawn.x) / step)},${Math.round((next.z - nav.spawn.z) / step)}`;
      if (seen.has(key)) continue; seen.add(key);
      const trial = p.clone(); slideVisitor(trial, dx, dz, p => campusWalkable(nav, p));
      if (trial.distanceTo(next) < .01) queue.push(next);
    }
  }
  expect([...reached].sort()).toEqual(nav.portals.map(p => p.hall.id).sort());
  for (const hazard of nav.hazards) {
    if (!hazard.length) continue;
    const center = hazard.reduce((v, p) => v.add(new T.Vector3(p[0], 0, p[1])), new T.Vector3()).divideScalar(hazard.length);
    expect(inFootprint(hazard, center.x, center.z)).toBe(true);
    expect(campusWalkable(nav, center)).toBe(false);
  }
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/visitor-portals.json', JSON.stringify(report, null, 2));
});

test('movement substeps block thin obstacles and keep sliding along walls', () => {
  const p = new T.Vector3();
  slideVisitor(p, 20, 4, p => p.x < 2 || p.x > 2.5);
  expect(p.x).toBeLessThan(2); expect(p.z).toBeCloseTo(4);
  const h = measureInteriorHalls(visitorGeometry())[0];
  const position = hallToWorld(h, 0, 0, 0);
  const destination = hallToWorld(h, 30, 0, 0).sub(position);
  slideVisitor(position, destination.x, destination.z, point => {
    const local = worldToHall(h, point);
    return walkable(h, [{ minX: 2, maxX: 6, minZ: -10, maxZ: 10 }], local.x, local.z);
  });
  expect(worldToHall(h, position).x).toBeLessThan(2);
});

test('the avatar has human scale, walking articulation and owned resource cleanup', () => {
  const avatar = createVisitorAvatar();
  const scene = new T.Scene(); scene.add(avatar.root);
  const box = new T.Box3().setFromObject(avatar.root), size = box.getSize(new T.Vector3());
  expect(size.y).toBeGreaterThan(1.65); expect(size.y).toBeLessThan(1.95);
  expect(box.min.y).toBeGreaterThan(-.1);
  const first = avatar.root.toJSON(); avatar.update(.1, 2.6, false); avatar.root.updateMatrixWorld(true);
  expect(avatar.root.toJSON()).not.toEqual(first);
  let disposed = 0;
  avatar.root.traverse(o => { if (o instanceof T.Mesh) o.geometry.addEventListener('dispose', () => disposed++); });
  avatar.dispose(); expect(scene.children).toHaveLength(0); expect(disposed).toBeGreaterThan(20);
});

test('one controller crosses every doorway both ways, changes CC floors and restores its camera', () => {
  const root = visitorGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const nav = createVisitorNavigation(root, halls, new Map());
  const previous = { document: globalThis.document, window: globalThis.window, HTMLElement: globalThis.HTMLElement };
  class Element extends EventTarget {
    focus() {} setAttribute() {} setPointerCapture() {} closest() { return null; }
    getContext() { return { fillRect() {}, fillText() {} }; }
  }
  const canvas = new Element(), doc = new Element() as any;
  doc.createElement = () => new Element();
  globalThis.document = doc; globalThis.window = new EventTarget() as any; globalThis.HTMLElement = Element as any;
  const lifetime = new AbortController(), camera = new T.PerspectiveCamera(40, 1.6, 1, 2000);
  setMaxListeners(0, lifetime.signal);
  camera.position.set(200, 600, 800); const original = camera.position.clone();
  const scene = new T.Scene(), interiorLayer = new T.Group(); scene.add(interiorLayer);
  const partition = new T.Mesh(new T.BoxGeometry(8, 4, .2), new T.MeshBasicMaterial());
  partition.position.copy(nav.spawn).add(new T.Vector3(-Math.sin(nav.heading) * 2, 2, -Math.cos(nav.heading) * 2));
  partition.rotation.y = nav.heading; interiorLayer.add(partition); scene.updateMatrixWorld(true);
  let state: VisitorState | undefined, visibleInterior: string | undefined;
  const visitor = createVenueVisitor({ root: new T.Group(), interiorLayer, scene, camera, canvas: canvas as any, navigation: nav,
    halls, obstacles: new Map(), signal: lifetime.signal, invalidate() {}, reducedMotion: () => true,
    showInterior: id => visibleInterior = id, changed: s => state = s, exit: () => visitor.stop() });
  const pointer = (type: string, x: number) => { const e = new Event(type); Object.assign(e, { pointerId: 1, clientX: x, clientY: 0, pointerType: 'mouse', button: 0 }); canvas.dispatchEvent(e); };
  let now = 0;
  try {
    visitor.start();
    const eyeTarget = visitor.position.clone().add(new T.Vector3(0, 1.25, 0));
    expect(camera.position.distanceTo(eyeTarget), 'An opaque indoor partition must shorten the follow camera').toBeLessThan(2.6);
    pointer('pointerdown', 0); pointer('pointermove', 75); pointer('pointerup', 0);
    visitor.update(now += 40);
    expect(camera.position.distanceTo(eyeTarget), 'Turning next to the partition must keep the camera in front of it').toBeLessThan(2.8);
    interiorLayer.visible = false; visitor.update(now += 40);
    expect(camera.position.distanceTo(eyeTarget), 'Inactive floors must not obstruct the camera').toBeGreaterThan(4.5);
    for (const door of nav.portals) {
      visitor.restart();
      visitor.position.copy(door.position).addScaledVector(door.outward, 2);
      const heading = Math.atan2(-door.outward.x, -door.outward.z);
      pointer('pointerdown', 0); pointer('pointermove', (visitor.heading - heading) / .004); pointer('pointerup', 0);
      visitor.input('forward', true);
      for (let i = 0; i < 50; i++) visitor.update(now += 40);
      visitor.input('forward', false);
      expect(state?.hall, door.hall.id + ' entered').toBe(door.hall.id);
      expect(visibleInterior).toBe(door.hall.id);
      expect(visitor.position.y).toBeCloseTo(door.hall.center.y);
      visitor.input('backward', true);
      for (let i = 0; i < 55; i++) visitor.update(now += 40);
      visitor.input('backward', false);
      expect(state?.hall, door.hall.id + ' exited').toBe('');
      expect(visibleInterior).toBeUndefined();
    }
    const cc = nav.portals.find(p => p.hall.level)!;
    visitor.position.copy(cc.position).addScaledVector(cc.outward, -3); visitor.update(now += 200);
    expect(state?.hall).toBe('cc-level1');
    visitor.floor(2); visitor.update(performance.now() + 1000);
    expect(state?.hall).toBe('cc-level2');
    visitor.floor(3); visitor.update(performance.now() + 1000);
    expect(state?.hall).toBe('cc-level3');
    visitor.floor(1); visitor.update(performance.now() + 1000);
    expect(state?.hall).toBe('cc-level1');
    visitor.stop(); expect(camera.position.distanceTo(original)).toBeLessThan(.00001);
    expect(camera.near).toBe(1); expect(camera.fov).toBe(40);
    visitor.start(); visitor.input('forward', true); visitor.update(now += 40);
    globalThis.window.dispatchEvent(new Event('blur')); const stopped = visitor.position.clone();
    for (let i = 0; i < 10; i++) visitor.update(now += 40);
    expect(visitor.position.distanceTo(stopped)).toBeLessThan(.01);
  } finally {
    visitor.dispose(); lifetime.abort();
    interiorLayer.removeFromParent(); partition.geometry.dispose(); partition.material.dispose();
    globalThis.document = previous.document; globalThis.window = previous.window; globalThis.HTMLElement = previous.HTMLElement;
  }
  expect(scene.children).toHaveLength(0);
});

test.describe('visitor in the real viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  });
  test('walks through the actual campus into a hall and CC, then back outside', async ({ page }) => {
    test.setTimeout(150000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const root = visitorGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
    const nav = createVisitorNavigation(root, halls, new Map());
    await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to daylight' }).click();
    const state = () => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor()) as Promise<VisitorState>;
    async function walkTo(goal: T.Vector3) {
      const s = await state(), delta = goal.clone().sub(new T.Vector3(...s.position));
      const targetYaw = Math.atan2(delta.x, delta.z), angle = Math.atan2(Math.sin(s.heading - targetYaw), Math.cos(s.heading - targetYaw));
      await page.mouse.move(720, 450); await page.mouse.down();
      await page.mouse.move(720 + angle / .004, 450); await page.mouse.up();
      const count = Math.floor(Math.hypot(delta.x, delta.z));
      await page.evaluate(n => {
        const c = (window as any).ng.getComponent(document.querySelector('app-home-page'));
        for (let i = 0; i < n; i++) c.viewer.visitorStep('forward');
      }, count);
      await expect.poll(async () => { const s = await state(); return Math.hypot(s.position[0] - goal.x, s.position[2] - goal.z); }, { timeout: 4000 }).toBeLessThan(1.2);
    }
    for (const id of ['hall1', 'cc-level1']) {
      await page.getByRole('button', { name: 'Restart at gate' }).click();
      await page.getByLabel('Find an entrance').selectOption(id);
      const s = await state(), portal = nav.portals.find(p => p.hall.id === id)!;
      const point = new T.Vector3(...s.entrance!);
      // The furnished runtime may choose a neighbouring clear segment of a curved facade.
      let best = Infinity;
      for (let i = 0; i < portal.hall.outline.length; i++) {
        const a = hallToWorld(portal.hall, portal.hall.outline[i][0], 0, portal.hall.outline[i][1]);
        const next = portal.hall.outline[(i + 1) % portal.hall.outline.length], b = hallToWorld(portal.hall, next[0], 0, next[1]);
        const edge = b.clone().sub(a), t = T.MathUtils.clamp(point.clone().sub(a).dot(edge) / edge.lengthSq(), 0, 1);
        const distance = point.distanceTo(a.clone().addScaledVector(edge, t));
        if (distance < best) { best = distance; portal.outward.set(edge.z, 0, -edge.x).normalize(); }
      }
      portal.position.copy(point);
      const approach = point.clone().addScaledVector(portal.outward, portal.approach + 2);
      const route = campusRoute(nav, approach);
      for (const waypoint of route.slice(1)) await walkTo(waypoint);
      await walkTo(point.clone().addScaledVector(portal.outward, 5));
      await page.screenshot({ path: `.impeccable/review/${id}-entrance.png` });
      await walkTo(point.clone().addScaledVector(portal.outward, -7));
      await expect(page.locator('.visitor-heading')).toContainText(id === 'hall1' ? 'Hall 1' : 'CC');
      await page.screenshot({ path: `.impeccable/review/${id}-inside.png` });
      if (id === 'cc-level1') {
        await page.getByRole('button', { name: 'Level 2', exact: true }).click();
        await expect(page.locator('.visitor-heading')).toContainText('Level 2');
        await page.getByRole('button', { name: 'Level 1', exact: true }).click();
        await expect(page.locator('.visitor-heading')).toContainText('Level 1');
      } else {
        await walkTo(point.clone().addScaledVector(portal.outward, 5));
        await expect(page.getByLabel('Find an entrance')).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  });
  test('gate arrival, keyboard walking, focus, exit and existing indoor controls', async ({ page }) => {
    test.setTimeout(150000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    const launch = page.getByRole('button', { name: 'Visit as a Person', exact: true });
    await expect(launch).toBeEnabled();
    fs.mkdirSync('.impeccable/review', { recursive: true });
    await page.screenshot({ path: '.impeccable/review/visitor-overview.png' });
    await launch.click();
    await expect(page.getByRole('region', { name: 'Visitor navigation' })).toContainText('Gate 6');
    await expect(page.locator('#navigation')).toBeHidden();
    await page.getByRole('button', { name: 'Switch to daylight' }).click();
    fs.mkdirSync('.impeccable/review', { recursive: true });
    await page.screenshot({ path: '.impeccable/review/desktop.png' });
    const distance = await page.locator('.visitor-distance').textContent();
    await page.locator('canvas').first().focus(); await page.keyboard.down('w');
    await expect.poll(() => page.locator('.visitor-distance').textContent(), { timeout: 10000 }).not.toBe(distance);
    await page.keyboard.up('w');
    await page.getByLabel('Find an entrance').selectOption('hall14');
    const selected = await page.locator('.visitor-distance').textContent();
    await page.keyboard.press('Escape');
    await expect(launch).toBeVisible(); await expect(launch).toBeFocused();
    await expect(page.locator('#navigation')).toBeVisible();
    await page.locator('#halls-group').click(); await page.locator('[data-view="hall1"]').click();
    await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit walkthrough', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Exit walkthrough', exact: true }).click();
    await launch.click(); await page.getByLabel('Find an entrance').selectOption('hall14');
    expect(await page.locator('.visitor-distance').textContent()).not.toBe('');
    expect(selected).toBeTruthy();
    await page.getByRole('button', { name: 'Exit visit' }).click();
    expect(errors).toEqual([]);
  });
  test('phone controls hold, release, restart and preserve the view on resize', async ({ page }) => {
    test.setTimeout(120000); await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to daylight' }).click();
    const before = await page.locator('.visitor-distance').textContent();
    const button = page.getByRole('button', { name: 'Walk forward', exact: true }), bounds = (await button.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await expect.poll(() => page.locator('.visitor-distance').textContent()).not.toBe(before);
    await page.mouse.move(370, 450); await page.mouse.up();
    const stopped = await page.locator('.visitor-distance').textContent();
    await page.getByRole('button', { name: 'Walk faster', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Walk faster', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Restart at gate' }).click();
    await expect(page.locator('.visitor-heading')).toContainText('Gate 6');
    await expect(page.locator('.visitor-distance')).toHaveText(before!);
    expect(stopped).toBeTruthy();
    await page.screenshot({ path: '.impeccable/review/mobile.png' });
    const panel = (await page.locator('.visitor-panel').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('button', { name: 'Exit visit' })).toBeVisible();
    await page.getByRole('button', { name: 'Exit visit' }).click();
    await expect(page.getByRole('button', { name: 'Visit as a Person', exact: true })).toBeVisible();
  });
});
