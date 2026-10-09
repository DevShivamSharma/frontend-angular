import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import * as T from 'three';
import {
  measureInteriorHalls,
  insideHall,
  walkable,
  hallToWorld,
  worldToHall,
} from '../src/app/home/venue-interiors';
import {
  setupPlanner,
  testStall,
  testHall,
  editStall,
  plannerState,
  dismissPlottingRules,
} from './planner-test-helpers';
test.use({
  channel: 'chrome',
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'],
  },
});

function glb(file: string) {
  const bytes = fs.readFileSync(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const length = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.subarray(20, 20 + length).toString()),
    bin: bytes.subarray(28 + length),
  };
}
function geometryRoot() {
  const { json: j, bin } = glb('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
  const root = new T.Group();
  j.nodes.forEach((n: any) => {
    if (!/^PHOTO_HALL_(1|2|3|4|5|14) (standing seam roof|roof|glass entrance)$/.test(n.name || ''))
      return;
    const g = new T.Group();
    g.name = n.name.replace(/ /g, '_');
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION],
        v = j.bufferViews[a.bufferView],
        values = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++)
        for (let c = 0; c < 3; c++)
          values[i * 3 + c] = bin.readFloatLE(
            (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || 12) + c * 4,
          );
      const geometry = new T.BufferGeometry().setAttribute(
        'position',
        new T.BufferAttribute(values, 3),
      );
      g.add(new T.Mesh(geometry, new T.MeshBasicMaterial()));
    }
    if (n.translation) g.position.fromArray(n.translation);
    if (n.rotation) g.quaternion.fromArray(n.rotation);
    if (n.scale) g.scale.fromArray(n.scale);
    if (n.matrix) {
      g.matrix.fromArray(n.matrix);
      g.matrix.decompose(g.position, g.quaternion, g.scale);
    }
    root.add(g);
  });
  return root;
}

test('all extracted assets have valid geometry buffers, UVs, and traceable provenance', () => {
  const manifest = JSON.parse(fs.readFileSync('src/assets/venue/interiors/manifest.json', 'utf8'));
  expect(manifest.components).toHaveLength(13);
  for (const component of manifest.components) {
    const { json: j, bin } = glb(`src/assets/venue/interiors/${component.file}`);
    expect(j.asset.extras.sha256).toBe(manifest.sha256);
    for (const v of j.bufferViews)
      expect((v.byteOffset || 0) + v.byteLength).toBeLessThanOrEqual(bin.length);
    let triangles = 0;
    for (const mesh of j.meshes)
      for (const p of mesh.primitives) {
        const a = j.accessors[p.indices],
          v = j.bufferViews[a.bufferView],
          count = j.accessors[p.attributes.POSITION].count;
        expect(a.count % 3).toBe(0);
        let max = -1;
        for (let i = 0; i < a.count; i++)
          max = Math.max(max, bin.readUInt32LE(v.byteOffset + i * 4));
        expect(max).toBeLessThan(count);
        if (p.attributes.TEXCOORD_0 !== undefined)
          expect(j.accessors[p.attributes.TEXCOORD_0].count).toBe(count);
        triangles += a.count / 3;
      }
    expect(triangles).toBe(component.triangles);
    if (component.name === 'stone-column' || component.name === 'exit-sign') {
      expect(j.images).toHaveLength(1);
      expect(j.materials[0].pbrMetallicRoughness.baseColorTexture).toBeTruthy();
    }
    if (component.name === 'hall-point-light')
      expect(j.extensions.KHR_lights_punctual.lights[0].intensity).toBe(24.5);
  }
});

test('real hall footprints provide clear central routes and collision boundaries', () => {
  const halls = measureInteriorHalls(geometryRoot());
  expect(halls.map((h) => h.id)).toEqual(['hall1', 'hall2', 'hall3', 'hall4', 'hall5', 'hall14']);
  const dimensions = [];
  for (const h of halls) {
    expect(h.width).toBeGreaterThan(30);
    expect(h.depth).toBeGreaterThan(40);
    expect(h.height).toBeGreaterThan(10);
    const blocked: number[] = [];
    for (let z = -h.depth / 2 + 4; z <= h.depth / 2 - 4; z += 0.25)
      if (!walkable(h, [], 0, z)) blocked.push(z);
    expect(blocked, h.id).toEqual([]);
    expect(insideHall(h, 1e4, 1e4)).toBe(false);
    expect(walkable(h, [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }], 0, 0)).toBe(false);
    const local = worldToHall(h, hallToWorld(h, 3, 1.7, 4));
    expect(local.distanceTo(new T.Vector3(3, 1.7, 4))).toBeLessThan(0.0001);
    dimensions.push({
      id: h.id,
      width: h.width,
      depth: h.depth,
      ceiling: h.height,
      center: h.center.toArray(),
      angle: h.angle,
      entrance: h.entrance,
    });
  }
  fs.mkdirSync('docs/reference-interiors', { recursive: true });
  fs.writeFileSync(
    'docs/reference-interiors/adapted-halls.json',
    JSON.stringify(dimensions, null, 2),
  );
});

