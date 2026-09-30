import { expect, test } from '@playwright/test';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

test('satellite: a late photo respects Natural, is cached, and survives globe navigation', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/satellite/')) requests.push(request.url()); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/satellite-inner.jpg', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  const natural = page.getByRole('button', { name: 'Natural', exact: true });
  const color = page.getByRole('button', { name: 'Color', exact: true });
  await color.click();
  await expect(color).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  await expect.poll(() => requests.filter(url => url.endsWith('satellite-inner.jpg')).length).toBe(1);
  await expect(page.locator('#satellite-credit')).toHaveCount(0);
  await natural.click();
  const response = page.waitForResponse('**/satellite-inner.jpg');
  release();
  expect((await response).ok()).toBe(true);
  await page.waitForTimeout(700);
  await expect(natural).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#satellite-credit')).toHaveCount(0);
  await color.click();
  await expect(page.locator('#satellite-credit')).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: info.outputPath('satellite-desktop.png') });
  await page.getByRole('button', { name: 'Explore globe', exact: true }).click();
  await page.waitForTimeout(3300);
  await expect(page.locator('#satellite-credit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await page.waitForTimeout(3300);
  await expect(page.locator('#satellite-credit')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: info.outputPath('satellite-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.filter(url => url.endsWith('.jpg'))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('satellite: a failed photo leaves the map usable and a later Color switch retries', async ({ page }) => {
  test.setTimeout(120_000);
  let attempts = 0;
  await page.route('**/satellite-inner.jpg', route => ++attempts === 1 ? route.abort('failed') : route.continue());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  const color = page.getByRole('button', { name: 'Color', exact: true });
  const fallback = page.waitForEvent('console', message => message.text().includes('Satellite unavailable'));
  await color.click();
  await fallback;
  await expect(color).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#satellite-credit')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ })).toBeVisible();
  await page.locator('#cc-group').click();
  await expect(page.locator('aside')).toBeVisible();
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await color.click();
  await expect(page.locator('#satellite-credit')).toBeVisible();
  expect(attempts).toBe(2);
});
