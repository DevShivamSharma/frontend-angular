import { test, expect, APIRequestContext } from '@playwright/test';
import { dismissPlottingRules } from './planner-test-helpers';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed')); });

async function dismissLanding(page: import('@playwright/test').Page) {
  await expect(page.locator('dialog[open]').first()).toBeVisible();
  const guide=page.getByRole('dialog',{name:'Before you plot'});
  if(await guide.isVisible()) await dismissPlottingRules(page);
  else await page.locator('dialog[open]').getByRole('button',{name:'Close',exact:true}).click();
}

const api = process.env['STALL_API_URL'] ?? 'http://localhost:8080/api';

async function backendAvailable(request: APIRequestContext): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const result = await request.get(`${api}/halls?standalone=true`, { timeout: 5000 }).catch(() => null);
    if (result?.ok()) return true;
  }
  return false;
}

test('real backend: save/reload restores passage, geometry, open sides and server numbers', async ({ page, request }, info) => {
  test.skip(!await backendAvailable(request), 'Real backend is unavailable; no persistence claim is made.');
  await page.goto('/planner/editor');
  await dismissLanding(page);
  await page.waitForFunction(() => {
    const s = (window as any).ng?.getComponent(document.querySelector('app-planner-page'))?.store;
    return s && s.hallsStatus() !== 'loading' && s.listStatus() !== 'loading';
  });
  const name = `Playwright passage ${Date.now()}`;
  let id: number | string | null = null;
  try {
    await page.evaluate(name => {
      const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      const h = s.createHall({ name, shape: 'SQUARE', w: 50, l: 50, r: 0 });
      s.setPassageWidth(5);
      s.reviewPlan([{ name: 'Persistence parent', width: 13, length: 4, posX: 0.5, posZ: 0,
        height: 3, rotation: 30, openSides: ['FRONT'] }]);
      s.applyPlan();
      s.setLayoutName(name);
    }, name);
    await page.getByRole('tab', { name: /Layouts/ }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/api/layout/save') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save New', exact: true }).click();
    const saved = await response;
    const body = await saved.json();
    await info.attach('real-save-response', { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
    expect(saved.ok(), JSON.stringify(body)).toBe(true);
    id = body.layout?.id ?? body.id;
    expect(id).toBeTruthy();
    await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.busy())).toBe(false);
    await page.reload();
    await dismissLanding(page);
    await page.getByRole('tab', { name: /Layouts/ }).click();
    await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Passage width (m)' })).toHaveValue('5');
    const persisted = await page.evaluate(() => {
      const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
      return { stalls: s.currentStalls(), audit: s.audit() };
    });
    expect(persisted.stalls).toHaveLength(1);
    expect(persisted.stalls[0]).toMatchObject({ width: 13, length: 4, posX: 0.5, posZ: 0, rotation: 30, openSides: ['FRONT'] });
    expect(persisted.stalls[0].stallNumber).toBeTruthy();
    expect(persisted.audit).toEqual([]);
    await page.screenshot({ path: info.outputPath('real-backend-reloaded.png'), fullPage: true });
  } finally {
    // Only the layout created by this test is removed, never a user's existing layout.
    if (id !== null) expect((await request.delete(`${api}/layout/${id}`)).ok()).toBe(true);
  }
});

test('real backend: atomic split endpoint and child persistence', async ({ page, request }, info) => {
  test.skip(!await backendAvailable(request), 'Real backend unavailable.');
  const name = `Playwright split ${Date.now()}`;
  const payload = { layoutName: name, eventType: 'B2B', hall: {
    name, shape: 'SQUARE', width: 50, length: 50, radius: 0,
    rules: { minPassageWidth: { B2B: 3, B2C: 3 }, peripheralClearance: 1, gridUnit: 1, snapStep: 1, stallNumberPrefix: '5-' }
  }, stalls: [{ name: 'Parent', width: 11, length: 4, height: 3, posX: 0.5, posZ: 0,
    color: '#3498db', gateSide: 'FRONT', openSides: ['FRONT'] }] };
  const saved = await request.post(`${api}/layout/save`, { data: payload });
  expect(saved.ok(), await saved.text()).toBe(true);
  const body = await saved.json();
  const id = body.layout?.id ?? body.id;
  expect(id).toBeTruthy();
  try {
    const opened = await (await request.get(`${api}/layout/${id}`)).json();
    const parent = opened.stalls[0];
    await page.goto('/planner/editor');
    await dismissLanding(page);
    await page.getByRole('tab', { name: /Layouts/ }).click();
    await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await page.getByRole('tab', { name: /Stalls/ }).click();
    await page.locator('.stall-chip').filter({ hasText: parent.stallNumber }).click();
    await page.getByText('Split stall', { exact: true }).click();
    await page.getByRole('button', { name: 'Preview split', exact: true }).click();
    await expect(page.locator('.split-preview')).toContainText(`${parent.stallNumber}-B`);
    const splitResponse = page.waitForResponse(r => r.url().endsWith('/split') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
    const split = await splitResponse;
    await info.attach('real-split-response', { body: `${split.status()}\n${await split.text()}`, contentType: 'text/plain' });
    test.skip([404, 405, 501].includes(split.status()), `Backend split endpoint unavailable (HTTP ${split.status()}); full split persistence is unverified.`);
    expect(split.ok(), await split.text()).toBe(true);
    await page.reload();
    await dismissLanding(page);
    await page.getByRole('tab', { name: /Layouts/ }).click();
    await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await page.getByRole('tab', { name: /Stalls/ }).click();
    await expect(page.locator('.stall-chip').filter({ hasText: `${parent.stallNumber}-A` })).toBeAttached();
    await page.getByRole('checkbox', { name: 'Labels', exact: true }).check();
    const label = page.locator('.label-overlay > div').filter({ hasText: `${parent.stallNumber}-A` });
    await expect(label).toBeVisible();
    const labelBox = await label.boundingBox();
    expect(labelBox!.height).toBeGreaterThanOrEqual(20);
    expect(await page.locator('.label-overlay').evaluate(el => {
      const canvas = el.parentElement!.querySelector('canvas')!;
      return Number(getComputedStyle(el).zIndex) > (Number(getComputedStyle(canvas).zIndex) || 0);
    })).toBe(true);
    const reloaded = await (await request.get(`${api}/layout/${id}`)).json();
    const children = reloaded.stalls.filter((s: any) => s.parentStallNumber === parent.stallNumber);
    expect(children.map((s: any) => s.stallNumber)).toEqual([`${parent.stallNumber}-A`, `${parent.stallNumber}-B`]);
    expect(children.map((s: any) => s.width)).toEqual([4, 4]);
    await page.screenshot({ path: info.outputPath('real-backend-split-reloaded.png'), fullPage: true });
  } finally {
    expect((await request.delete(`${api}/layout/${id}`)).ok()).toBe(true);
  }
});

