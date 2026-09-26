import { expect, test } from '@playwright/test';

// Trace screenshots force GPU readbacks at every Playwright step and distort FPS.
test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

// Instrument the actual WebGL canvas, without changing the application or mocking APIs.
test('home: measure rendering and trusted input responsiveness', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = { draws: 0, frames: [] as { time: number; draws: number }[],
      inputs: [] as { type: string; delay: number }[], longTasks: [] as number[] };
    (window as any).__homeProfile = state;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const prototype = WebGL2RenderingContext.prototype as any;
      const original = prototype[name];
      prototype[name] = function (...args: any[]) {
        // Include only the visible home canvas, not PMREM/offscreen test contexts.
        if (this.canvas.isConnected) state.draws++;
        return original.apply(this, args);
      };
    }
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'wheel']) {
      window.addEventListener(type, event => {
        if (event.isTrusted) state.inputs.push({ type, delay: Math.max(0, performance.now() - event.timeStamp) });
      }, { capture: true, passive: true });
    }
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
    let previousDraws = 0;
    function sample(time: number) {
      state.frames.push({ time, draws: state.draws - previousDraws });
      previousDraws = state.draws;
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Explore globe' })).toBeEnabled({ timeout: 120_000 });
  // Enabled alone does not cover an inert ancestor during the loading gate.
  await page.waitForFunction(() => {
    const home = document.querySelector('app-home-page');
    const button = home?.shadowRoot?.querySelector('#globe-view');
    return button && !button.closest('[inert]');
  }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const gpu = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')!;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio };
  });
  const reset = () => page.evaluate(() => {
    const p = (window as any).__homeProfile;
    p.frames = []; p.inputs = []; p.longTasks = []; p.start = performance.now(); p.startDraws = p.draws;
  });
  const measure = () => page.evaluate(() => {
    const p = (window as any).__homeProfile;
    const seconds = (performance.now() - p.start) / 1000;
    const percentile = (values: number[], fraction: number) => values.length ?
      [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] : 0;
    const intervals = p.frames.slice(1).map((f: any, i: number) => f.time - p.frames[i].time);
    return { seconds, rafFps: p.frames.length / seconds,
      renderedFps: p.frames.filter((f: any) => f.draws > 0).length / seconds,
      drawCalls: p.draws - p.startDraws, frameP95Ms: percentile(intervals, .95),
      inputCount: p.inputs.length, inputDelayP95Ms: percentile(p.inputs.map((e: any) => e.delay), .95),
      inputDelayMaxMs: percentile(p.inputs.map((e: any) => e.delay), 1),
      longTasks: p.longTasks.length, longTaskMaxMs: percentile(p.longTasks, 1) };
  });
  await reset();
  await page.waitForTimeout(3000);
  const idle = await measure();
  console.log('HOME_IDLE ' + JSON.stringify({ gpu, idle }));
  await reset();
  await page.mouse.move(900, 500);
  await page.mouse.down();
  for (let i = 0; i < 36; i++) {
    await page.mouse.move(900 + Math.sin(i / 6) * 200, 500 + Math.cos(i / 6) * 70);
    await page.waitForTimeout(70);
  }
  await page.mouse.up();
  const orbit = await measure();
  console.log('HOME_ORBIT ' + JSON.stringify(orbit));
  await page.getByRole('button', { name: 'Entire venue', exact: true }).click();
  await page.waitForTimeout(4000);
  await reset();
  await page.locator('#cc-group').click();
  await page.waitForTimeout(1800);
  const destination = await measure();
  await page.waitForTimeout(2500);
  await reset();
  await page.waitForTimeout(2500);
  const settled = await measure();
  await page.screenshot({ path: info.outputPath('home-desktop.png') });
  const result = { gpu, idle, orbit, destination, settled, errors };
  await info.attach('home-performance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.log('HOME_PERFORMANCE ' + JSON.stringify(result));
  expect(errors).toEqual([]);
  if (!process.env['PERFORMANCE_BASELINE']) {
    expect(idle.drawCalls, 'No repeated GPU work once the scene settles').toBe(0);
    expect(settled.drawCalls, 'Rendering sleeps again after interaction').toBe(0);
    expect(orbit.drawCalls, 'Dragging still renders the scene').toBeGreaterThan(0);
    expect(destination.drawCalls, 'Destination changes wake the renderer').toBeGreaterThan(0);
  }
});
