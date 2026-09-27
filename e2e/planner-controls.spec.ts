import { expect, test } from '@playwright/test';
import { setupPlanner, testHall } from './planner-test-helpers';

const hallNames = ['Hall 1GF', 'Convention Center', 'Hall 1FF', 'Hall 2GF', 'Hall 2FF',
  'Hall 3GF', 'Hall 3FF', 'Hall 4GF', 'Hall 4FF', 'Hall 5GF', 'Hall 5FF', 'Hall 6',
  'Hall 8-9-10', 'Hall 11', 'Hall 12', 'Hall 12A', 'Hall 14GF', 'Hall 14FF'];

for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
  test(`${device}: searchable hall picker and layer switches preserve planner behavior`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await setupPlanner(page, [], { ...testHall, width: 20, length: 20, name: 'Hall 1GF' });
    await page.evaluate(halls => {
      const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      store.halls.set(halls);
    }, hallNames.map((name, i) => ({ ...testHall, width: 20, length: 20, id: 901 + i, name })));

    const trigger = page.getByRole('button', { name: 'Working hall', exact: true });
    await expect(trigger).toContainText('Hall 1GF');
    await trigger.click();
    const search = page.getByRole('combobox', { name: 'Search halls' });
    const picker = page.getByRole('dialog', { name: 'Choose a working hall' });
    await expect(search).toBeFocused();
    await expect(picker.getByRole('option').first()).toHaveText('Convention Center');
    await expect(picker.getByRole('option', { name: 'Hall 1GF', exact: true })).toHaveAttribute('aria-selected', 'true');
    const bounds = await picker.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath(`${device}-hall-picker.png`) });
    await trigger.click();
    await expect(picker).not.toBeVisible();
    await trigger.click();

    await search.fill('14ff');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await search.press('Enter');
    await expect(trigger).toContainText('Hall 14FF');
    await expect(trigger).toBeFocused();
    await expect(picker).not.toBeVisible();
    await trigger.press('ArrowDown');
    await expect(search).toHaveValue('');
    await search.press('ArrowUp');
    await search.press('Enter');
    await expect(trigger).toContainText('Hall 14GF');

    await trigger.click();
    await search.fill('no such hall');
    await expect(picker).toContainText('No halls found');
    await expect(picker.getByRole('option')).toHaveCount(0);
    await search.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Hall 14GF');
    await trigger.click();
    await search.press('Tab');
    await expect(picker).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Excel' })).toBeFocused();
    await trigger.click();
    await page.getByRole('heading', { name: '3D Floor Planner', exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const clearances = page.getByRole('checkbox', { name: 'Clearances', exact: true });
    const free = page.getByRole('checkbox', { name: /^Free space for/ });
    await expect(clearances).toBeChecked();
    await clearances.uncheck();
    await clearances.focus();
    await clearances.press('Space');
    await expect(clearances).toBeChecked();
    await free.check();
    await expect(free.locator('..')).toHaveClass(/is-on/);
    await expect(free.locator('..')).toContainText('fit');
    const flags = await page.evaluate(() => {
      const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      return { clearances: store.showClearances(), free: store.showFreeSpace() };
    });
    expect(flags).toEqual({ clearances: true, free: true });
    await page.screenshot({ path: info.outputPath(`${device}-layer-switches.png`) });
    await free.uncheck();
    await expect(free.locator('..')).not.toHaveClass(/is-on/);
  });
}
