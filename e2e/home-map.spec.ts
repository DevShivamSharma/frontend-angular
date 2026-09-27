import { expect, test } from '@playwright/test';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('home: real map appears after a late load without covering the venue', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  // Hold the actual bundled geography, then release it after the viewer sleeps.
  let releaseMap!: () => void;
  const gate = new Promise<void>(resolve => { releaseMap = resolve; });
  await page.route('**/geography/delhi-context.json', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(2200);
  const pending = await page.screenshot({ path: info.outputPath('home-map-pending.png') });
  const response = page.waitForResponse('**/geography/delhi-context.json');
  releaseMap();
  expect((await response).ok()).toBe(true);
  await page.waitForTimeout(1500);
  const screenshot = await page.screenshot({ path: info.outputPath('home-map-desktop.png') });
  // Compare the surrounding area at the same camera pose. A literal palette
  // match would incorrectly reject the intentional spatial fade and AO shading.
  const changedMapPixels = await page.evaluate(async images => {
    const pixels = await Promise.all(images.map(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0); image.close();
      return ctx.getImageData(0, 70, canvas.width, Math.floor(canvas.height * .28)).data;
    }));
    let changed = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
      if ([0, 1, 2].some(channel => Math.abs(pixels[0][i + channel] - pixels[1][i + channel]) > 12)) changed++;
    }
    return changed;
  }, [[...pending], [...screenshot]]);
  await info.attach('visible-map.json', { body: JSON.stringify({ changedMapPixels }), contentType: 'application/json' });
  expect(changedMapPixels, 'Real geography must be visible and wake the sleeping renderer').toBeGreaterThan(2000);
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: info.outputPath('home-map-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('home: venue remains usable when the map asset is unavailable', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/geography/delhi-context.json', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  await page.locator('#cc-group').click();
  await expect(page.locator('aside')).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: info.outputPath('home-map-unavailable.png') });
  await expect(page.getByRole('button', { name: 'Explore globe', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
