import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test.use({ trace: 'off', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('reference venue renders both appearances, near views and mobile without shader errors', async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Shader Error|VALIDATE_STATUS|WebGLProgram.*error/i.test(m.text())) errors.push(m.text()); });
  await page.route('https://api.indiatradefair.com/**', r => r.fulfill({ json: { data: { list: [], total: 0 } } }));
  const out = 'outputs/venue-reference/after'; fs.mkdirSync(out, { recursive: true });
  const ready = async () => {
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await expect(page.getByRole('button', { name: 'Switch to evening' })).toBeVisible();
  };
  const capture = async (name: string) => { await page.waitForTimeout(2400); await page.screenshot({ path: `${out}/${name}.png` }); };
  const start = Date.now(); await page.goto('/'); await ready();
  const loadingMs = Date.now() - start;
  await capture('overview-day-natural');
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Color', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 });
  await capture('overview-day-color');
  await page.locator('#halls-group').click();
  for (const id of ['hall14', 'hall1', 'hall6']) {
    await page.locator(`#hall-menu [data-view="${id}"]`).click();
    await page.keyboard.press('Escape'); await capture(`${id}-day-color`);
  }
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Natural', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/?view=hall14-front'); await ready(); await capture('hall14-front');
  await page.goto('/?view=hall-spine'); await ready(); await capture('hall-spine');
  await page.goto('/?view=concourse'); await ready(); await capture('concourse');
  await page.locator('#gates-group').click();
  await page.locator('#gate-menu [data-view="gate6"]').click(); await capture('gate6');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Entire venue', exact: true }).click(); await capture('mobile-overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Visit as a Person', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go to hall', exact: true })).toBeVisible();
  await capture('mobile-visitor');
  const runtime = await page.evaluate(() => ({
    modelResources: performance.getEntriesByType('resource').filter(e => /\.glb/.test(e.name)).map(e => ({
      file: e.name.split('/').pop(), durationMs: e.duration,
      bytes: (e as PerformanceResourceTiming).decodedBodySize })),
    heap: (performance as any).memory ? { usedBytes: (performance as any).memory.usedJSHeapSize,
      totalBytes: (performance as any).memory.totalJSHeapSize } : null
  }));
  const metrics = { loadingMs, ...runtime, errors, note: 'Local development server; desktop load and subsequent mobile heap snapshot; not a production-host benchmark.' };
  fs.writeFileSync(`${out}/runtime.json`, JSON.stringify(metrics, null, 2));
  await info.attach('runtime.json', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
