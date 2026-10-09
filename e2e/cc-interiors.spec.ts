import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import * as T from 'three';
import { buildCCInteriors, measureCCLevels } from '../src/app/home/cc-interiors';
import { CC_PLANS } from '../src/app/home/cc-plan-data';
import { walkable } from '../src/app/home/venue-interiors';

test.use({
  channel: 'chrome',
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 1000 },
  launchOptions: {
    args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'],
  },
});
function jsonGLB(path: string) {
  const b = fs.readFileSync(path);
  return {
    j: JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()),
    bin: b.subarray(28 + b.readUInt32LE(12)),
  };
}
function rootFromActualGLB() {
  const { j, bin } = jsonGLB('src/assets/venue/IITF_2026_ARCHITECTURAL.glb'),
    root = new T.Group();
  for (const n of j.nodes) {
    if (!/^PHOTO_CC_LEVEL_[123] floor plate$|^PHOTO_CC shell$/.test(n.name ?? '')) continue;
    const g = new T.Group();
    g.name = n.name.replace(/ /g, '_');
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION],
        v = j.bufferViews[a.bufferView],
        values = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++)
        for (let k = 0; k < 3; k++)
          values[i * 3 + k] = bin.readFloatLE(
            (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || 12) + k * 4,
          );
      g.add(
        new T.Mesh(
          new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(values, 3)),
          new T.MeshBasicMaterial(),
        ),
      );
    }
    if (n.translation) g.position.fromArray(n.translation);
    if (n.rotation) g.quaternion.fromArray(n.rotation);
    if (n.scale) g.scale.fromArray(n.scale);
    root.add(g);
  }
  return root;
}
test('three source plans register to real CC plates and all guided segments stay walkable', () => {
  const root = rootFromActualGLB(),
    halls = measureCCLevels(root);
  expect(halls.map((h) => h.level)).toEqual([1, 2, 3]);
  expect(halls.map((h) => Number(h.center.y.toFixed(2)))).toEqual([6.4, 15, 26.1]);
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, fillText() {} }),
    }),
  } as any;
  const fixture = new T.Group();
  fixture.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial()));
  const built = buildCCInteriors(
    root,
    new Map([
      ['ceiling-light', fixture],
      ['reception-counter', fixture],
    ]),
  );
  globalThis.document = previous;
  const report: any[] = [];
  for (const { hall, blocks, group } of built.levels) {
    const failures: any[] = [];
    for (let segment = 1; segment < hall.route!.length; segment++) {
      const a = hall.route![segment - 1],
        b = hall.route![segment],
        steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2);
      for (let i = 0; i <= steps; i++) {
        const x = a[0] + ((b[0] - a[0]) * i) / steps,
          z = a[1] + ((b[1] - a[1]) * i) / steps;
        if (!walkable(hall, blocks, x, z)) {
          failures.push({
            segment,
            x: +x.toFixed(2),
            z: +z.toFixed(2),
            block: blocks.find(
              (b) =>
                x > b.minX - 0.45 && x < b.maxX + 0.45 && z > b.minZ - 0.45 && z < b.maxZ + 0.45,
            ),
          });
          break;
        }
      }
    }
    let meshes = 0,
      seats = 0;
    group.traverse((o) => {
      if (o instanceof T.Mesh) meshes++;
      if (o.name === 'Seats' && o instanceof T.InstancedMesh) seats = o.count;
    });
    report.push({
      level: hall.level,
      width: hall.width,
      depth: hall.depth,
      floorElevation: hall.center.y,
      ceiling: hall.height,
      rooms: group.userData['rooms'],
      seatsIllustrative: seats,
      meshes,
      route: hall.route,
      routeFailures: failures,
    });
    expect(failures, `Level ${hall.level} tour route`).toEqual([]);
    expect(seats).toBeGreaterThan(100);
    expect(hall.rooms!.every((r) => Number.isFinite(r.position[0]))).toBe(true);
  }
  const shell = root.children.find((o) => o.name === 'PHOTO_CC_shell')!;
  built.cutaway(true);
  expect(shell.visible).toBe(false);
  built.cutaway(false);
  expect(shell.visible).toBe(true);
  fs.mkdirSync('docs/cc-interiors', { recursive: true });
  fs.writeFileSync(
    'docs/cc-interiors/verification.json',
    JSON.stringify(
      { sources: CC_PLANS.map((p) => ({ source: p.source, sha256: p.sha256 })), levels: report },
      null,
      2,
    ),
  );
  built.dispose();
});

test('CC level menu, room walkthrough, tour, source plan and GLB export', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.indiatradefair.com/**', (route) =>
    route.fulfill({ json: { data: { list: [], total: 0 } } }),
  );
  await page.goto('/?ccLevel=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 120000 });
  await page.getByRole('button', { name: 'Switch to daylight' }).click();
  for (const n of [1, 2, 3]) {
    if (n !== 1) await page.locator(`[data-level="${n}"]`).click();
    await expect(page.getByRole('button', { name: 'Walk inside', exact: true })).toBeVisible();
    await expect(page.locator('#status')).toContainText(`Level ${n}`);
    await page.screenshot({ path: info.outputPath(`cc-level${n}-overview.png`) });
    const room = n === 1 ? 'mr19' : n === 2 ? 'g20' : 'plenary';
    await page.locator(`#room-cc-level${n}`).selectOption(room);
    await expect(page.getByRole('button', { name: 'Exit walkthrough', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`cc-level${n}-inside.png`) });
    await page.getByRole('button', { name: 'Guided tour', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause tour', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume tour', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '3D floor view', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Floor plan', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect(page.locator('dialog img')).toHaveAttribute('src', /cc-plans\/level3.png/);
  await page.keyboard.press('Escape');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const file = await download,
    path = info.outputPath('cc-level3.glb');
  await file.saveAs(path);
  const { j } = jsonGLB(path);
  const level = j.nodes.find((n: any) => n.name === 'Interior_cc-level3');
  expect(level.extras.sourcePlan).toBe('CC-level-3.pdf');
  expect(level.extras.rooms.some((r: any) => r.id === 'multi-function')).toBe(true);
  expect(j.images.length).toBeGreaterThan(10);
  expect(j.extensions.KHR_lights_punctual.lights).toHaveLength(4);
  expect(j.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
  await page.getByRole('button', { name: 'Switch to evening' }).click();
  await page.locator('#room-cc-level3').selectOption('plenary');
  await page.screenshot({ path: info.outputPath('cc-plenary-night.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('cc-mobile.png') });
  expect(
    await page.locator('.venue-interior-actions').evaluate((el) => el.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await page.locator('#halls-group').click();
  await page.locator('[data-view="hall1"]').click();
  await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Hall 1');
  expect(errors).toEqual([]);
});
