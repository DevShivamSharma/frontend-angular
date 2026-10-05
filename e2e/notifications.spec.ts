import { expect, Page, test } from '@playwright/test';
import { editStall, plannerState, setupPlanner, testHall, testStall } from './planner-test-helpers';

const toast = (page: Page) => page.locator('app-notification .app-notification');

async function expectCornerToast(page: Page, message: string) {
  await expect(toast(page)).toContainText(message);
  // Pause auto-dismiss while inspecting/capturing the visible notification.
  await toast(page).hover();
  await expect(toast(page)).toHaveCount(1);
  await expect(page.locator('.swal2-toast')).toHaveCount(0);
  await expect(page.locator('.stage .toast-stack, .stage .feedback')).toHaveCount(0);
  await expect.poll(async () => {
    const box = await toast(page).boundingBox(), size = page.viewportSize()!;
    return !!box && box.x >= 0 && box.y >= 0 && box.y < 24 &&
      box.x + box.width <= size.width && box.y + box.height < size.height;
  }).toBe(true);
  await expect(toast(page).getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
}

for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
  test(`${device}: placement rejection shares the toast and keeps recovery actions in Rules`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await setupPlanner(page, [testStall(1), testStall(2, { posX: 10 })]);
    await editStall(page, 'Position X (m)', '1');
    await expectCornerToast(page, 'Move rejected');
    expect((await plannerState(page)).stalls[1].posX).toBe(10);
    await page.screenshot({ path: info.outputPath(`${device}-placement-toast.png`) });

    await toast(page).getByRole('button', { name: 'View details' }).click();
    await expect(page.getByRole('tab', { name: /Rules/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Move rejected' })).toBeVisible();
    await page.getByRole('button', { name: 'Locate STALL_OVERLAP' }).click();
    expect((await plannerState(page)).focus).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`${device}-placement-details.png`) });

    // Dismissing a notification and repeating the same invalid move must show it again.
    const rejectAgain = () => page.evaluate(() => {
      const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      store.placeStall(2, 1, 0);
    });
    await rejectAgain();
    await expectCornerToast(page, 'Move rejected');
    await toast(page).getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toast(page)).toHaveCount(0);
    await rejectAgain();
    await expectCornerToast(page, 'Move rejected');
    await toast(page).getByRole('button', { name: 'Dismiss notification' }).click();
    await page.getByRole('region', { name: 'Move rejected' }).getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect((await plannerState(page)).rejection).toBeNull();
  });
}

test('save, update and delete keep their shared toast; request failures use it too', async ({ page }, info) => {
  await setupPlanner(page, [testStall()]);
  const saved = { id: 123, name: 'Notification test', stallCount: 1 };
  // Mock persistence without reaching or mutating the real database.
  await page.route('**/api/layouts', route => route.fulfill({ json: [saved] }));
  await page.route('**/api/layout/save', route => route.fulfill({ json: { hall: testHall, layout: saved, stalls: [testStall()] } }));
  await page.route('**/api/layout/123', route => route.fulfill({ json: { hall: testHall, layout: saved, stalls: [testStall()] } }));
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  await expectCornerToast(page, 'Layout saved successfully.');
  await expect(toast(page)).toHaveClass(/is-success/);
  await page.screenshot({ path: info.outputPath('save-toast.png') });
  await toast(page).getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expectCornerToast(page, 'Layout updated successfully.');
  await toast(page).getByRole('button', { name: 'Dismiss notification' }).click();

  await page.getByRole('button', { name: 'Delete Notification test', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expectCornerToast(page, 'Layout deleted.');
  await expect(page.getByRole('button', { name: 'Delete Notification test', exact: true })).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Dismiss notification' }).click();

  await page.route('**/api/layout/save', route => route.fulfill({ status: 500, json: { message: 'Could not save the layout. Please try again.' } }));
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  await expectCornerToast(page, 'Save Error');
  await expect(toast(page)).toHaveClass(/is-danger/);
  await expect(toast(page)).toContainText('Could not save the layout. Please try again.');
  await expect(toast(page).getByRole('button', { name: 'View details' })).toHaveCount(0);
  expect((await plannerState(page)).stalls).toHaveLength(1);
});

test('planner stays in the viewport after long sidebar scrolling and a confirmation dialog', async ({ page }, info) => {
  await page.setViewportSize({ width: 1536, height: 600 });
  await setupPlanner(page);
  await page.route('**/api/layouts', route => route.fulfill({ json: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Saved layout ${i + 1}`, stallCount: 24 })) }));
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Saved layout 1', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await page.mouse.move(300, 540);
  await page.mouse.wheel(0, 15000);
  await expect.poll(() => page.locator('.sidebar-body').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await page.mouse.wheel(0, 15000);
  await expect.poll(() => page.evaluate(() => ({
    scroll: window.scrollY,
    extraHeight: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    plannerTop: document.querySelector('.planner')!.getBoundingClientRect().top,
    plannerBottom: document.querySelector('.planner')!.getBoundingClientRect().bottom - innerHeight
  })) ).toEqual({ scroll: 0, extraHeight: 0, plannerTop: 0, plannerBottom: 0 });
  await page.screenshot({ path: info.outputPath('planner-after-scroll.png') });
});
