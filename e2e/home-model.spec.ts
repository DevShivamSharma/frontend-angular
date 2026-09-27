import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('home model: exact replacement, embedded images, gate navigation, pan and wheel', async ({page}, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [], models: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', r => { if (/\.glb(?:\?|$)/.test(r.url())) models.push(r.url()); });
  await page.addInitScript(() => {
    (window as any).__embeddedImages = 0;
    const decode = window.createImageBitmap;
    window.createImageBitmap = async (...args: any[]) => {
      const image = await (decode as any)(...args);
      if (args[0] instanceof Blob && args[0].type === 'image/png') (window as any).__embeddedImages++;
      return image;
    };
  });
  // Hash the real server response before forwarding it unchanged. Chromium's
  // inspector cache evicts 60 MB bodies before response.body() can retrieve them.
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  let modelHash = '';
  await page.route('**/IITF_2026_ARCHITECTURAL.glb*', async route => {
    const response = await route.fetch(), bytes = await response.body();
    modelHash = hash(bytes);
    await route.fulfill({response, body:bytes});
  });
  const response = page.waitForResponse(r => /\.glb(?:\?|$)/.test(r.url()));
  await page.goto('/');
  const loaded = await response;
  expect(loaded.ok()).toBe(true);
  expect(modelHash).toBe(hash(readFileSync('outputs/outputs/IITF_2026_ARCHITECTURAL.glb')));
  await expect(page.locator('#loading')).toBeHidden({timeout:90_000});
  expect(models).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__embeddedImages)).toBe(3);
  await page.waitForTimeout(2500);
  await page.screenshot({path:info.outputPath('new-model-overview.png')});
  await page.locator('#gates-group').click();
  await expect(page.locator('#gate-menu button')).toHaveCount(12);
  await page.locator('#gate-menu [data-view="gate6"]').click();
  await expect(page.locator('#status')).toHaveText('Gate 6');
  await page.waitForTimeout(2200);
  await page.screenshot({path:info.outputPath('new-model-gate6.png')});
  await page.getByRole('button',{name:'Entire venue',exact:true}).click();
  await page.waitForTimeout(2200);
  const before = await page.locator('canvas').screenshot();
  await page.mouse.move(1000,500); await page.mouse.down({button:'right'});
  await page.mouse.move(1080,550,{steps:12}); await page.mouse.up({button:'right'});
  await page.waitForTimeout(1500);
  const panned = await page.locator('canvas').screenshot();
  expect(panned.equals(before), 'Right-drag changes the actual rendered camera').toBe(false);
  await page.mouse.wheel(0,-300); await page.waitForTimeout(1500);
  expect((await page.locator('canvas').screenshot()).equals(panned), 'Wheel changes the rendered camera').toBe(false);
  for (const level of [1,2,3]) {
    if (level === 1) await page.locator('#cc-group').click();
    await page.locator(`#cc-menu [data-level="${level}"]`).click();
    await expect(page.locator(`#cc-menu [data-level="${level}"]`)).toHaveClass(/active/);
    await expect(page.locator('#status')).toContainText(`Level ${level}`);
  }
  expect(errors).toEqual([]);
});
