import { test, expect, Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { DEFAULT_LAYOUT_RULES, validatePlacement, ZoneKind } from '../src/app/planner/geometry/placement-rules';
import { previewSplit } from '../src/app/planner/geometry/stall-split';
import { placementContextFor } from '../src/app/planner/geometry/hall-rules';
import { dismissPlottingRules, editStall, plannerState, seedStalls, setupPlanner, testHall, testStall } from './planner-test-helpers';

const guide = (page: Page) => page.getByRole('dialog', { name: 'Before you plot' });
const rect = (x: number, z: number, w: number, l: number) => [
  { x, z }, { x: x + w, z }, { x: x + w, z: z + l }, { x, z: z + l }
];
const ruleIds = ['floor-grid', 'passage-openings', 'walls-zones', 'touching-corners', 'editing', 'save-audit',
  'settings-geometry', 'status-split', 'assist-import', 'helpers-limits'];

test('guide: auto-opens, exposes every rule topic, traps focus and changes the sidebar icon', async ({ page }, info) => {
  test.setTimeout(90_000); // Forward/backward focus cycles include many real browser input round-trips.
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await setupPlanner(page, [], testHall, false);
  await expect(guide(page)).toBeVisible();
  expect(await guide(page).evaluate(el => el.matches(':modal'))).toBe(true);
  expect(await guide(page).locator('[data-rule]').evaluateAll(els => els.map(el => el.getAttribute('data-rule')))).toEqual(ruleIds);
  await expect(guide(page).locator('.hall-settings')).toContainText('3 m passage');
  await expect(guide(page).locator('.hall-settings')).toContainText('1 m wall clearance');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await guide(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await guide(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  // The actual user pointer cannot activate background Add while the modal is open.
  const add = await page.locator('app-add-stall-form .btn-success').boundingBox();
  await page.mouse.click(add!.x + 8, add!.y + 8);
  expect((await plannerState(page)).stalls).toEqual([]);
  await guide(page).locator('.rules-body').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: info.outputPath('rules-desktop.png') });
  await dismissPlottingRules(page);
  await expect(page.getByRole('tab', { name: /^Stalls/ })).toBeFocused();
  await expect(page.locator('.brand-mark app-icon')).toHaveAttribute('name', 'floor-plan');
  await expect(page.locator('.brand-mark svg path').first()).toHaveAttribute('d', 'M3 3h18v18H3z');
  await expect(page.getByRole('link', { name: 'Back to venue overview' })).toHaveAttribute('href', '/');
  expect(errors).toEqual([]);
});

test('guide: reopen, Escape and close restore focus; reload shows it again', async ({ page }) => {
  await setupPlanner(page);
  await page.getByRole('button', { name: 'Draw stall', exact: true }).click();
  await page.getByRole('tab', { name: /Rules/ }).click();
  const reopen = page.getByRole('button', { name: 'Read plotting rules' });
  await reopen.click(); await page.keyboard.press('Escape');
  await expect(guide(page)).not.toBeVisible(); await expect(reopen).toBeFocused();
  await expect(page.getByRole('button', { name: 'Draw stall', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await reopen.click(); await guide(page).getByRole('button', { name: 'Close plotting rules' }).click();
  await expect(reopen).toBeFocused();
  await page.reload(); await expect(guide(page)).toBeVisible();
});

test('guide: settings come from the current hall/event and never silently reopen during editing', async ({ page }) => {
  const hall = { ...testHall, rules: { ...DEFAULT_LAYOUT_RULES, peripheralClearance: 2, snapStep: 0.5,
    minPassageWidth: { B2B: 4, B2C: 5 } } };
  await setupPlanner(page, [], hall, false);
  await expect(guide(page).locator('.hall-settings')).toContainText('4 m passage');
  await expect(guide(page).locator('.hall-settings')).toContainText('2 m wall clearance');
  await expect(guide(page).locator('.hall-settings')).toContainText('0.5 m size step');
  await dismissPlottingRules(page);
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('B2C');
  await expect(guide(page)).not.toBeVisible();
  await page.getByRole('tab', { name: /Rules/ }).click();
  await page.getByRole('button', { name: 'Read plotting rules' }).click();
  await expect(guide(page).locator('.hall-settings')).toContainText('B2C');
  await expect(guide(page).locator('.hall-settings')).toContainText('5 m passage');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`guide: readable and dismissible at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await setupPlanner(page, [], testHall, false);
    const box = await guide(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const summary of await guide(page).locator('summary').all()) await summary.click();
    await expect(guide(page).getByText(/They do not validate ceiling height/)).toBeVisible();
    await guide(page).locator('.rules-body').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: info.outputPath(`rules-${viewport.width}x${viewport.height}.png`) });
    await dismissPlottingRules(page);
    await page.getByRole('button', { name: /Add Shop \(then/ }).click();
    expect((await plannerState(page)).stalls).toHaveLength(1);
  });
}

test('floor-grid / editing: invalid dimensions rejected, snap aligns edges, duplicate has a fresh valid location', async ({ page }) => {
  await setupPlanner(page, [testStall(1, { width: 3, length: 5 })]);
  for (const width of ['0', '-1', '2.5']) {
    await editStall(page, 'Width (m)', width);
    expect((await plannerState(page)).stalls[0].width).toBe(3);
    expect((await plannerState(page)).rejection.violations[0].code).toBe('INVALID_DIMENSIONS');
  }
  await page.getByRole('checkbox', { name: 'Snap to grid' }).check();
  await editStall(page, 'Position X (m)', '0.2');
  expect((await plannerState(page)).stalls[0].posX).toBe(0.5);
  await page.getByRole('button', { name: 'Rotate T-1', exact: true }).click();
  expect((await plannerState(page)).stalls[0]).toMatchObject({ width: 5, length: 3, openSides: ['RIGHT'] });
  await page.getByRole('button', { name: 'Duplicate T-1', exact: true }).click();
  const s = await plannerState(page);
  expect(s.stalls).toHaveLength(2); expect(s.stalls[1].stallNumber).toBeNull();
  expect(s.stalls[1].status).toBe('AVAILABLE'); expect(s.audit).toEqual([]);
  expect([s.stalls[1].posX, s.stalls[1].posZ]).not.toEqual([s.stalls[0].posX, s.stalls[0].posZ]);
});

for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) {
  test(`passage-openings: ${side} full frontage accepts exact depth and rejects exterior access`, async ({ page }) => {
    const axis = side === 'LEFT' || side === 'RIGHT' ? 'X' : 'Z';
    const sign = side === 'BACK' || side === 'LEFT' ? -1 : 1;
    await setupPlanner(page, [testStall(1, { openSides: [side], gateSide: side })]);
    await editStall(page, `Position ${axis} (m)`, String(sign * 20));
    expect((await plannerState(page)).audit).toEqual([]);
    await editStall(page, `Position ${axis} (m)`, String(sign * 20.01));
    expect((await plannerState(page)).stalls[0][axis === 'X' ? 'posX' : 'posZ']).toBe(sign * 20);
    expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain('OPEN_SIDE_BLOCKED');
    // Clicking the only open side must keep it open.
    await page.locator('app-edit-stall-form .btn-gate.is-selected').click();
    expect((await plannerState(page)).stalls[0].openSides).toEqual([side]);
  });
}

test('walls-zones: exact peripheral clearance allowed; closer wall and outside hall rejected', async ({ page }) => {
  await setupPlanner(page, [testStall()]);
  await editStall(page, 'Position X (m)', '22');
  expect((await plannerState(page)).audit).toEqual([]);
  await editStall(page, 'Position X (m)', '22.1');
  expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain('PERIPHERAL_CLEARANCE');
  await editStall(page, 'Position X (m)', '26');
  expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain('OUTSIDE_HALL');
  expect((await plannerState(page)).stalls[0].posX).toBe(22);
});

for (const kind of ['PASSAGE', 'NO_CONSTRUCTION', 'EMERGENCY_EXIT_ACCESS', 'ENTRY_EXIT_ACCESS', 'FACILITY_ACCESS', 'FOYER', 'PARTITION', 'SMOKE_CURTAIN'] as ZoneKind[]) {
  test(`walls-zones: ${kind} blocks placement even when hidden`, async ({ page }) => {
    await setupPlanner(page, [testStall()], { ...testHall, zones: [{ id: 'restricted', label: 'Test restriction', kind,
      polygon: rect(7, -3, 4, 6), hidden: true }] });
    expect((await plannerState(page)).audit).toEqual([]);
    await editStall(page, 'Position X (m)', '9');
    expect((await plannerState(page)).stalls[0].posX).toBe(0);
    expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain('RESTRICTED_ZONE');
  });
}

for (const kind of ['ENTRY', 'EXIT', 'SERVICE', 'EMERGENCY']) {
  test(`walls-zones: ${kind} doorway access rejects blocking stall`, async ({ page }) => {
    await setupPlanner(page, [testStall()], { ...testHall, openings: [{ id: 'door', label: 'Test doorway', kind,
      position: { x: 8, z: 0 }, width: 8, facing: 'EAST' }] });
    await editStall(page, 'Position X (m)', '9');
    expect((await plannerState(page)).stalls[0].posX).toBe(0);
    expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain(kind === 'EMERGENCY' ? 'EMERGENCY_ACCESS' : 'ENTRY_EXIT_BLOCKED');
  });
}

test('settings-geometry: event settings are independent; invalid saved values block persistence', async ({ page }) => {
  const writes = await setupPlanner(page, [], { ...testHall, rules: { ...DEFAULT_LAYOUT_RULES, minPassageWidth: { B2B: 6, B2C: 4 } } });
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  expect((await plannerState(page)).error).toContain('between 3 and 5'); expect(writes).toEqual([]);
  const input = page.getByRole('spinbutton', { name: 'Passage width (m)' });
  await input.fill('3.5'); await input.press('Tab');
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('B2C');
  await expect(input).toHaveValue('4');
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('B2B');
  await expect(input).toHaveValue('3.5');
});

test('status-split / helpers-limits: booked occupancy, cancelled area, permanent numbers and local removal', async ({ page }) => {
  await setupPlanner(page, [testStall(1, { status: 'BOOKED' }), testStall(2, { posX: 10 })]);
  await editStall(page, 'Position X (m)', '0');
  expect((await plannerState(page)).rejection.violations.map((v: any) => v.code)).toContain('STALL_OVERLAP');
  await page.getByRole('button', { name: 'Cancel T-1', exact: true }).click();
  expect((await plannerState(page)).stalls[0]).toMatchObject({ status: 'CANCELLED', stallNumber: 'T-1' });
  await editStall(page, 'Position X (m)', '0');
  const s = await plannerState(page); expect(s.audit).toEqual([]);
  expect(s.stats).toMatchObject({ shops: 2, area: 16, occupancy: 1 });
  await page.getByRole('button', { name: 'Duplicate T-2', exact: true }).click();
  await page.locator('app-edit-stall-form').getByRole('button', { name: 'Remove Shop', exact: true }).click();
  expect((await plannerState(page)).stalls).toHaveLength(2);
});

test('status-split: unavailable/booked parents, invalid equal sizes and back-to-back count rejected', async ({ page }) => {
  await setupPlanner(page, [testStall(1, { status: 'BOOKED', width: 11 })]);
  await page.getByText('Split stall', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview split', exact: true })).toBeDisabled();
  await seedStalls(page, [testStall(1, { stallNumber: null, width: 11 })]);
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm split', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Children', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await expect(page.locator('.split-preview')).toContainText('equal children');
  await page.getByLabel('Arrangement', { exact: true }).selectOption('BACK_TO_BACK');
  await page.getByRole('button', { name: 'Preview split', exact: true }).click();
  await expect(page.locator('.split-preview')).toContainText('exactly two');
});

test('save-audit: frontend-valid save still surfaces a server rejection without losing edits', async ({ page }) => {
  await setupPlanner(page, [testStall()]);
  await page.route('**/api/layout/save', route => route.fulfill({ status: 400, json: { message: 'Rejected',
    violations: [{ code: 'PATHWAY_WIDTH', ruleRef: 'Passage', message: 'Server requires a wider passage', stallIndex: 0, stallNumber: 'T-1', geometry: [] }] } }));
  await page.getByRole('tab', { name: /Layouts/ }).click();
  await page.getByRole('button', { name: 'Save New', exact: true }).click();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.locator('app-violations-panel[section=alerts]')).toContainText('Server requires a wider passage');
  expect((await plannerState(page)).stalls).toHaveLength(1);
  await page.getByRole('tab', { name: /Rules/ }).click();
  await page.route('**/api/layout/123/validate', route => route.fulfill({ json: { ruleDriven: true, entries: [] } }));
  await page.getByRole('button', { name: 'Check saved layout on server' }).click();
  await expect(page.locator('app-violations-panel[section=rules]')).toContainText('Server audit: 0 stalls');
});

test('assist-import: real chat previews, rechecks changed fits and only applies valid proposals', async ({ page }) => {
  await setupPlanner(page);
  await page.route('**/api/layout/assist', route => route.fulfill({ json: { action: 'place', summary: 'Two positions', stalls: [
    { width: 4, length: 4, posX: 0, posZ: 0, openSides: ['FRONT'] },
    { width: 4, length: 4, posX: 10, posZ: 0, openSides: ['FRONT'] }
  ] } }));
  await page.getByRole('tab', { name: /Assist/ }).click();
  const chat = page.locator('app-assist-panel');
  await chat.getByRole('textbox', { name: 'Layout request' }).fill('Place two 4x4 stalls');
  await chat.getByRole('button', { name: 'Send layout request' }).click();
  await expect(chat).toContainText('2 of 2 stalls fit'); expect((await plannerState(page)).stalls).toEqual([]);
  await seedStalls(page, [testStall()]);
  await page.getByRole('tab', { name: /Assist/ }).click();
  await chat.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chat).toContainText('1 stalls still fit'); expect((await plannerState(page)).stalls).toHaveLength(1);
  await chat.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await plannerState(page)).stalls).toHaveLength(2); expect((await plannerState(page)).audit).toEqual([]);
});

test('assist-import: changed layout expires AI removals and changed hall expires pending placements', async ({ page }) => {
  await setupPlanner(page, [testStall()]);
  await page.route('**/api/layout/assist', route => route.fulfill({ json: { action: 'clear', stalls: [], summary: 'Remove Test 1', removals: [{ id: 1, name: 'Test 1' }] } }));
  await page.getByRole('tab', { name: /Assist/ }).click(); const chat = page.locator('app-assist-panel');
  await chat.getByRole('textbox', { name: 'Layout request' }).fill('Remove this stall');
  await chat.getByRole('button', { name: 'Send layout request' }).click();
  await expect(chat.getByRole('button', { name: 'Apply removals' })).toBeVisible();
  await seedStalls(page, [testStall(1, { posX: 1 })]);
  await page.getByRole('tab', { name: /Assist/ }).click();
  await chat.getByRole('button', { name: 'Apply removals' }).click();
  await expect(chat).toContainText('Proposal expired'); expect((await plannerState(page)).stalls[0].status).toBe('AVAILABLE');
  await chat.getByRole('textbox', { name: 'Layout request' }).fill('Remove this stall');
  await chat.getByRole('button', { name: 'Send layout request' }).click();
  await expect(chat.getByRole('button', { name: 'Apply removals' })).toBeVisible();
  await page.getByRole('tab', { name: /^Hall/ }).click();
  await page.getByRole('button', { name: 'Generate Hall' }).click();
  await page.getByRole('tab', { name: /Assist/ }).click();
  await expect(chat.getByRole('button', { name: 'Apply removals' })).toHaveCount(0);
});

test('assist-import: Excel keeps overlaps for audit, drops outside rows and blocks save', async ({ page }) => {
  const writes = await setupPlanner(page);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Name: 'Imported', Shape: 'SQUARE', 'Hall Width': 50, 'Hall Length': 50 }]), 'Hall');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([
    { Name: 'Overlap A', Width: 4, Length: 4, X: 0, Z: 0 },
    { Name: 'Overlap B', Width: 4, Length: 4, X: 0, Z: 0 },
    { Name: 'Outside', Width: 4, Length: 4, X: 99, Z: 0 }
  ]), 'Stalls');
  await page.locator('app-working-hall-panel input[type=file]').setInputFiles({ name: 'rules.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await expect.poll(async () => (await plannerState(page)).stalls.length).toBe(2);
  expect((await plannerState(page)).audit.flatMap((a: any) => a.violations.map((v: any) => v.code))).toContain('STALL_OVERLAP');
  await page.getByRole('tab', { name: /Layouts/ }).click(); await page.getByRole('button', { name: 'Save New', exact: true }).click();
  expect((await plannerState(page)).rejection.title).toBe('Save rejected'); expect(writes).toEqual([]);
});

test('assist-import: SelfCare source restrictions stay hidden and active; local master save is blocked', async ({ page }) => {
  const writes = await setupPlanner(page);
  await page.getByRole('tab', { name: /^Hall/ }).click();
  const payload = { name: 'Imported custom hall', length: 50, breadth: 50, layout_data: { nonClickableAreas: [
    { x: 20, y: 20, width: 10, height: 10, fillColor: '#ff0000', visibleInView: false }
  ] }, legends: [{ label: 'Compulsory passage', colorCode: '#ff0000' }] };
  await page.locator('app-selfcare-import input[type=file]').setInputFiles({ name: 'hall.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await expect.poll(async () => (await plannerState(page)).hall.name).toBe('Imported custom hall');
  const h = (await plannerState(page)).hall;
  expect(h.zones).toHaveLength(1); expect(h.zones[0]).toMatchObject({ hidden: true, kind: 'PASSAGE' });
  await seedStalls(page, [testStall(1, { hallId: h.id })]);
  expect((await plannerState(page)).audit[0].violations.map((v: any) => v.code)).toContain('RESTRICTED_ZONE');
  await page.getByRole('tab', { name: /^Hall/ }).click();
  await page.getByRole('button', { name: 'Save hall plan to server' }).click();
  expect((await plannerState(page)).error).toContain('Only a hall that exists on the server'); expect(writes).toEqual([]);
});

test('helpers-limits: hiding clearances does not disable validation; Locate and suggestion repair a rejected move', async ({ page }) => {
  await setupPlanner(page, [testStall(1), testStall(2, { posX: 10 })]);
  await page.getByRole('checkbox', { name: 'Clearances', exact: true }).uncheck();
  await editStall(page, 'Position X (m)', '1');
  expect((await plannerState(page)).stalls[1].posX).toBe(10);
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await page.getByRole('button', { name: 'Locate STALL_OVERLAP' }).click();
  expect((await plannerState(page)).focus).toBeTruthy();
  const suggestion = (await plannerState(page)).rejection.suggestion; expect(suggestion).toBeTruthy();
  await page.getByRole('button', { name: /^Place at X/ }).click();
  expect((await plannerState(page)).stalls[1]).toMatchObject({ posX: suggestion.posX, posZ: suggestion.posZ });
  expect((await plannerState(page)).audit).toEqual([]);
});

test('offline: fallback guide and placement work; unsaved layout is lost on page reload', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/planner'); await dismissPlottingRules(page);
  await expect(page.locator('.is-offline')).toBeVisible();
  await page.getByRole('button', { name: /Add Shop \(then/ }).click();
  expect((await plannerState(page)).stalls).toHaveLength(1); expect((await plannerState(page)).audit).toEqual([]);
  await page.reload(); await dismissPlottingRules(page); expect((await plannerState(page)).stalls).toEqual([]);
});

test('editing: actual canvas drawing accepts a valid footprint and rejects a second overlapping draw', async ({ page }) => {
  await setupPlanner(page);
  await page.getByRole('button', { name: 'Draw stall', exact: true }).click();
  const points = await page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    c.camera.position.set(0, 65, 0.001); c.controls.target.set(0, 0, 0); c.controls.update();
    // Projection must use the new camera transform, not the matrix from the last rendered frame.
    c.camera.updateMatrixWorld(true);
    const r = c.renderer.domElement.getBoundingClientRect();
    return [[-6, -6], [-2, -2]].map(([x, z]) => {
      const p = c.camera.position.clone().set(x, 0, z).project(c.camera);
      return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
    });
  });
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await plannerState(page)).stalls.length).toBe(1);
  }
  const state = await plannerState(page);
  expect(state.audit).toEqual([]);
  expect(state.rejection.title).toBe('Placement rejected');
  expect(state.rejection.violations.map((v: any) => v.code)).toContain('STALL_OVERLAP');
});

test('helpers-limits: free-space fit count represents alternatives, not simultaneous capacity', async ({ page }) => {
  await setupPlanner(page, [], { ...testHall, width: 12, length: 12 });
  await page.getByRole('checkbox', { name: /^Free space for/ }).check();
  const spots = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.freeSpace());
  expect(spots.length).toBeGreaterThan(12 * 12 / 6);
  expect((await plannerState(page)).stalls).toEqual([]);
});

// Pure geometry cases run under Playwright too, and are labelled separately from browser checks.
test('geometry supplement: positive step multiples, zone override and physical versus walkable frontage', () => {
  const ctx = placementContextFor(testHall as any, [], 'B2B');
  const candidate = { posX: 0, posZ: 0, width: 4, length: 4, openSides: ['FRONT'] as any };
  for (const width of [0, -1, 2.5, NaN, Infinity]) expect(validatePlacement({ ...candidate, width }, ctx).valid).toBe(false);
  ctx.zones = [{ id: 'facility', kind: 'FACILITY_ACCESS', label: 'Facility', polygon: rect(4, -2, 2, 4), clearance: 2 }];
  expect(validatePlacement(candidate, ctx).valid).toBe(true);
  expect(validatePlacement({ ...candidate, posX: 0.01 }, ctx).violations.map(v => v.code)).toContain('RESTRICTED_ZONE');
  for (const kind of ['PASSAGE', 'ENTRY_EXIT_ACCESS', 'NO_CONSTRUCTION', 'PARTITION', 'SMOKE_CURTAIN', 'FACILITY_ACCESS'] as ZoneKind[]) {
    ctx.zones = [{ id: kind, kind, label: kind, polygon: rect(-2, 3, 4, 1), clearance: 0 }];
    expect(validatePlacement(candidate, ctx).valid).toBe(['PASSAGE', 'ENTRY_EXIT_ACCESS'].includes(kind));
  }
});

test('geometry supplement: split limits, statuses, two-child back-to-back, rotated children and blocked corner frontage', () => {
  const ctx = placementContextFor(testHall as any, [], 'B2B');
  const parent = testStall(1, { width: 11 }) as any;
  for (const count of [1, 101, 2.5]) expect(previewSplit(parent, { count, axis: 'X', arrangement: 'PASSAGE' }, ctx).error).toBeTruthy();
  for (const status of ['BOOKED', 'CANCELLED']) expect(previewSplit({ ...parent, status }, { count: 2, axis: 'X', arrangement: 'PASSAGE' }, ctx).error).toBeTruthy();
  const pair = previewSplit({ ...parent, width: 8 }, { count: 2, axis: 'X', arrangement: 'BACK_TO_BACK' }, ctx);
  expect(pair.error).toBeNull(); expect(pair.violations).toEqual([]); expect(pair.children.map(s => s.openSides)).toEqual([['LEFT'], ['RIGHT']]);
  const rotated = previewSplit({ ...parent, rotation: 90 }, { count: 2, axis: 'X', arrangement: 'PASSAGE' }, ctx);
  expect(rotated.violations).toEqual([]); expect(rotated.children[0].posX).toBeCloseTo(0);
  expect(Math.abs(rotated.children[0].posZ - rotated.children[1].posZ)).toBeCloseTo(7);
  const corner = previewSplit({ ...parent, width: 8, posX: -20, posZ: -22 }, { count: 2, axis: 'X', arrangement: 'BACK_TO_BACK' }, ctx);
  // At the corner the LEFT child's open side has no 3 m of floor in front of it.
  expect(corner.violations.map(v => v.code)).toContain('OPEN_SIDE_BLOCKED');
});
