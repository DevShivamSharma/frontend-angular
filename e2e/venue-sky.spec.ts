import { expect, test } from '@playwright/test';

test.use({ trace: 'off', viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('venue sky: day and night stay visible through resizing and globe travel without an idle render loop', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|webgl|three/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    (window as any).__skyDraws = 0;
    for (const name of ['clear', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const proto = WebGL2RenderingContext.prototype as any, original = proto[name];
      proto[name] = function (...args: any[]) {
        if (this.canvas.isConnected) (window as any).__skyDraws++;
        return original.apply(this, args);
      };
    }
  });
  const draws = () => page.evaluate(() => (window as any).__skyDraws as number);
  const settle = async () => {
    await page.evaluate(() => { (window as any).__skyQuiet = { count: -1, since: performance.now() }; });
    await page.waitForFunction(() => {
      const state = (window as any).__skyQuiet, count = (window as any).__skyDraws;
      if (state.count !== count) { state.count = count; state.since = performance.now(); }
      return performance.now() - state.since > 700;
    }, undefined, { timeout: 15_000 });
  };
  const idle = async () => {
    await settle();
    const before = await draws();
    await page.waitForTimeout(800);
    expect(await draws(), 'Static sky must release the GPU when the overview or globe is idle').toBe(before);
  };
  const light = async (daylight: boolean) => {
    const before = await draws();
    await page.getByRole('button', { name: daylight ? 'Switch to daylight' : /Switch to (?:evening|night)/ }).click();
    await expect.poll(draws).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: daylight ? /Switch to (?:evening|night)/ : 'Switch to daylight' })).toBeVisible();
  };
  const resize = async (width: number, height: number) => {
    const before = await draws();
    await page.setViewportSize({ width, height });
    await expect.poll(draws).toBeGreaterThan(before);
  };
  const capture = async (name: string) => {
    const bytes = await page.screenshot({ path: info.outputPath(name + '.png') });
    await info.attach(name, { body: bytes, contentType: 'image/png' });
    return bytes;
  };
  const skyStats = async (bytes: Buffer, mobile = false) => page.evaluate(async ({ bytes, mobile }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    // Use the clear sky band BELOW the visitor/appearance controls and ABOVE
    // Hall 14's horizon. The topmost band contains HTML buttons whose contrast
    // would otherwise let a completely flat background pass this check.
    const left = Math.round(canvas.width * (mobile ? .12 : .40));
    const top = Math.round(canvas.height * (mobile ? .125 : .16));
    const width = Math.round(canvas.width * (mobile ? .78 : .45));
    const height = Math.round(canvas.height * (mobile ? .115 : .08));
    const pixels = ctx.getImageData(left, top, width, height).data;
    let luminance = 0, rowContrast = 0;
    for (let y = 0; y < height; y++) {
      let min = Infinity, max = -Infinity;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, value = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
        luminance += value; min = Math.min(min, value); max = Math.max(max, value);
      }
      rowContrast += max - min;
    }
    return { luminance: luminance / (width * height), horizontalContrast: rowContrast / height,
      sampledRect: { left, top, width, height } };
  }, { bytes: [...bytes], mobile });
  const earthContrast = async (bytes: Buffer) => page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    const space = ctx.getImageData(canvas.width * .88, canvas.height * .12, 1, 1).data;
    let contrast = 0;
    for (const x of [.35, .45, .55, .65]) for (const y of [.2, .35, .5, .65, .8]) {
      const earth = ctx.getImageData(canvas.width * x, canvas.height * y, 1, 1).data;
      contrast = Math.max(contrast, ...[0, 1, 2].map(i => Math.abs(earth[i] - space[i])));
    }
    return contrast;
  }, [...bytes]);

  await page.goto('/?view=hall14-front');
  await page.waitForFunction(() => {
    const button = document.querySelector('app-home-page')?.shadowRoot?.querySelector<HTMLButtonElement>('#globe-view');
    return button && !button.closest('[inert]') && !button.disabled;
  }, undefined, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  const desktopDay = await skyStats(await capture('hall14-day-desktop'));
  await light(false);
  const desktopNight = await skyStats(await capture('hall14-night-desktop'));
  expect(desktopDay.luminance - desktopNight.luminance, 'Day sky is visibly brighter than night sky').toBeGreaterThan(30);
  expect(desktopDay.horizontalContrast, 'Day sky has cloud/sun detail beyond a flat vertical gradient').toBeGreaterThan(3);
  expect(desktopNight.horizontalContrast, 'Night sky has cloud/moon/star detail beyond a flat vertical gradient').toBeGreaterThan(1);

  await resize(390, 844);
  const mobileNight = await skyStats(await capture('hall14-night-mobile'), true);
  await light(true);
  const mobileDay = await skyStats(await capture('hall14-day-mobile'), true);
  expect(mobileDay.luminance - mobileNight.luminance, 'Night/day remains legible at mobile width').toBeGreaterThan(30);
  expect(mobileDay.horizontalContrast, 'Mobile daytime sky retains visible detail without UI controls').toBeGreaterThan(3);
  expect(mobileNight.horizontalContrast, 'Mobile nighttime sky retains visible detail without UI controls').toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await resize(1440, 1000);
  const repeatedDay = await skyStats(await capture('hall14-day-return'));
  expect(Math.abs(repeatedDay.luminance - desktopDay.luminance), 'Switching modes/resizing restores the same static sky').toBeLessThan(5);
  await light(false);
  await page.getByRole('button', { name: 'Explore globe', exact: true }).click();
  await expect(page.locator('#globe-view')).toHaveClass(/active/);
  await idle();
  expect(await earthContrast(await capture('globe-night')), 'Earth stays visible beyond the atmospheric sky').toBeGreaterThan(30);
  await light(true);
  await idle();
  expect(await earthContrast(await capture('globe-day'))).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await expect(page.locator('#globe-view')).not.toHaveClass(/active/);
  await idle();
  await expect(page.getByRole('button', { name: /Switch to (?:evening|night)/ })).toBeVisible();
  await light(false);
  await idle();
  await capture('overview-night-after-globe');
  await info.attach('sky-pixel-metrics', { body: JSON.stringify({ desktopDay, desktopNight, mobileDay, mobileNight, repeatedDay }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
