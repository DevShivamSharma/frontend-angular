import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 },
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('concourse crowd shares GPU assets, walks slowly, respects motion/device budgets and releases resources', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Shader Error|VALIDATE_STATUS|Concourse pedestrians unavailable/.test(m.text())) errors.push(m.text()); });
  await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.route('**/main.js', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('function renderFrame() {');
    await route.fulfill({ response, body: source.replace('function renderFrame() {',
      'function renderFrame() { window.__crowdQA={scene,camera,frames,pedestrians};') });
  });
  await page.goto('/?view=hall-spine');
  await page.waitForFunction(() => (window as any).__crowdQA?.pedestrians, {}, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const q = (window as any).__crowdQA; q.frames.pause();
    const crowd = q.pedestrians, batches = crowd.group.children.filter((o: any) => o.isInstancedMesh);
    const geometries = new Set<any>(batches.map((o: any) => o.geometry));
    const maps = new Set<any>(batches.map((o: any) => o.material.map));
    let now = performance.now();
    crowd.update(now, q.camera, 900);
    const snapshot = () => batches.map((b: any) => ({ matrices: Array.from(b.instanceMatrix.array), poses: Array.from(b.geometry.attributes.crowdPose.array) }));
    const starts = JSON.stringify(snapshot());
    for (let i = 0; i < 60; i++) crowd.update(now += 1000 / 60, q.camera, 900);
    const moved = starts !== JSON.stringify(snapshot());
    const movingVisible = crowd.group.userData.visibleCount;
    crowd.update(now += 17, q.camera, 900, true, true);
    const frozen = JSON.stringify(snapshot());
    for (let i = 0; i < 20; i++) crowd.update(now += 17, q.camera, 900, true, true);
    const reducedFrozen = frozen === JSON.stringify(snapshot());
    const standing = batches.every((b: any) => Array.from({length:b.count},(_,i)=>b.geometry.attributes.crowdPose.getY(i)).every(w=>w===0));
    crowd.update(now += 17, q.camera, 900, false);
    const hidden = !crowd.group.visible;
    q.camera.aspect = 390 / 844; q.camera.updateProjectionMatrix();
    crowd.update(now += 17, q.camera, 844);
    const mobileLimit = crowd.group.userData.maxVisible;
    q.camera.aspect = 1440 / 900; q.camera.updateProjectionMatrix();
    for (let i = 0; i < 120; i++) crowd.update(now += 40, q.camera, 900);
    const pressureLimit = crowd.group.userData.maxVisible;
    const data = { ...crowd.group.userData };
    let disposals = 0;
    geometries.forEach(g => g.addEventListener('dispose', () => disposals++));
    crowd.dispose(); crowd.dispose();
    return { data, batchCount: batches.length, geometryCount: geometries.size, textureCount: maps.size,
      moved, movingVisible, reducedFrozen, standing, hidden, mobileLimit, pressureLimit, disposals, detached: !crowd.group.parent };
  });
  expect(result.data.pedestrianCount).toBe(360); expect(result.data.gpuAnimation).toBe(true);
  expect(result.data.routeCount).toBeGreaterThan(8);
  expect(result.data.renderScale).toBe(.8);
  expect(result.batchCount).toBe(2); expect(result.textureCount).toBe(1);
  expect(result.data.lowTriangles).toBeLessThan(800);
  expect(result.data.highTriangles).toBeLessThan(5500);
  expect(result.moved).toBe(true);
  expect(result.movingVisible).toBeGreaterThan(12); expect(result.movingVisible).toBeLessThanOrEqual(160);
  expect(result.reducedFrozen).toBe(true); expect(result.standing).toBe(true); expect(result.hidden).toBe(true);
  expect(result.mobileLimit).toBe(96); expect(result.pressureLimit).toBe(96);
  expect(result.disposals).toBe(result.geometryCount); expect(result.detached).toBe(true);
  expect(errors).toEqual([]);
});
