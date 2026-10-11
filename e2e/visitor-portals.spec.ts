import { test, expect } from '@playwright/test';
import * as T from 'three';
import { createVisitorPortals } from '../src/app/home/visitor-portals';
import { VisitorPortal } from '../src/app/home/visitor-navigation';
import { InteriorHall } from '../src/app/home/venue-interiors';

test.use({ viewport: { width: 1440, height: 900 },
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('entrances stay visible at a distance without material recompiles or replacing existing clipping', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) } as any;
  const root = new T.Group(), scene = new T.Scene();
  const material = new T.MeshStandardMaterial(), wall = new T.Mesh(new T.BoxGeometry(50, 6, .2), material);
  wall.position.set(10, 3, 0); root.add(wall);
  const existingPlanes = [new T.Plane(new T.Vector3(0, 1, 0), -8)]; material.clippingPlanes = existingPlanes;
  const originalCompile = material.onBeforeCompile, originalKey = material.customProgramCacheKey;
  const portals: VisitorPortal[] = [0, 20].map((x, i) => ({
    position: new T.Vector3(x, .26, 0), outward: new T.Vector3(0, 0, 1), width: 4.4, approach: 10,
    hall: { id: `hall${i + 1}`, label: `Hall ${i + 1}` } as InteriorHall,
  }));
  const doors = createVisitorPortals(root, portals, scene);
  try {
    const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader } as any;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const version = material.version;
    expect(shader.uniforms.visitorOpeningPlanes.value).toHaveLength(12);
    doors.setEnabled(true);
    for (const position of [new T.Vector3(0, 0, 300), new T.Vector3(0, 0, 30), new T.Vector3(0, 0, 5), new T.Vector3(20, 0, 5)]) {
      doors.update(position, 1 / 60, 24);
      for (const portal of portals) expect(doors.cutsPoint(portal.position.clone().add(new T.Vector3(0, 1, 0)), wall)).toBe(true);
      expect(material.version).toBe(version);
      expect(material.clippingPlanes).toBe(existingPlanes);
    }
    expect(doors.cutsPoint(new T.Vector3(10, 1, 0), wall)).toBe(false);
    const frame = scene.getObjectByName('Visitor entrances')!.children[0];
    // At fast campus speed, opening begins well before the old 12 m trigger.
    for (let i = 0; i < 20; i++) doors.update(new T.Vector3(0, .26, 25), .05, 24);
    expect(frame.children[3].position.x).toBeLessThan(-2.8);
    doors.update(new T.Vector3(0, .26, 5), .05, 5.5, true);
    expect(frame.children[3].position.x).toBeCloseTo(-4.4 * .74);
    doors.setEnabled(false);
    expect(doors.cutsPoint(new T.Vector3(0, 1, 0), wall)).toBe(false);
    expect(material.version).toBe(version);
  } finally {
    doors.dispose(); globalThis.document = previous;
    expect(material.onBeforeCompile).toBe(originalCompile); expect(material.customProgramCacheKey).toBe(originalKey);
    wall.geometry.dispose(); material.dispose();
  }
});

test('the real gate is visible before arrival on desktop and mobile', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Shader Error|VALIDATE_STATUS|WebGLProgram.*error/i.test(m.text())) errors.push(m.text()); });
  await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to daylight' }).click();
  await page.getByLabel('Find an entrance').selectOption('hall1');
  await page.getByRole('button', { name: 'Go to hall', exact: true }).click();
  await page.waitForFunction(() => {
    const state = (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor();
    return state.autoWalking && state.distance < 55;
  }, undefined, { timeout: 60000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const state = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor());
  expect(state.distance).toBeGreaterThan(30);
  const heading = Math.atan2(state.entrance[0] - state.position[0], state.entrance[2] - state.position[2]);
  const angle = Math.atan2(Math.sin(state.heading - heading), Math.cos(state.heading - heading));
  await page.mouse.move(720, 500); await page.mouse.down();
  await page.mouse.move(720 + angle / .004, 500); await page.mouse.up();
  await page.screenshot({ path: 'test-results/gate-approach-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/gate-approach-mobile.png' });
  expect(errors).toEqual([]);
});
