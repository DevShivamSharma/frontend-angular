import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--use-angle=d3d11'] } });

test('visitor starts outside Gate 9, approaches through the opening, and can restart', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  await page.route('**/main.js', async r => {
    const response = await r.fetch();
    const body = (await response.text()).replace('function renderFrame() {',
      'function renderFrame() { window.__gateQA={visitor,gate9,root,visitorNavigation};');
    await r.fulfill({ response, body });
  });
  await page.goto('/?view=gate9-approach');
  await page.waitForFunction(() => (window as any).__gateQA?.visitor, {}, { timeout: 90000 });
  await page.getByRole('button', { name: /Visit as a Person/i }).click();
  await expect(page.locator('.visitor-heading')).toContainText('Gate 9');
  const start = await page.evaluate(() => {
    const q = (window as any).__gateQA;
    const leaves: any[] = []; q.root.traverse((o: any) => { if (o.name.startsWith('GATE9_moving_leaf_')) leaves.push(o.position.toArray()); });
    return { position: q.visitor.position.toArray(), heading: q.visitor.heading, leaves };
  });
  expect(start.position[2]).toBeGreaterThan(310);
  expect(Math.cos(start.heading)).toBeLessThan(-.99);
  expect(start.leaves.length).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  const closed = await page.evaluate(() => {
    const a: any[] = []; (window as any).__gateQA.root.traverse((o: any) => { if (o.name.startsWith('GATE9_moving_leaf_')) a.push(o.position.toArray()); }); return a;
  });
  expect(closed).toEqual(start.leaves);
  // Step along the real collision-tested route, letting the normal render loop
  // publish proximity and animate the gate before crossing it.
  await page.evaluate(() => { for (let i = 0; i < 10; i++) (window as any).__gateQA.visitor.step('forward'); });
  await expect.poll(() => page.evaluate(() => { const q = (window as any).__gateQA; let x = 0; q.root.traverse((o: any) => { if (o.name.startsWith('GATE9_moving_leaf_') && !x) x = o.position.x; }); return x; })).not.toBe(start.leaves[0][0]); await page.waitForTimeout(3000);
  const near = await page.evaluate(() => {
    const q = (window as any).__gateQA, leaves: any[] = [];
    q.root.traverse((o: any) => { if (o.name.startsWith('GATE9_moving_leaf_')) leaves.push(o.position.toArray()); });
    return { position: q.visitor.position.toArray(), leaves };
  });
  expect(near.position[2]).toBeLessThan(start.position[2] - 9);
  expect(Math.abs(near.leaves[0][0] - start.leaves[0][0])).toBeGreaterThan(7);
  await page.evaluate(() => { for (let i = 0; i < 28; i++) (window as any).__gateQA.visitor.step('forward'); });
  expect(await page.evaluate(() => (window as any).__gateQA.visitor.position.z)).toBeLessThan(284);
  await page.screenshot({ path: 'tmp/photo-review/gate9-visitor-inside.png' });
  await page.evaluate(() => (window as any).__gateQA.visitor.restart());
  expect(await page.evaluate(() => (window as any).__gateQA.visitor.position.toArray())).toEqual(start.position);
  await page.evaluate(() => (window as any).__gateQA.visitor.stop());
  await page.waitForTimeout(3000);
  const reset = await page.evaluate(() => {
    const a: any[] = []; (window as any).__gateQA.root.traverse((o: any) => { if (o.name.startsWith('GATE9_moving_leaf_')) a.push(o.position.toArray()); }); return a;
  });
  expect(reset).toEqual(start.leaves);
});
