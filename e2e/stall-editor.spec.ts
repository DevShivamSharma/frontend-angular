import { test, expect, Page } from '@playwright/test';
import { DEFAULT_LAYOUT_RULES } from '../src/app/planner/geometry/placement-rules';
import { dismissPlottingRules } from './planner-test-helpers';

const hall = { id: 901, name: 'Passage test hall', shape: 'SQUARE', width: 50, length: 50, radius: 0,
  rules: { ...DEFAULT_LAYOUT_RULES } };
const stall = (id: number, posX: number, posZ: number, side = 'FRONT', extra = {}) => ({
  id, hallId: hall.id, name: `Test ${id}`, stallNumber: `T-${id}`, posX, posZ,
  width: 4, length: 4, height: 3, color: '#3498db', gateSide: side, openSides: [side],
  status: 'AVAILABLE', stallTypeId: null, ...extra
});

// Angular's development API is used only for fixture setup / state assertions, with no test
// hooks added to production. User actions below use rendered controls and real pointer events.
async function setup(page: Page, stalls: unknown[] = [], customHall = hall) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/api/halls' ? [customHall] : url.pathname === '/api/layout/123' ? { hall: customHall, layout: { id: 123, name: customHall.name, eventType: 'B2B' }, stalls } : [];
    await route.fulfill({ json: body });
  });
  await page.goto('/planner');
  await dismissPlottingRules(page);
  await page.waitForFunction(() => (window as any).ng?.getComponent(document.querySelector('app-planner-page'))?.store.hallsStatus() === 'ready');
  await page.evaluate(({ stalls }) => {
    const store = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    store.stalls.set(stalls);
    store.snap.set(false);
    store.selectedSavedId.set(123);
    if (stalls.length) store.selectStall((stalls[stalls.length - 1] as any).id);
  }, { stalls });
  await expect(page.locator('app-scene3d canvas')).toBeVisible();
}

async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    return { stalls: s.currentStalls(), error: s.error(), audit: s.audit(), rejection: s.rejection(),
      passage: s.passageWidth(), split: s.splitPreview(), savedId: s.selectedSavedId() };
  });
}

async function edit(page: Page, label: string, value: string) {
  const input = page.locator('app-edit-stall-form').getByRole('spinbutton', { name: label, exact: true });
  await input.fill(value);
  await input.press('Tab');
}

for (const width of [3, 5]) {
  test(`UI: ${width} m open-side passage accepts exact depth and rejects less`, async ({ page }) => {
    // T-2 stands in front of the open FRONT side of T-1.
    await setup(page, [stall(1, -22, -22), stall(2, -22, -10)]);
    const passage = page.getByRole('spinbutton', { name: 'Passage width (m)' });
    await passage.fill(String(width));
    await passage.press('Tab');
    await edit(page, 'Position Z (m)', String(-18 + width));
    expect((await state(page)).stalls[1].posZ).toBe(-18 + width);
    await edit(page, 'Position Z (m)', String(-18 + width - 0.1));
    expect((await state(page)).stalls[1].posZ).toBe(-18 + width);
    expect((await state(page)).rejection.violations.some((v: any) => v.code === 'OPEN_SIDE_BLOCKED')).toBe(true);
    await expect(page.locator('app-violations-panel[section=alerts]')).toContainText('Blocks the FRONT open side');
    // Closed sides may share a wall.
    await edit(page, 'Position Z (m)', '-22');
    await edit(page, 'Position X (m)', '-18');
    expect((await state(page)).stalls[1]).toMatchObject({ posX: -18, posZ: -22 });
  });
}

test('UI: irregular notch corner rejects a blocked open side and exterior frontage', async ({ page }, info) => {
  const boundary = [{ x: -25, z: -25 }, { x: 5, z: -25 }, { x: 5, z: -5 },
    { x: 25, z: -5 }, { x: 25, z: 25 }, { x: -25, z: 25 }];
  await setup(page, [stall(1, 2, -7, 'LEFT'), stall(2, -5, -7, 'LEFT')], { ...hall, boundary } as typeof hall);
  expect((await state(page)).audit).toEqual([]);
  await edit(page, 'Position X (m)', '-4.9');
  expect((await state(page)).stalls[1].posX).toBe(-5);
  expect((await state(page)).rejection.violations.some((v: any) => v.code === 'OPEN_SIDE_BLOCKED')).toBe(true);
  await page.locator('.stall-chip').filter({ hasText: 'T-1' }).click();
  await page.getByLabel('Face one direction').selectOption('RIGHT');
  expect((await state(page)).stalls[0].openSides).toEqual(['LEFT']);
  expect((await state(page)).rejection.violations.some((v: any) => v.code === 'OPEN_SIDE_BLOCKED')).toBe(true);
  await page.screenshot({ path: info.outputPath('irregular-corner-rejection.png'), fullPage: true });
});

