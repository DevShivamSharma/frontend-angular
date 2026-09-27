import { expect, test } from '@playwright/test';
import { setupPlanner, testHall, testStall } from './planner-test-helpers';

for (const [device, viewport] of Object.entries({
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
})) {
  test(`${device}: visible Save creates once, updates the open layout and stays reachable`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await setupPlanner(page, [testStall()]);
    await page.evaluate(() => {
      const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      store.selectedSavedId.set(null);
    });
    const writes: string[] = [];
    const saved = { id: 123, name: testHall.name, stallCount: 1 };
    let finishSave!: () => void;
    const saving = new Promise<void>(resolve => { finishSave = resolve; });
    await page.route('**/api/layouts', route => route.fulfill({ json: [saved] }));
    await page.route('**/api/layout/save', async route => {
      writes.push(route.request().method() + ' /api/layout/save');
      await saving;
      await route.fulfill({ status: 201, json: { layout: saved, hall: testHall, stalls: [testStall()] } });
    });
    await page.route('**/api/layout/123', async route => {
      writes.push(route.request().method() + ' /api/layout/123');
      await route.fulfill({ json: { layout: saved, hall: testHall, stalls: [testStall()] } });
    });

    const save = page.locator('.sidebar-header .planner-save');
    await expect(save).toHaveText('Save layout');
    await expect(save).toBeInViewport();
    for (const name of [/Assist/, /Layouts/, /^Hall$/, /Rules/, /Stalls/]) {
      await page.getByRole('tab', { name }).click();
      await expect(save).toBeInViewport();
    }
    await page.locator('.sidebar-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(save).toBeInViewport();
    await save.click();
    await expect(save).toHaveText('Saving…');
    await expect(save).toBeDisabled();
    expect(writes).toEqual(['POST /api/layout/save']);
    finishSave();
    await expect(save).toHaveText('Save changes');
    await expect(save).toBeEnabled();
    await expect(page.locator('.app-notification')).toContainText('Layout saved successfully.');
    // Screenshot rendering must not race the four-second auto-dismiss timer.
    await page.locator('.app-notification').hover();
    await expect(page.locator('.swal2-toast')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${device}-save-visible.png`) });

    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await page.getByRole('button', { name: 'Hide panel' }).click();
    const collapsedSave = page.locator('.stage-top .planner-save');
    await expect(collapsedSave).toBeInViewport();
    await expect(collapsedSave).toHaveText('Save changes');
    await collapsedSave.click();
    await expect(page.locator('.app-notification')).toContainText('Layout updated successfully.');
    expect(writes).toEqual(['POST /api/layout/save', 'PUT /api/layout/123']);
  });
}

test('failed save keeps the unsaved layout and offers a visible retry', async ({ page }) => {
  await setupPlanner(page, [testStall()]);
  await page.evaluate(() => {
    const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    store.selectedSavedId.set(null);
  });
  await page.route('**/api/layout/save', route => route.fulfill({
    status: 500, json: { message: 'Temporary save failure. Try again.' }
  }));
  const save = page.locator('.sidebar-header .planner-save');
  await save.click();
  await expect(page.locator('.app-notification')).toContainText('Temporary save failure. Try again.');
  await expect(save).toHaveText('Save layout');
  await expect(save).toBeEnabled();
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => {
    const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    return { id: store.selectedSavedId(), stalls: store.currentStalls().length };
  })).toEqual({ id: null, stalls: 1 });
});
