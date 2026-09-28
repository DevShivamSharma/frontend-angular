import { expect, Page, test } from '@playwright/test';
import * as T from 'three';
import { createVenueGlobeMarker } from '../src/app/home/venue-globe-marker';

test.use({ trace: 'off', launchOptions: {
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--enable-unsafe-swiftshader']
} });

async function openGlobe(page: Page) {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Explore globe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter Bharat Mandapam', exact: true })).toBeVisible();
}

test('desktop: supplied icon, default label, keyboard entry and Home destination agree', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openGlobe(page);
  const marker = page.getByRole('button', { name: 'Enter Bharat Mandapam', exact: true });
  const tooltip = page.getByRole('tooltip', { name: 'Bharat Mandapam', exact: true });
  await expect(marker).toBeInViewport({ ratio: 1 });
  expect(await marker.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 557)).toBe(true);
  await expect(tooltip).toBeVisible();
  await marker.hover();
  await expect(tooltip).toBeVisible();
  await page.screenshot({ path: info.outputPath('globe-marker-desktop.png') });
  await marker.press('Escape');
  await expect(tooltip).toBeVisible();
  // Keyboard activation uses the same overview() handler as the Home control.
  await marker.press('Enter');
  await expect(marker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Return to venue', exact: true })).toBeFocused();
  await expect(page.locator('[data-view="overview"]')).toHaveClass(/active/);
  await expect(page.locator('#globe-view')).not.toHaveClass(/active/);
  const destination = await page.locator('#status').innerText();
  expect(destination).toBe('Entire venue');
  await page.waitForTimeout(3000); // The existing geographic flight lasts 2600 ms.
  await page.screenshot({ path: info.outputPath('marker-entered-venue.png') });
  await page.getByRole('button', { name: 'Explore globe', exact: true }).click();
  await expect(marker).toBeVisible();
  await page.getByRole('button', { name: 'Return to venue', exact: true }).click();
  await expect(marker).toBeHidden();
  await expect(page.locator('[data-view="overview"]')).toHaveClass(/active/);
  await expect(page.locator('#status')).toHaveText(destination);
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('tap enters the venue, with a readable location label and touch target', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openGlobe(page);
    const marker = page.getByRole('button', { name: 'Enter Bharat Mandapam', exact: true });
    await expect(marker).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('tooltip', { name: 'Bharat Mandapam', exact: true })).toBeVisible();
    const box = await marker.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('globe-marker-mobile.png') });
    await marker.tap();
    await expect(marker).toBeHidden();
    await expect(page.locator('#globe-view')).not.toHaveClass(/active/);
    await expect(page.locator('[data-view="overview"]')).toHaveClass(/active/);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: info.outputPath('marker-entered-mobile.png') });
  });
});

test('projection hides the marker behind Earth, follows resize and cleans up on teardown', () => {
  const marker = { hidden: false, style: { left: '', top: '', setProperty() {} },
    classList: { toggle() {} } } as unknown as HTMLElement;
  const canvas = { clientWidth: 1440, clientHeight: 900 };
  const radius = 6371000, center = new T.Vector3(0, -radius - 8, 0);
  const camera = new T.PerspectiveCamera(45, 1440 / 900, 1, radius * 18);
  const lifetime = new AbortController();
  camera.up.set(0, 0, 1);
  camera.position.set(0, radius * 3, 0);
  camera.lookAt(center);
  const update = createVenueGlobeMarker(marker, camera, canvas as HTMLCanvasElement, center, radius, lifetime.signal);
  update(true);
  expect(marker.hidden).toBe(false);
  expect(marker.style.left).toBe('720px');
  camera.position.set(0, -radius * 4, 0);
  camera.lookAt(center);
  update(true);
  expect(marker.hidden).toBe(true);
  camera.position.set(0, radius * 3, 0);
  camera.lookAt(center);
  canvas.clientWidth = 390;
  canvas.clientHeight = 844;
  camera.aspect = 390 / 844;
  camera.updateProjectionMatrix();
  update(true);
  expect(marker.hidden).toBe(false);
  expect(marker.style.left).toBe('195px');
  update(false);
  expect(marker.hidden).toBe(true);
  update(true);
  lifetime.abort();
  expect(marker.hidden).toBe(true);
});