test.describe('interior viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://api.indiatradefair.com/**', (route) =>
      route.fulfill({ json: { data: { list: [], total: 0 } } }),
    );
  });
  test('before and after, all halls, guided controls, night mode, and GLB export', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?interior=hall1&interiors=off');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.getByRole('button', { name: 'Switch to daylight' }).click();
    await page.screenshot({ path: info.outputPath('before-hall1.png') });
    await page.goto('/?interior=hall1');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.getByRole('button', { name: 'Switch to daylight' }).click();
    await page.screenshot({ path: info.outputPath('after-hall1-day.png') });
    await expect(page.getByRole('button', { name: 'Exit walkthrough' })).toBeVisible();
    await page.getByRole('button', { name: 'Walk forward', exact: true }).click();
    await page.getByRole('button', { name: 'Guided tour', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause tour' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause tour' }).click();
    await expect(page.getByRole('button', { name: 'Resume tour' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume tour' }).click();
    await page.locator('canvas').first().press('w');
    await expect(page.getByRole('button', { name: 'Guided tour', exact: true })).toBeVisible();
    for (const id of ['hall2', 'hall3', 'hall4', 'hall5', 'hall14']) {
      await page.locator(`[data-view="${id}"]`).click();
      await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
      await expect(page.locator('#status')).toContainText('Interior walkthrough');
      await page.screenshot({ path: info.outputPath(`after-${id}-day.png`) });
    }
    await page.getByRole('button', { name: 'Switch to evening' }).click();
    await page.screenshot({ path: info.outputPath('after-hall14-night.png') });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GLB' }).click();
    const file = await download;
    const path = info.outputPath('integrated-hall14.glb');
    await file.saveAs(path);
    const exported = glb(path).json;
    expect(exported.nodes.some((n: any) => n.name === 'Interior_hall14')).toBe(true);
    expect(exported.meshes.length).toBeGreaterThan(30);
    expect(exported.images.length).toBeGreaterThan(0);
    expect(exported.extensions.KHR_lights_punctual.lights.length).toBe(4);
    const layout = exported.nodes.find((n: any) => n.name === 'Interior_hall14').extras
      .adaptedLayout;
    for (const [i, b] of layout.obstacles.entries()) {
      expect(b.minX > 0 || b.maxX < 0, 'Central aisle must stay clear').toBe(true);
      for (const c of layout.obstacles.slice(i + 1))
        expect(
          b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ,
          'Placed components must not intersect',
        ).toBe(false);
    }
    await page.getByRole('button', { name: 'Exit walkthrough' }).click();
    await expect(page.getByRole('button', { name: 'Walk inside', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return to venue' }).click();
    await page.screenshot({ path: info.outputPath('after-exterior-night.png') });
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#halls-group').click();
    await page.locator('[data-view="hall14"]').click();
    await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
    await page.screenshot({ path: info.outputPath('after-mobile.png') });
    expect(
      await page.locator('.venue-interior-actions').evaluate((el) => el.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
  });
  test('failed component download keeps the original venue available with a clear error', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.route('**/interiors/stand-island.glb', (route) =>
      route.fulfill({ status: 404, body: 'Missing test asset' }),
    );
    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
    await page.locator('#halls-group').click();
    await page.locator('[data-view="hall1"]').click();
    await expect(page.getByRole('alert')).toContainText('Interiors could not load');
    await expect(page.getByRole('button', { name: 'Return to venue' })).toBeEnabled();
  });
});

test('planner edit, successful save, and page reload preserve the persistence contract', async ({
  page,
}) => {
  await setupPlanner(page, [testStall()]);
  await editStall(page, 'Position X (m)', '6');
  let saved: any;
  await page.route('**/api/layout/save', async (route) => {
    const payload = route.request().postDataJSON();
    saved = {
      hall: { ...testHall, ...payload.hall },
      layout: { id: 321, name: payload.layoutName, eventType: payload.eventType },
      stalls: payload.stalls.map((s: any) => ({ ...s, hallId: 901 })),
    };
    await route.fulfill({ json: { layout: { id: 321 }, stalls: saved.stalls } });
  });
  await page.route('**/api/layouts', (route) =>
    route.fulfill({ json: saved ? [{ id: 321, name: saved.layout.name, stallCount: 1 }] : [] }),
  );
  await page.route('**/api/layout/321', (route) => route.fulfill({ json: saved }));
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  await expect.poll(() => saved?.stalls?.[0]?.posX).toBe(6);
  await page.reload();
  await dismissPlottingRules(page);
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: `Open ${testHall.name}`, exact: true }).click();
  await expect.poll(async () => (await plannerState(page)).stalls[0]?.posX).toBe(6);
  expect((await plannerState(page)).stalls[0].width).toBe(4);
});
