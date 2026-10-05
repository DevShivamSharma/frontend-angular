import { test, expect } from '@playwright/test';
import { plannerState, setupPlanner, testHall, testStall } from './planner-test-helpers';

test('meeting rules UI: passage accepts 1.5 m, rejects 1 m and keeps event settings independent', async ({ page }) => {
  await setupPlanner(page);
  const input = page.getByRole('spinbutton', { name: 'Passage width (m)' });
  await expect(input).toHaveAttribute('min', '1.5');
  await expect(input).toHaveAttribute('max', '5');
  await input.fill('1.5');
  await input.press('Tab');
  expect((await plannerState(page)).rules.minPassageWidth.B2B).toBe(1.5);
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('B2C');
  await expect(input).toHaveValue('3');
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('B2B');
  await expect(input).toHaveValue('1.5');
  await input.fill('1');
  await input.press('Tab');
  expect((await plannerState(page)).rules.minPassageWidth.B2B).toBe(1.5);
  expect((await plannerState(page)).error).toContain('between 1.5 and 5');
});

test('meeting rules UI: corner switch updates audit and survives save and reload', async ({ page }) => {
  const stalls = [testStall(1, { posX: -testHall.width / 2 + 4, posZ: -testHall.length / 2 + 4 })];
  await setupPlanner(page, stalls);
  await page.getByRole('tab', { name: /Rules/ }).click();
  const panel = page.locator('app-violations-panel[section="rules"]');
  const toggle = panel.getByRole('switch', { name: 'Hall corners', exact: true });
  await expect(toggle).toBeChecked();
  expect((await plannerState(page)).audit.flatMap((entry: any) => entry.violations.map((v: any) => v.code)))
    .toContain('CORNER_PASSAGE');
  await toggle.uncheck();
  expect((await plannerState(page)).audit).toEqual([]);
  let saved: any;
  await page.route('**/api/layout/123', async route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    await route.fulfill({ json: { hall: { ...saved.hall, id: 901 }, layout: { id: 123 }, stalls } });
  });
  await page.evaluate(async () => {
    const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    await store.updateLayout();
    store.setBasicRules({});
    await store.openLayout(123);
  });
  expect(saved.hall.rules).toMatchObject({ enabledRules: { cornerKeepOut: false }, maxUtilization: 0.7,
    eventSeparation: 3, emergencyExitClearance: 3 });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect((await plannerState(page)).audit.flatMap((entry: any) => entry.violations.map((v: any) => v.code)))
    .toContain('CORNER_PASSAGE');
});
