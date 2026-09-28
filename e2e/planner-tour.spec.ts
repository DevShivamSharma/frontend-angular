import { expect, Page, test } from '@playwright/test';
import { dismissPlottingRules, testHall, testStall } from './planner-test-helpers';

const key = 'stall-planner.guided-tour.v1';
const tour = (page: Page) => page.getByRole('dialog', { name: 'Stall Planner guided tour' });

async function openPlanner(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/halls' ? [testHall] : [] });
  });
  await page.goto('/planner');
  await expect(tour(page)).not.toBeVisible();
  await dismissPlottingRules(page);
  await expect(tour(page)).toBeVisible();
  return writes;
}

async function expectPlacement(page: Page, step: string) {
  await expect(tour(page)).toHaveAttribute('data-step', step);
  await expect(page.locator('.tour-spotlight')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const card = document.querySelector('.tour-card')!.getBoundingClientRect();
    const spot = document.querySelector('.tour-spotlight')!.getBoundingClientRect();
    return {
      cardVisible: card.x >= 0 && card.y >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
      spotVisible: spot.x >= 0 && spot.y >= 0 && spot.right <= innerWidth && spot.bottom <= innerHeight,
      separate: card.right <= spot.left || card.left >= spot.right || card.bottom <= spot.top || card.top >= spot.bottom
    };
  })).toEqual({ cardVisible: true, spotVisible: true, separate: true });
}

for (const [device, viewport] of Object.entries({
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  smallPhone: { width: 320, height: 568 }
})) {
  test(`${device}: five steps stay visible, finish persists, and Help replays`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const writes = await openPlanner(page);
    await expectPlacement(page, 'hall');
    await expect(tour(page)).toContainText('Step 1 / 5');
    await expect(tour(page).getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await expect(page.locator('#tour-title')).toBeFocused();
    await page.screenshot({ path: info.outputPath(`${device}-hall.png`) });
    // The highlighted control remains usable; the tour is not a modal barrier.
    await page.getByRole('button', { name: 'Working hall', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a working hall' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Search halls' }).press('Escape');
    await expect(tour(page)).toBeVisible();
    await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expectPlacement(page, 'stall');
    await expect(page.locator('[data-tour="add-stall"]')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`${device}-stall.png`) });
    await tour(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expectPlacement(page, 'hall');
    await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
    await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expectPlacement(page, 'position');
    await page.screenshot({ path: info.outputPath(`${device}-position.png`) });
    await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expectPlacement(page, 'details');
    await expect(tour(page)).toContainText('Add or select a stall');
    await page.screenshot({ path: info.outputPath(`${device}-details.png`) });
    await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expectPlacement(page, 'save');
    await expect(tour(page)).toContainText('Step 5 / 5');
    await page.screenshot({ path: info.outputPath(`${device}-save.png`) });
    await tour(page).getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(tour(page)).not.toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('completed');
    expect(writes).toEqual([]);
    await page.reload();
    await dismissPlottingRules(page);
    await expect(tour(page)).not.toBeVisible();
    const help = page.getByRole('button', { name: 'Help / Restart tour', exact: true });
    await help.click();
    await expectPlacement(page, 'hall');
    await tour(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(help).toBeFocused();
    await expect(tour(page)).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('skip and Escape persist, collapsed-panel replay restores state, selected details are used', async ({ page }) => {
  await openPlanner(page);
  await tour(page).getByRole('button', { name: 'Skip', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('skipped');
  await page.reload();
  await dismissPlottingRules(page);
  await expect(tour(page)).not.toBeVisible();
  await page.evaluate(stall => {
    const component = (window as any).ng.getComponent(document.querySelector('app-planner-page'));
    component.store.stalls.set([stall]);
    component.store.selectStall(stall.id);
  }, testStall());
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await page.getByRole('button', { name: 'Help / Restart tour', exact: true }).click();
  for (let i = 0; i < 3; i++) await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expectPlacement(page, 'details');
  await expect(tour(page)).toContainText('Review the selected stall name');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPlacement(page, 'details');
  await page.locator('#tour-title').press('Escape');
  await expect(tour(page)).not.toBeVisible();
  await expect(page.locator('.planner')).toHaveClass(/is-sidebar-collapsed/);
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Layouts/ })).toHaveAttribute('aria-selected', 'true');
});

test('blocked local storage uses session fallback without crashing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page);
  await tour(page).getByRole('button', { name: 'Skip', exact: true }).click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe('skipped');
  await page.reload();
  await dismissPlottingRules(page);
  await expect(tour(page)).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('tour waits for hall loading after rules close, and supports offline fallback', async ({ page }) => {
  let release!: () => void;
  const waitForHall = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/halls') {
      await waitForHall;
      await route.fulfill({ status: 503, json: { message: 'Offline' } });
    } else await route.fulfill({ json: [] });
  });
  await page.goto('/planner');
  await dismissPlottingRules(page);
  await expect(tour(page)).not.toBeVisible();
  release();
  await expectPlacement(page, 'hall');
  for (let i = 0; i < 4; i++) await tour(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tour(page)).toContainText('You are using an offline sample');
});
