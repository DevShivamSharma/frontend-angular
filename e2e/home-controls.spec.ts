import { expect, test } from '@playwright/test';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('home: rendering wakes for controls, globe, resize and late assets, and stops on teardown', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__draws = 0;
    (window as any).__homeDraws = 0;
    const homeCanvases = new WeakSet<HTMLCanvasElement>();
    // Count clears too: a globe flight can temporarily face empty sky and still be animating.
    for (const name of ['clear', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const proto = WebGL2RenderingContext.prototype as any, original = proto[name];
      proto[name] = function (...args: any[]) {
        if (this.canvas.isConnected) (window as any).__draws++;
        if (this.canvas.getRootNode()?.host?.tagName === 'APP-HOME-PAGE') homeCanvases.add(this.canvas);
        if (homeCanvases.has(this.canvas)) (window as any).__homeDraws++;
        return original.apply(this, args);
      };
    }
  });
  // Delay an actual local asset, then release the real response after rendering sleeps.
  let releaseEarth!: () => void;
  const earthGate = new Promise<void>(resolve => { releaseEarth = resolve; });
  await page.route('**/geography/earth-day.jpg', async route => { await earthGate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  const draws = () => page.evaluate(() => (window as any).__draws as number);
  const settle = async () => {
    await page.evaluate(() => { (window as any).__quiet = { draws: -1, since: performance.now() }; });
    await page.waitForFunction(() => {
      const state = (window as any).__quiet, count = (window as any).__draws;
      if (state.draws !== count) { state.draws = count; state.since = performance.now(); }
      return performance.now() - state.since > 700;
    }, undefined, { timeout: 15_000 });
  };
  const wakes = async (action: () => Promise<unknown>) => {
    await settle();
    const before = await draws();
    await action();
    await expect.poll(draws, { timeout: 10_000 }).toBeGreaterThan(before);
    await settle();
  };
  await wakes(async () => { releaseEarth(); });
  await wakes(() => page.getByRole('button', { name: 'Zoom in', exact: true }).click());
  await wakes(() => page.getByRole('button', { name: 'Zoom out', exact: true }).click());
  await wakes(() => page.getByRole('button', { name: 'Switch to daylight', exact: true }).click());
  await expect(page.getByRole('button', { name: 'Switch to evening', exact: true })).toBeVisible();
  await wakes(() => page.getByRole('button', { name: 'Switch to evening', exact: true }).click());
  await page.locator('#halls-group').click();
  await wakes(() => page.locator('#hall-menu [data-view="hall1"]').click());
  await expect(page.locator('#hall-menu [data-view="hall1"]')).toHaveClass(/active/);
  await wakes(() => page.locator('#cc-group').click());
  // Actual mesh picking still selects the Convention Centre after the raycast cache change.
  await page.keyboard.press('Escape');
  await wakes(() => page.mouse.click(900, 450));
  await expect(page.locator('aside')).toBeVisible();
  await wakes(() => page.locator('#cc-menu [data-level="1"]').click());
  await expect(page.locator('#cc-menu [data-level="1"]')).toHaveClass(/active/);
  await wakes(() => page.getByRole('button', { name: 'Explore globe', exact: true }).click());
  await expect(page.locator('#globe-view')).toHaveClass(/active/);
  const globeImage = await page.screenshot({ path: info.outputPath('home-globe.png') });
  // A selected globe button is insufficient: verify that the Earth is visible against the sky.
  const earthContrast = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    const sky = ctx.getImageData(canvas.width * .85, canvas.height * .12, 1, 1).data;
    let contrast = 0;
    // Sample land and ocean; one centre pixel can legitimately be almost as dark as space.
    for (const x of [.35, .45, .55, .65]) for (const y of [.2, .35, .5, .65, .8]) {
      const earth = ctx.getImageData(canvas.width * x, canvas.height * y, 1, 1).data;
      contrast = Math.max(contrast, ...[0, 1, 2].map(i => Math.abs(earth[i] - sky[i])));
    }
    return contrast;
  }, [...globeImage]);
  expect(earthContrast, 'Globe must show the Earth, not a blank transitional frame').toBeGreaterThan(30);
  await wakes(() => page.getByRole('button', { name: 'Return to venue', exact: true }).click());
  await expect(page.locator('#globe-view')).not.toHaveClass(/active/);
  await wakes(() => page.setViewportSize({ width: 390, height: 844 }));
  await wakes(() => page.getByRole('button', { name: 'Return to venue', exact: true }).click());
  await page.screenshot({ path: info.outputPath('home-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    (window as any).__homeContext = canvas.getContext('webgl2');
  });
  await page.getByRole('link', { name: 'Stall planner' }).click();
  await expect(page.locator('app-home-page')).toHaveCount(0);
  await expect(page.locator('app-planner-page')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__homeContext.isContextLost())).toBe(true);
  const homeDraws = await page.evaluate(() => (window as any).__homeDraws);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__homeDraws)).toBe(homeDraws);
  expect(errors).toEqual([]);
});
