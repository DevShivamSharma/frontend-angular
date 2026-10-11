import { test, expect } from '@playwright/test';
import * as T from 'three';
import { setMaxListeners } from 'node:events';
import { measureInteriorHalls, worldToHall, walkable } from '../src/app/home/venue-interiors';
import { measureCCLevels } from '../src/app/home/cc-interiors';
import { createVisitorNavigation, campusWalkable } from '../src/app/home/visitor-navigation';
import { findVisitorPath, visitorSegmentClear } from '../src/app/home/visitor-routing';
import { createVenueVisitor, INITIAL_VISITOR_STATE, VisitorState } from '../src/app/home/venue-visitor';
import { visitorGeometry } from './visitor-fixture';

test.use({ viewport: { width: 1440, height: 900 },
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('routing goes around thin obstacles, rejects sealed destinations and keeps every segment clear', () => {
  const bounds = new T.Box2(new T.Vector2(-12, -12), new T.Vector2(12, 12));
  const start = new T.Vector3(-8, 0, 0), goal = new T.Vector3(8, 0, 0);
  const allowed = (p: T.Vector3) => !(Math.abs(p.x) < .3 && Math.abs(p.z) < 6);
  const path = findVisitorPath(start, goal, bounds, allowed)!;
  expect(path.length).toBeGreaterThan(2);
  expect(path.some(p => Math.abs(p.z) >= 6)).toBe(true);
  for (let i = 1; i < path.length; i++) expect(visitorSegmentClear(path[i - 1], path[i], allowed)).toBe(true);
  expect(findVisitorPath(start, goal, bounds, p => Math.abs(p.x) >= .3)).toBeNull();
  expect(findVisitorPath(start, new T.Vector3(), bounds, allowed)).toBeNull();
});

test('avatar auto-walk reaches every actual hall, can travel between halls and stops on interruption', () => {
  test.setTimeout(90000);
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
  const lifetime = new AbortController(), camera = new T.PerspectiveCamera(), scene = new T.Scene();
  setMaxListeners(0, lifetime.signal);
  let state: VisitorState = { ...INITIAL_VISITOR_STATE }, currentHall = '';
  const visitor = createVenueVisitor({ root: new T.Group(), scene, camera, canvas: canvas as any,
    navigation: nav, halls, obstacles: new Map(), signal: lifetime.signal, invalidate() {}, reducedMotion: () => true,
    showInterior: id => currentHall = id ?? '', changed: s => state = s, exit: () => visitor.stop() });
  let now = 1000;
  const tick = () => visitor.update(now += 50);
  const go = (id: string) => {
    visitor.destination(id); const started = performance.now(); visitor.goToDestination();
    expect(performance.now() - started, `Route calculation for ${id}`).toBeLessThan(1500);
  };
  const arrive = (id: string) => {
    expect(state.autoWalking, state.hint).toBe(true);
    for (let i = 0; i < 2400 && state.autoWalking; i++) {
      const previousPosition = visitor.position.clone();
      tick();
      const door = nav.portals.find(p => p.hall.id === id)!;
      if (Math.hypot(visitor.position.x - door.position.x, visitor.position.z - door.position.z) < 5)
        expect(Math.hypot(visitor.position.x - previousPosition.x, visitor.position.z - previousPosition.z) / .05,
          'Approach the doorway at walking speed').toBeLessThanOrEqual(5.6);
      expect(nav.geometry!.blocked(visitor.position), `Body clearance on the way to ${id}`).toBe(false);
      const h = halls.find(h => h.id === currentHall);
      // Runtime substeps remain inside the same collision map used by manual movement.
      if (!h) expect(campusWalkable(nav, visitor.position)).toBe(true);
    }
    expect(state.autoWalking).toBe(false); expect(state.hall, state.hint).toBe(id);
    expect(state.hint).toContain('Arrived');
    const local = worldToHall(halls.find(h => h.id === id)!, visitor.position);
    expect(walkable(halls.find(h => h.id === id)!, [], local.x, local.z)).toBe(true);
    const stopped = visitor.position.clone(); for (let i = 0; i < 10; i++) tick();
    expect(visitor.position.distanceTo(stopped)).toBeLessThan(.001);
  };
  try {
    visitor.start();
    for (const door of nav.portals) { visitor.restart(); go(door.hall.id); arrive(door.hall.id); }
    go('hall1'); arrive('hall1'); go('hall14'); arrive('hall14');
    go('hall14'); expect(state.autoWalking).toBe(false); expect(state.hint).toContain('already');
    visitor.restart(); go('hall1'); for (let i = 0; i < 10; i++) tick();
    const avatar = scene.children.find(o => o.name === 'Visitor');
    expect(avatar?.position.distanceTo(visitor.position)).toBeLessThan(.001);
    expect(visitor.position.distanceTo(nav.spawn)).toBeGreaterThan(1);
    visitor.stopAutoWalk(); const stopped = visitor.position.clone();
    for (let i = 0; i < 10; i++) tick(); expect(visitor.position.distanceTo(stopped)).toBeLessThan(.001);
    go('hall1'); visitor.input('forward', true); expect(state.autoWalking).toBe(false);
    tick(); tick(); visitor.input('forward', false); expect(visitor.position.distanceTo(stopped)).toBeGreaterThan(.05);
    go('hall1'); visitor.destination('hall2'); expect(state.autoWalking).toBe(false); expect(state.destination).toBe('hall2');
    visitor.goToDestination(); visitor.restart(); expect(state.autoWalking).toBe(false); expect(visitor.position.distanceTo(nav.spawn)).toBeLessThan(.001);
    go('hall1'); globalThis.window.dispatchEvent(new Event('blur')); expect(state.autoWalking).toBe(false);
    go('hall1'); visitor.step('left'); expect(state.autoWalking).toBe(false);
    go('hall1'); visitor.stop(); expect(state.active).toBe(false); expect(state.autoWalking).toBe(false);
  } finally {
    visitor.dispose(); lifetime.abort();
    globalThis.document = previous.document; globalThis.window = previous.window; globalThis.HTMLElement = previous.HTMLElement;
  }
});

test('Go to hall moves the furnished viewer avatar, supports Stop and arrives inside the selected hall', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (/Shader Error|VALIDATE_STATUS|WebGLProgram.*error/i.test(message.text())) errors.push(message.text()); });
  await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to daylight' }).click();
  const state = () => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor()) as Promise<VisitorState>;
  const go = page.getByRole('button', { name: 'Go to hall', exact: true });
  await page.getByLabel('Find an entrance').selectOption('hall1');
  const before = (await state()).position;
  await go.click(); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect.poll(async () => Math.hypot((await state()).position[0] - before[0], (await state()).position[2] - before[2])).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect((await state()).autoWalking).toBe(false); await expect(go).toBeEnabled();
  await go.click(); await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  await go.click();
  await expect.poll(async () => (await state()).autoWalking, { timeout: 60000 }).toBe(false);
  expect((await state()).hint, JSON.stringify(await state())).toContain('Arrived at Hall 1');
  expect((await state()).hall).toBe('hall1'); expect((await state()).autoWalking).toBe(false);
  await expect(page.getByLabel('Find an entrance')).toHaveValue('hall1');
  await expect(page.locator('.visitor-live')).toHaveText('On foot');
  await page.screenshot({ path: 'test-results/auto-walk-desktop.png' });
  // The same command must exit a furnished hall before travelling to a second destination.
  await page.getByLabel('Find an entrance').selectOption('cc-level1'); await go.click();
  await expect.poll(async () => (await state()).autoWalking, { timeout: 60000 }).toBe(false);
  expect((await state()).hint, JSON.stringify(await state())).toContain('Arrived');
  expect((await state()).hall).toBe('cc-level1');
  await page.getByRole('button', { name: 'Level 2', exact: true }).click();
  await expect(page.locator('.visitor-heading')).toContainText('Level 2');
  await go.click(); await expect(page.locator('.visitor-hint')).toContainText('Choose Level 1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/auto-walk-mobile.png' });
  const panel = (await page.locator('.visitor-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await expect(go).toBeVisible();
  await page.getByRole('button', { name: 'Restart at gate' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Find an entrance').selectOption('hall14'); await go.click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exit visit' }).click();
  await expect(page.getByRole('button', { name: 'Visit as a Person', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