test('UI: back-to-back touching, invalid open side, rotation and resize', async ({ page }, info) => {
  // T-3 and T-4 stand either side of T-2, so a quarter turn points its open side at one of them.
  await setup(page, [stall(1, 0, 0, 'BACK'), stall(3, 4, 7), stall(4, -4, 7), stall(2, 0, 7)]);
  await edit(page, 'Position Z (m)', '4');
  expect((await state(page)).stalls[3].posZ).toBe(4);
  expect((await state(page)).audit).toEqual([]);
  await page.getByLabel('Face one direction').selectOption('BACK');
  await expect(page.getByLabel('Face one direction')).toHaveValue('FRONT');
  expect((await state(page)).stalls[3].openSides).toEqual(['FRONT']);
  await expect(page.locator('app-violations-panel[section=alerts]')).toContainText('BACK open side needs 3 m of clear passage');
  await page.getByRole('button', { name: 'Rotate T-2', exact: true }).click();
  expect((await state(page)).stalls[3].openSides).toEqual(['FRONT']);
  expect((await state(page)).rejection.title).toBe('Rotation rejected');
  await edit(page, 'Rotation (°)', '45');
  expect((await state(page)).stalls[3].rotation ?? 0).toBe(0);
  await edit(page, 'Length (m)', '6');
  expect((await state(page)).stalls[3].length).toBe(4);
  expect((await state(page)).rejection.violations.some((v: any) => v.code === 'STALL_OVERLAP')).toBe(true);
  await page.screenshot({ path: info.outputPath('invalid-resize-desktop.png'), fullPage: true });
});

test('UI: real canvas drag shows a live violation and rolls back invalid drop', async ({ page }) => {
  await setup(page, [stall(1, 0, 0), stall(2, 10, 0)]);
  // Project actual world positions through the running scene's camera; no pixel guessing.
  await page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    c.camera.position.set(0, 65, 0.001); c.controls.target.set(0, 0, 0); c.controls.update();
  });
  const points = await page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    const r = c.renderer.domElement.getBoundingClientRect();
    // Dropped at x = 3 the stall would overlap T-1 (closed sides may touch, never overlap).
    return [10, 3].map(x => {
      const p = c.camera.position.clone().set(x, 0.15, 0).project(c.camera);
      return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
    });
  });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
  await expect.poll(async () => (await state(page)).audit.length).toBeGreaterThan(0);
  await page.mouse.up();
  expect((await state(page)).stalls[1].posX).toBe(10);
  expect((await state(page)).rejection.title).toBe('Move rejected');
});

test('UI: draw orientation, invalid setting, changed setting audits existing layout', async ({ page }) => {
  // T-2 stands 3 m in front of T-1's open side: enough for 3 m, not for 5 m.
  await setup(page, [stall(1, 0, 0), stall(2, 0, 7)]);
  await page.getByRole('button', { name: 'Draw stall', exact: true }).click();
  await page.locator('app-editor-toolbar').getByLabel('Open side').selectOption('LEFT');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.draftOpenSide())).toBe('LEFT');
  const passage = page.getByRole('spinbutton', { name: 'Passage width (m)' });
  await passage.fill('2'); await passage.press('Tab');
  await expect(passage).toHaveValue('3');
  await passage.fill('5'); await passage.press('Tab');
  expect((await state(page)).audit.length).toBeGreaterThan(0);
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  expect((await state(page)).rejection.title).toBe('Save rejected');
});

test('UI: auto-layout checks passage between proposals and revalidates before applying', async ({ page }) => {
  await setup(page);
  const reviewed = await page.evaluate(() => {
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    const plan = [{ posX: 0, posZ: 0, width: 4, length: 4, openSides: ['BACK'] },
      { posX: 0, posZ: 4, width: 4, length: 4, openSides: ['FRONT'] },
      { posX: 0, posZ: 9, width: 4, length: 4, openSides: ['FRONT'] }];
    const result = s.reviewPlan(plan).map((p: any) => p.valid);
    s.applyPlan();
    return result;
  });
  expect(reviewed).toEqual([true, true, false]);
  expect((await state(page)).stalls).toHaveLength(2);
});

