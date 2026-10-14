import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVisitorAvatarModel } from '../src/app/home/visitor-avatar-model';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 },
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('Nathan walks without root drift, settles when stopped and disposes his resources', async () => {
  const bytes = fs.readFileSync('src/assets/venue/characters/visitor-nathan.glb');
  const loader = new GLTFLoader().register(() => ({ name: 'geometry-test',
    loadTexture: async () => new T.Texture() }));
  const loaded = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  loaded.scene.traverse(object => {
    if ((object as T.Mesh).isMesh) (object as T.Mesh).material = new T.MeshStandardMaterial();
  });
  // The Node test runner uses Three's CJS build; the addon imports its ESM build.
  // Rehydrate into one class registry, as the browser bundler already does.
  const gltf = { scene: new T.ObjectLoader().parse(loaded.scene.toJSON()) as T.Group,
    animations: loaded.animations.map(clip => T.AnimationClip.parse(clip.toJSON())) };
  const original = gltf.animations[0].toJSON();
  const avatar = createVisitorAvatarModel(gltf.scene, gltf.animations);
  const scene = new T.Scene(); scene.add(avatar.root); scene.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(avatar.root, true);
  expect(bounds.max.y - bounds.min.y).toBeCloseTo(1.8, 3);
  expect(bounds.min.y).toBeCloseTo(0, 3);
  const bone = gltf.scene.getObjectByName('rp_nathan_animated_003_walking_root')!;
  const initial = bone.position.clone(), poses = new Set<string>();
  let minFloor = Infinity, maxFloor = -Infinity;
  for (let i = 0; i < 600; i++) {
    avatar.update(1 / 60, 2.6, false);
    expect(bone.position.distanceTo(initial)).toBeLessThan(.0001);
    if (i % 30 === 0) {
      scene.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(avatar.root, true);
      minFloor = Math.min(minFloor, box.min.y); maxFloor = Math.max(maxFloor, box.min.y);
      poses.add(JSON.stringify(gltf.scene.getObjectByName('rp_nathan_animated_003_walking_hip')!.quaternion.toArray()));
    }
  }
  expect(poses.size).toBeGreaterThan(10);
  expect(minFloor).toBeGreaterThan(-.06); expect(maxFloor).toBeLessThan(.08);
  for (let i = 0; i < 60; i++) avatar.update(1 / 60, 0, false);
  const pose = () => { const values: number[] = []; gltf.scene.traverse(o => {
    if (o instanceof T.Bone) values.push(...o.position.toArray(), ...o.quaternion.toArray());
  }); return values; };
  const standing = pose();
  expect(avatar.update(.1, 0, false)).toBe(false); expect(pose()).toEqual(standing);
  for (let i = 0; i < 60; i++) avatar.update(1 / 60, 2.6, true);
  expect(pose()).toEqual(standing);
  for (let i = 0; i < 60; i++) avatar.update(1 / 60, 2.6, false, 1);
  expect(pose()).toEqual(standing);
  expect(gltf.animations[0].toJSON()).toEqual(original);
  let disposed = 0;
  gltf.scene.traverse(o => { if (o instanceof T.Mesh) o.geometry.addEventListener('dispose', () => disposed++); });
  avatar.dispose(); expect(scene.children).toHaveLength(0); expect(disposed).toBeGreaterThan(0);
});

test('Nathan loads in the venue on desktop and mobile, with walking and jump controls', async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' && message.text().includes('Visitor avatar unavailable')) errors.push(message.text()); });
  await page.route('https://api.indiatradefair.com/**', route => route.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.route('**/main.js', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('function renderFrame() {');
    await route.fulfill({ response, body: source.replace('function renderFrame() {',
      'function renderFrame() { window.__avatarQA={scene,camera,visitor,renderFrame};') });
  });
  await page.goto('/');
  const loaded = page.waitForResponse(r => r.url().endsWith('/visitor-nathan.glb') && r.ok());
  await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click({ timeout: 120000 });
  await loaded;
  await expect.poll(() => page.evaluate(() => !!(window as any).__avatarQA?.scene.getObjectByName('Nathan visitor')), { timeout: 30000 }).toBe(true);
  const state = () => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-home-page')).visitor());
  await page.screenshot({ path: info.outputPath('nathan-desktop.png') });
  const start = (await state()).position;
  await page.locator('canvas').first().focus(); await page.keyboard.down('w');
  await expect.poll(async () => (await state()).position).not.toEqual(start);
  await page.screenshot({ path: info.outputPath('nathan-walking.png') });
  await page.keyboard.up('w');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state()).jumping).toBe(true);
  await expect.poll(async () => (await state()).jumping).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('nathan-mobile.png') });
  await expect(page.getByRole('button', { name: 'Walk forward', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Exit visit', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Visit as a Person', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
