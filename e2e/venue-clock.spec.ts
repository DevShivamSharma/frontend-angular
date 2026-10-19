import { expect, test } from '@playwright/test';
import { delhiTime, isValidVenueTime, isVenueDaylight } from '../src/app/home/venue-clock';

test('Delhi clock handles UTC rollover and exact lighting boundaries', () => {
  expect(delhiTime(Date.parse('2026-10-19T20:45:00Z'))).toBe('02:15');
  expect(delhiTime(Date.parse('2026-10-19T01:00:00Z'))).toBe('06:30');
  for (const [time, day] of [['00:00', false], ['06:29', false], ['06:30', true],
    ['12:00', true], ['18:29', true], ['18:30', false], ['23:59', false]] as const) {
    expect(isVenueDaylight(time), time).toBe(day);
    expect(isValidVenueTime(time), time).toBe(true);
  }
  for (const time of ['', '24:00', '12:60', '6:30', 'invalid']) expect(isValidVenueTime(time)).toBe(false);
});

test.use({ trace: 'off', reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'] } });

test('live time changes lighting, manual demo holds, and Live restores the clock', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Only external catalogue responses are fixtures; the venue and WebGL renderer are real.
  await page.route('https://api.indiatradefair.com/**', route => route.fulfill({ json: { data: { list: [], total: 0 } } }));
  // Keep browser timers native so this also exercises Angular's real timer scheduling.
  await page.addInitScript(() => {
    (window as any).__venueTestNow = Date.parse('2026-10-19T12:59:00Z');
    Date.now = () => (window as any).__venueTestNow;
  });
  const setTime = (iso: string) => page.evaluate(value => { (window as any).__venueTestNow = Date.parse(value); }, iso);
  await page.goto('/?view=gate9');
  await expect(page.locator('.appearance-control')).toHaveJSProperty('inert', false, { timeout: 120_000 });
  await expect(page.locator('#home-view')).toBeEnabled();
  const summary = page.locator('.venue-time-toggle');
  await expect(summary).toContainText('18:29 IST');
  await expect(summary).toContainText('Live · Day');
  await setTime('2026-10-19T13:00:00Z');
  await expect(summary).toContainText('Live · Night', { timeout: 45_000 }); // Timer, without a click or reload.
  await expect(page.locator('#light-mode')).toHaveAttribute('aria-label', 'Switch to daylight');
  await summary.click();
  const input = page.getByLabel('Manual time');
  await input.fill('12:00');
  await expect(summary).toContainText('Demo · Day');
  await expect(page.locator('#light-mode')).toHaveAttribute('aria-label', 'Switch to evening');
  await setTime('2026-10-19T18:30:00Z');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(input).toHaveValue('12:00'); // Demo stays fixed across resume and midnight.
  await input.fill('21:15');
  await expect(summary).toContainText('Demo · Night');
  await expect(page.locator('#light-mode')).toHaveAttribute('aria-label', 'Switch to daylight');
  await page.screenshot({ path: info.outputPath('desktop-night.png') });
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(summary).toContainText('00:00 IST');
  await expect(summary).toContainText('Live · Night');
  await setTime('2026-10-20T01:00:00Z');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(summary).toContainText('06:30 IST');
  await expect(summary).toContainText('Live · Day');
  await page.locator('#light-mode').click();
  await expect(summary).toContainText('21:00 IST');
  await expect(summary).toContainText('Demo · Night');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-night.png') });
  const box = await page.locator('.venue-time-control').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Live time', exact: true }).click();
  await expect(summary).toContainText('Live · Day');
  await page.getByRole('link', { name: 'Stall planner' }).click();
  await expect(page.locator('app-home-page')).toHaveCount(0);
  expect(errors).toEqual([]);
});
