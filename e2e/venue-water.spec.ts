import { expect, Page, test } from '@playwright/test';

test.use({ reducedMotion: 'no-preference', trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

async function sample(page: Page) {
  return page.evaluate(() => {
    const probe = (window as any).__waterProbe;
    const canvas = probe.canvas as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let changed = 0;
    if (probe.pixels) for (let i = 0; i < pixels.length; i += 4)
      if ([0, 1, 2].some(c => Math.abs(pixels[i + c] - probe.pixels[i + c]) > 3)) changed++;
    probe.pixels = pixels;
    return { changed, pixels: pixels.length / 4, draws: probe.draws };
  });
}

test('all fountain areas flow at rest, survive palette changes and respect reduced motion', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const probe = { canvas: null as HTMLCanvasElement | null, draws: 0, pixels: null };
    (window as any).__waterProbe = probe;
    const getContext = HTMLCanvasElement.prototype.getContext as any;
    (HTMLCanvasElement.prototype.getContext as any) = function(type: string, options: any) {
      if (type === 'webgl2' && this.getRootNode()?.host?.tagName === 'APP-HOME-PAGE') {
        probe.canvas = this; options = { ...options, preserveDrawingBuffer: true };
      }
      return getContext.call(this, type, options);
    };
    const prototype = WebGL2RenderingContext.prototype as any;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = prototype[name];
      prototype[name] = function(...args: any[]) {
        if (this.canvas === probe.canvas) probe.draws++;
        return original.apply(this, args);
      };
    }
  });

  for (const view of ['fountain', 'cc-cascade', 'hall6-basin']) {
    await page.goto('/?view=' + view);
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
    await page.waitForTimeout(1800);
    for (const mode of ['Natural', 'Color']) {
      if (mode === 'Color') {
        const button = page.getByRole('button', { name: mode, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
        await page.waitForTimeout(1500);
      }
      const before = await sample(page);
      await page.waitForTimeout(900);
      const after = await sample(page);
      expect(after.draws, `${view} keeps rendering without camera input`).toBeGreaterThan(before.draws);
      expect(after.changed, `${view} has visible ${mode} water motion`).toBeGreaterThan(100);
      expect(after.changed / after.pixels, 'Stationary architecture remains stable').toBeLessThan(.4);
      await page.screenshot({ path: info.outputPath(`${view}-${mode.toLowerCase()}.png`) });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(600);
    const paused = await sample(page);
    await page.waitForTimeout(700);
    const still = await sample(page);
    expect(still.changed, 'Reduced motion freezes the decorative water').toBe(0);
    expect(still.draws, 'A static view releases the GPU').toBe(paused.draws);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(900);
    expect((await sample(page)).changed, 'Water resumes without another interaction').toBeGreaterThan(100);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=fountain');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await sample(page); await page.waitForTimeout(900);
  expect((await sample(page)).changed).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath('fountain-mobile.png') });
  expect(errors).toEqual([]);
});