test('UI: split preview labels, server identifiers, relationship and mocked reload', async ({ page }, info) => {
  await setup(page, [stall(9, 0, 0, 'FRONT', { stallNumber: '5-10', width: 11 })]);
  await page.getByText('Split stall', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await expect(page.locator('.split-preview')).toContainText('5-10-A');
  await expect(page.locator('.split-preview')).toContainText('5-10-B');
  expect((await state(page)).stalls).toHaveLength(1);
  const preview = (await state(page)).split;
  const children = preview.children.map((s: any, i: number) => ({ ...s, id: 40 + i }));
  await page.screenshot({ path: info.outputPath('split-preview-desktop.png'), fullPage: true });
  await page.route('**/api/layout/123/stalls/5-10/split', async route => {
    const body = route.request().postDataJSON();
    expect(body.children).toHaveLength(2);
    expect(body.children[0].width).toBe(4);
    expect(body.idempotencyKey).toBeTruthy();
    await route.fulfill({ json: { layout: { id: 123 }, stalls: children } });
  });
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await expect.poll(async () => (await state(page)).stalls.length).toBe(2);
  await expect(page.locator('.stall-chip').filter({ hasText: '5-10-A' })).toBeVisible();
  await page.route('**/api/layout/123', route => route.fulfill({ json: {
    hall, layout: { id: 123, name: 'Split saved', eventType: 'B2B' }, stalls: children
  } }));
  await page.evaluate(async () => (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.openLayout(123));
  expect((await state(page)).stalls.map((s: any) => s.stallNumber)).toEqual(['5-10-A', '5-10-B']);
  expect((await state(page)).stalls[0].parentStallNumber).toBe('5-10');
});

test('UI: unavailable split endpoint and structured rejection keep parent intact', async ({ page }) => {
  await setup(page, [stall(9, 0, 0, 'FRONT', { stallNumber: '5-10', width: 11 })]);
  await page.getByText('Split stall', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await page.route('**/api/layout/123/stalls/5-10/split', route => route.fulfill({ status: 404, json: { message: 'Not found' } }));
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await expect.poll(async () => (await state(page)).error).toContain('not available on this backend');
  expect((await state(page)).stalls[0].stallNumber).toBe('5-10');
  await page.route('**/api/layout/123/stalls/5-10/split', route => route.fulfill({ status: 400, json: { message: 'Passage rejected',
    violations: [{ code: 'CORNER_PASSAGE', ruleRef: 'Passage', message: 'Server requires 5 m here',
      stallIndex: 0, stallNumber: '5-10', geometry: [], relatedStallIds: [] }] } }));
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await expect(page.locator('app-violations-panel[section=alerts]')).toContainText('Server requires 5 m here');
  expect((await state(page)).stalls).toHaveLength(1);
  await page.route('**/api/layout/123/stalls/5-10/split', route => route.fulfill({ status: 409, json: {
    message: 'Conflict', violations: [{ code: 'SPLIT_PARENT_CONFLICT', stallNumber: '5-10' }]
  } }));
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await expect(page.locator('app-violations-panel[section=alerts]')).toContainText('SPLIT_PARENT_CONFLICT');
});

test('UI: an edit while split preflight is pending prevents the server write', async ({ page }) => {
  const parent = stall(9, 0, 0, 'FRONT', { stallNumber: '5-10', width: 11 });
  await setup(page, [parent]);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route('**/api/layout/123', async route => {
    await hold;
    await route.fulfill({ json: { hall, layout: { id: 123, name: hall.name, eventType: 'B2B' }, stalls: [parent] } });
  });
  await page.route('**/api/layout/123/stalls/5-10/split', async route => { writes++; await route.fulfill({ json: {} }); });
  await page.getByText('Split stall', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  const preflight = page.waitForRequest('**/api/layout/123');
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await preflight;
  try { await edit(page, 'Position Z (m)', '1'); } finally { release(); }
  await expect.poll(async () => (await state(page)).error).toContain('editor changed');
  expect(writes).toBe(0);
  expect((await state(page)).stalls[0].posZ).toBe(1);
});

test('UI: split refuses unsaved geometry instead of replacing local changes', async ({ page }) => {
  await setup(page, [stall(9, 0, 0, 'FRONT', { stallNumber: '5-10', width: 11 })]);
  await edit(page, 'Position Z (m)', '1');
  await page.getByText('Split stall', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm split', exact: true }).click();
  await expect.poll(async () => (await state(page)).error).toContain('Update the saved layout before splitting');
  expect((await state(page)).stalls[0].posZ).toBe(1);
});

test('UI: mobile split controls stay reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [stall(9, 0, 0, 'FRONT', { stallNumber: '5-10', width: 11 })]);
  await page.getByText('Split stall', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await expect(page.locator('.split-preview')).toContainText('5-10-B');
  await page.getByRole('button', { name: 'Confirm split', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('split-preview-mobile.png'), fullPage: true });
});


