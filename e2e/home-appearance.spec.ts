import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

for (const appearance of ['natural', 'color']) test(appearance + ' home: zoom frame stays visually identical after the camera stops', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const probe = { draws: 0, captureNext: false, immediate: '', canvas: null as HTMLCanvasElement | null };
    (window as any).__appearance = probe;
    const canvasPrototype = HTMLCanvasElement.prototype as any;
    const getContext = canvasPrototype.getContext;
    canvasPrototype.getContext = function (type: string, options?: any) {
      // Test only: retain pixels for a delayed comparison without forcing another render.
      // This is deliberately separate from the unmodified-context FPS measurement.
      if (type === 'webgl2' && this.getRootNode()?.host?.tagName === 'APP-HOME-PAGE') {
        probe.canvas = this;
        options = { ...options, preserveDrawingBuffer: true };
      }
      return getContext.call(this, type, options);
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const proto = WebGL2RenderingContext.prototype as any, original = proto[name];
      proto[name] = function (...args: any[]) {
        if (this.canvas === probe.canvas) probe.draws++;
        return original.apply(this, args);
      };
    }
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => request(time => {
      const before = probe.draws;
      callback(time);
      if (probe.captureNext && probe.draws > before && probe.canvas) {
        probe.captureNext = false;
        probe.immediate = probe.canvas.toDataURL('image/png');
      }
    });
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  if (appearance === 'color') {
    await page.getByRole('button', {name:'Color',exact:true}).click();
    await expect(page.getByRole('button', {name:'Color',exact:true})).toHaveAttribute('aria-pressed','true',{timeout:60_000});
  }
  await page.waitForTimeout(4000);
  await page.evaluate(() => { (window as any).__appearance.captureNext = true; });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).__appearance.immediate));
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const probe = (window as any).__appearance;
    return { immediate: probe.immediate as string, settled: probe.canvas.toDataURL('image/png') as string };
  });
  for (const [name, data] of Object.entries(result)) {
    await writeFile(info.outputPath(`home-${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  expect(errors).toEqual([]);
  expect(result.immediate === result.settled,
    'The first rendered zoom frame must not change shading/sharpness 1.5 seconds later').toBe(true);
});
