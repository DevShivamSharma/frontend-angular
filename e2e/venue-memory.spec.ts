import { expect, test } from '@playwright/test';

// Keep collection checks separate from FPS measurements and trace readbacks.
test.use({ trace: 'off', viewport: { width: 390, height: 844 }, launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('venue route exit releases scene memory across repeat visits', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Retained-memory measurement uses Chromium CDP.');
  test.setTimeout(180_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const samples: { stage: string; heapBytes: number; backingBytes: number; totalBytes: number }[] = [];
  const sample = async (stage: string) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(250);
    await cdp.send('HeapProfiler.collectGarbage');
    const memory = await cdp.send('Runtime.getHeapUsage');
    const backingBytes = memory.backingStorageSize ?? 0;
    const result = { stage, heapBytes: memory.usedSize, backingBytes, totalBytes: memory.usedSize + backingBytes };
    samples.push(result);
    return result.totalBytes;
  };
  const ready = async () => {
    await page.waitForFunction(() => {
      const button = document.querySelector('app-home-page')?.shadowRoot?.querySelector<HTMLButtonElement>('#globe-view');
      return button && !button.closest('[inert]') && !button.disabled;
    }, undefined, { timeout: 120_000 });
  };
  const leave = async () => {
    await page.getByRole('link', { name: /Stall planner/ }).click();
    await page.waitForURL(/\/planner\/halls(?:\?|$)/);
    await expect(page.locator('app-home-page')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'India Trade Promotion Organisation — back to the venue' })).toBeVisible();
  };

  await page.goto('/');
  await ready();
  const documentStarted = await page.evaluate(() => performance.timeOrigin);
  const firstView = await sample('first-viewer');
  await leave();
  const firstExit = await sample('first-planner');
  await page.getByRole('link', { name: 'India Trade Promotion Organisation — back to the venue' }).click();
  await ready();
  const secondView = await sample('second-viewer');
  await leave();
  const secondExit = await sample('second-planner');
  await info.attach('retained-memory', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });

  // Follow real SPA links: a document reload could otherwise hide missed teardown.
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted);
  // Allow loaded Angular/planner modules while rejecting a retained full venue graph.
  const megabyte = 1024 * 1024;
  expect(firstExit, 'first route exit releases the venue graph').toBeLessThan(Math.max(64 * megabyte, firstView * .2));
  expect(secondView, 'returning to the venue does not keep two complete scenes').toBeLessThan(firstView * 1.25 + 16 * megabyte);
  expect(secondExit, 'repeat exit stays near the initial planner footprint').toBeLessThan(firstExit + 16 * megabyte);
  expect(errors).toEqual([]);
});
