import { expect, Page } from '@playwright/test';
import { DEFAULT_LAYOUT_RULES } from '../src/app/planner/geometry/placement-rules';

export const testHall = { id: 901, name: 'Rules test hall', shape: 'SQUARE', width: 50, length: 50, radius: 0,
  rules: { ...DEFAULT_LAYOUT_RULES } };
export const testStall = (id = 1, extra: Record<string, unknown> = {}) => ({
  id, hallId: 901, name: `Test ${id}`, stallNumber: `T-${id}`, posX: 0, posZ: 0,
  width: 4, length: 4, height: 3, color: '#3498db', gateSide: 'FRONT', openSides: ['FRONT'],
  status: 'AVAILABLE', stallTypeId: null, rotation: 0, ...extra
});

export async function dismissPlottingRules(page: Page) {
  await page.getByRole('dialog', { name: 'Before you plot' }).getByRole('button', { name: 'Got it, start planning' }).click();
  await expect(page.getByRole('dialog', { name: 'Before you plot' })).not.toBeVisible();
}

export async function setupPlanner(page: Page, stalls: unknown[] = [], hall: any = testHall, dismiss = true) {
  const writes: Array<{ url: string; body: any }> = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push({ url: path, body: route.request().postDataJSON() });
    const json = path === '/api/halls' ? [hall] : path === '/api/layout/123'
      ? { hall, layout: { id: 123, name: hall.name, eventType: 'B2B' }, stalls } : [];
    await route.fulfill({ json });
  });
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.goto('/planner');
  await page.waitForFunction(() => (window as any).ng?.getComponent(document.querySelector('app-planner-page'))?.store.hallsStatus() === 'ready');
  if (dismiss) await dismissPlottingRules(page);
  await page.evaluate(({ stalls, name }) => {
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    s.stalls.set(stalls); s.snap.set(false); s.selectedSavedId.set(123); s.layoutName.set(name);
    if (stalls.length) s.selectStall((stalls[stalls.length - 1] as any).id);
  }, { stalls, name: hall.name });
  await expect(page.locator('app-scene3d canvas')).toBeVisible();
  return writes;
}

export async function plannerState(page: Page) {
  return page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-planner-page')), s = c.store;
    return { stalls: s.currentStalls(), audit: s.audit(), rejection: s.rejection(), error: s.error(),
      rules: s.placementContext().rules, split: s.splitPreview(), stats: c.stats(), hall: s.currentHall(),
      proposals: s.proposals(), focus: s.focusTarget() };
  });
}

export async function editStall(page: Page, name: string, value: string) {
  const input = page.locator('app-edit-stall-form').getByRole('spinbutton', { name, exact: true });
  await input.fill(value); await input.press('Tab');
}

export async function seedStalls(page: Page, stalls: unknown[]) {
  await page.evaluate(stalls => {
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    s.stalls.set(stalls); s.selectStall(stalls.length ? (stalls.at(-1) as any).id : null);
  }, stalls);
}
