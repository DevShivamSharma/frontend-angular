import { expect, test } from '@playwright/test';
import * as T from 'three';
import { setMaxListeners } from 'node:events';
import { createVenueVisitor, INITIAL_VISITOR_STATE, VisitorState } from '../src/app/home/venue-visitor';
import { createVisitorCollisionWorld, VISITOR_HEIGHT } from '../src/app/home/visitor-collision';
import { createVisitorNavigation, visitorGroundHeight, VisitorNavigation } from '../src/app/home/visitor-navigation';
import { buildHallPlanInterior } from '../src/app/home/hall-plan-interiors';
import { InteriorHall, InteriorObstacle, measureInteriorHalls } from '../src/app/home/venue-interiors';
import { measureCCLevels } from '../src/app/home/cc-interiors';
import { planEntranceGuards } from '../src/app/home/venue-security-placement';
import { referenceVenueGeometry } from './venue-reference-fixture';

test.use({ trace: 'off', viewport: { width: 1440, height: 1000 }, launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

function controller(nav: VisitorNavigation, halls: InteriorHall[] = [], obstacles = new Map<string, InteriorObstacle[]>()) {
  const saved = { document: globalThis.document, window: globalThis.window, HTMLElement: globalThis.HTMLElement };
  class Element extends EventTarget {
    constructor(readonly button = false) { super(); }
    focus() {} setAttribute() {} setPointerCapture() {}
    closest(selector: string) { return this.button && selector.includes('button') ? this : null; }
    getContext() { return { fillRect() {}, fillText() {} }; }
  }
  const doc = new Element() as any, canvas = new Element(); doc.createElement = () => new Element();
  globalThis.document = doc; globalThis.window = new EventTarget() as any; globalThis.HTMLElement = Element as any;
  const lifetime = new AbortController(), scene = new T.Scene(); setMaxListeners(0, lifetime.signal);
  let state: VisitorState = { ...INITIAL_VISITOR_STATE }, now = 1000;
  const visitor = createVenueVisitor({ root: new T.Group(), scene, camera: new T.PerspectiveCamera(), canvas: canvas as any,
    navigation: nav, halls, obstacles, signal: lifetime.signal, invalidate() {}, reducedMotion: () => true,
    showInterior() {}, changed: value => state = value, exit: () => visitor.stop() });
  const tick = (ms = 50) => visitor.update(now += ms);
  return { visitor, scene, state: () => state, tick,
    key(down: boolean, repeat = false, button = false) {
      const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
      Object.assign(event, { key: ' ', code: 'Space', repeat, composedPath: () => [button ? new Element(true) : canvas] });
      window.dispatchEvent(event); return event;
    },
    dispose() { visitor.dispose(); lifetime.abort(); Object.assign(globalThis, saved); }
  };
}

function openCampus(): VisitorNavigation {
  return { portals: [], buildings: [], hazards: [], spawn: new T.Vector3(0, .35, 0), heading: 0,
    bounds: new T.Box2(new T.Vector2(-20, -20), new T.Vector2(20, 20)) };
}

test('Space produces one grounded jump, keeps its shadow on the floor and preserves button keyboard input', () => {
  const c = controller(openCampus());
  try {
    c.visitor.start(); c.tick();
    expect(c.key(true).defaultPrevented).toBe(true);
    let peak = 0;
    for (let i = 0; i < 35; i++) {
      c.tick(); c.key(true, true); peak = Math.max(peak, c.visitor.position.y - .35);
      const avatar = c.scene.getObjectByName('Visitor')!; avatar.updateMatrixWorld(true);
      expect(avatar.children.at(-1)!.getWorldPosition(new T.Vector3()).y).toBeCloseTo(.368, 5);
    }
    expect(peak).toBeGreaterThan(2); expect(peak).toBeLessThan(2.1);
    expect(c.state().jumping).toBe(false); expect(c.visitor.position.y).toBeCloseTo(.35);
    c.key(false);
    expect(c.key(true, false, true).defaultPrevented).toBe(false);
    expect(c.state().jumping).toBe(false);
    c.key(true); c.tick(); const height = c.visitor.position.y;
    c.visitor.jump(); c.tick(); expect(c.visitor.position.y - height).toBeLessThan(height - .35);
    c.visitor.restart(); c.tick(); expect(c.state().jumping).toBe(false); expect(c.visitor.position.y).toBeCloseTo(.35);
    c.visitor.jump(); c.tick(); c.visitor.stop(); c.visitor.start(); c.tick();
    expect(c.state().jumping).toBe(false); expect(c.visitor.position.y).toBeCloseTo(.35);
  } finally { c.dispose(); }
});

test('jumping respects overhead geometry and cannot cross a stationary guard', () => {
  const nav = openCampus(), root = new T.Group();
  const ceiling = new T.Mesh(new T.BoxGeometry(10, .1, 10), new T.MeshBasicMaterial());
  ceiling.position.y = 2.65; root.add(ceiling);
  nav.geometry = createVisitorCollisionWorld(root, []);
  nav.guards = [{ id: 'guard', portalId: '', position: new T.Vector3(0, .35, 2.2), heading: 0, radius: .42, height: 1.85 }];
  const c = controller(nav);
  try {
    c.visitor.start(); c.tick(); c.visitor.jump(); c.visitor.input('forward', true);
    let peak = 0;
    for (let i = 0; i < 24; i++) {
      c.tick(); peak = Math.max(peak, c.visitor.position.y);
      expect(c.visitor.position.y + VISITOR_HEIGHT).toBeLessThanOrEqual(2.6);
      expect(nav.geometry.blocked(c.visitor.position)).toBe(false);
      expect(c.visitor.position.z).toBeLessThan(1.2);
    }
    expect(peak).toBeGreaterThan(.5); expect(c.state().jumping).toBe(false);
    expect(c.visitor.position.y).toBeCloseTo(.35);
  } finally { c.dispose(); ceiling.geometry.dispose(); (ceiling.material as T.Material).dispose(); }
});

test('Enter Venue follows every fitted hall doorway and CC ramp, independently of the selected destination', () => {
  test.setTimeout(120000);
  const root = referenceVenueGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const obstacles = new Map<string, InteriorObstacle[]>(), layer = new T.Group();
  const plans = halls.filter(h => !h.level).map(hall => {
    const parent = new T.Group(); parent.position.copy(hall.center); parent.rotation.y = -hall.angle; layer.add(parent);
    const blocks: InteriorObstacle[] = []; obstacles.set(hall.id, blocks);
    return buildHallPlanInterior(hall, parent, blocks)!;
  });
  const nav = createVisitorNavigation(root, halls, obstacles, layer); nav.guards = planEntranceGuards(nav);
  const c = controller(nav, halls, obstacles);
  try {
    c.visitor.start(); c.tick(); expect(c.state().nearbyEntrance).toBeUndefined();
    c.visitor.enterNearby(); expect(c.state().autoWalking).toBe(false);
    for (const door of nav.portals) {
      c.visitor.restart();
      c.visitor.position.copy(door.position).addScaledVector(door.outward, door.approach - 1);
      c.tick(250); expect(c.state().nearbyEntrance?.id).toBe(door.hall.id);
      c.visitor.enterNearby(); expect(c.state().destination).toBe(door.hall.id);
      expect(c.state().autoWalking, c.state().hint).toBe(true);
      for (let i = 0; i < 500 && c.state().autoWalking; i++) c.tick();
      expect(c.state().hall, c.state().hint).toBe(door.hall.id);
      expect(c.state().hint).toContain('Arrived'); expect(c.state().nearbyEntrance).toBeUndefined();
      const floor = visitorGroundHeight(nav, c.visitor.position, door.hall);
      c.visitor.jump(); for (let i = 0; i < 20; i++) c.tick();
      expect(c.state().jumping).toBe(false); expect(c.visitor.position.y).toBeCloseTo(floor);
    }
  } finally { c.dispose(); plans.forEach(p => p.dispose()); }
});

test('visitor entry and jumping controls work on desktop and mobile', async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.indiatradefair.com/**', route => route.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.route('**/main.js', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source.includes('function renderFrame() {'), 'The test origin must serve the 3D venue app').toBe(true);
    await route.fulfill({ response, body: source.replace('function renderFrame() {',
      'function renderFrame() { window.__visitorQA={visitor,visitorNavigation,frames,renderFrame};') });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click({ timeout: 120000 });
  const canvas = page.locator('canvas').first();
  const state = () => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor());
  await expect(page.getByRole('button', { name: 'Enter Venue', exact: true })).toBeHidden();
  await canvas.focus(); await page.keyboard.press('Space');
  await expect.poll(async () => (await state()).jumping).toBe(true);
  await expect.poll(async () => (await state()).jumping).toBe(false);
  await page.getByRole('combobox', { name: 'Find an entrance' }).focus();
  await page.keyboard.press('Space'); expect((await state()).jumping).toBe(false); await page.keyboard.press('Tab');
  await page.evaluate(() => {
    const q = (window as any).__visitorQA;
    const door = q.visitorNavigation.portals.find((p: any) => p.hall.id === 'hall14');
    q.visitor.position.copy(door.position).addScaledVector(door.outward, 5);
    q.visitor.update(performance.now()); q.renderFrame();
  });
  const enter = page.getByRole('button', { name: 'Enter Venue', exact: true });
  await expect(enter).toBeVisible(); await expect(page.locator('#nearby-venue')).toContainText('Hall 14');
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const otherHalls = page.getByRole('button', { name: 'Choose another hall', exact: true });
  await expect(otherHalls).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: 'Find an entrance' })).toBeHidden();
  await otherHalls.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('combobox', { name: 'Find an entrance' })).toBeVisible();
  expect((await state()).jumping).toBe(false);
  await page.getByRole('button', { name: 'Hide other halls' }).click();
  await page.screenshot({ path: info.outputPath('mobile.png') });
  expect((await page.locator('.visitor-panel').boundingBox())!.height).toBeLessThan(265);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Jump', exact: true }).click();
  await expect(enter).toBeDisabled();
  await expect.poll(async () => (await state()).jumping).toBe(false); await expect(enter).toBeEnabled();
  await enter.click();
  await expect.poll(async () => (await state()).hall, { timeout: 30000 }).toBe('hall14');
  await expect(enter).toBeHidden(); await expect(page.locator('.visitor-hint')).toContainText('Arrived', { timeout: 10000 });
  await page.getByRole('button', { name: 'Jump', exact: true }).click();
  await expect.poll(async () => (await state()).jumping).toBe(true);
  await page.getByRole('button', { name: 'Restart at gate' }).click();
  expect((await state()).jumping).toBe(false);
  await page.getByRole('button', { name: 'Exit visit', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Visit as a Person', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
