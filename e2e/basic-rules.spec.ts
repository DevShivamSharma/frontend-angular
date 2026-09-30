import { test, expect } from '@playwright/test';
import { BASIC_RULE_IDS, BasicRuleId, BasicRuleSettings } from '../src/app/planner/geometry/basic-rules';
import { DEFAULT_LAYOUT_RULES, Footprint, PlacementContext, validatePlacement, ZONE_KINDS } from '../src/app/planner/geometry/placement-rules';
import { FreeSpaceMap } from '../src/app/planner/geometry/free-space';
import { GridSystem } from '../src/app/planner/geometry/grid-system';
import { plannerState, setupPlanner, testHall, testStall } from './planner-test-helpers';

const rect = (x: number, z: number, w: number, l: number) => [
  { x, z }, { x: x + w, z }, { x: x + w, z: z + l }, { x, z: z + l }
];
const candidate: Footprint = { posX: 0, posZ: 0, width: 2, length: 2, openSides: ['FRONT'] };
const context = (enabledRules: BasicRuleSettings = {}, extra: Partial<PlacementContext> = {}): PlacementContext => ({
  boundary: rect(-10, -10, 20, 20), zones: [], openings: [], stalls: [], eventType: 'B2B',
  rules: { ...DEFAULT_LAYOUT_RULES, enabledRules }, enforceGrid: true, ...extra
});
const codes = (f: Footprint, c: PlacementContext) => validatePlacement(f, c).violations.map(v => v.code);

test('each basic placement check can be disabled independently, including rotated and custom stalls', () => {
  for (const rotation of [0, 90]) {
    const f = { ...candidate, rotation };
    const cases: Array<[BasicRuleId, Footprint, Partial<PlacementContext>, string]> = [
      ['hallBoundary', { ...f, posX: 15 }, {}, 'OUTSIDE_HALL'],
      ['peripheralClearance', { ...f, posX: 8.5 }, {}, 'PERIPHERAL_CLEARANCE'],
      ['stallOverlap', f, { stalls: [{ ...f, id: 'other' }] }, 'STALL_OVERLAP'],
      ['sizeStep', { ...f, width: 2.3 }, {}, 'INVALID_DIMENSIONS'],
      ['openSideAccess', f, { stalls: [{ ...f, id: 'other', posZ: rotation ? 0 : 3, posX: rotation ? -3 : 0 }] }, 'OPEN_SIDE_BLOCKED']
    ];
    for (const [rule, stall, extra, code] of cases) {
      expect(codes(stall, context({}, extra)), `${rule} on, rotation ${rotation}`).toContain(code);
      expect(codes(stall, context({ [rule]: false }, extra)), `${rule} off`).not.toContain(code);
    }
    for (const kind of ZONE_KINDS) {
      const extra = { zones: [{ id: kind, kind, label: kind, polygon: rect(-2, -2, 4, 4) }] };
      expect(codes(f, context({}, extra))).toContain('RESTRICTED_ZONE');
      expect(codes(f, context({ [kind]: false }, extra))).not.toContain('RESTRICTED_ZONE');
    }
    for (const kind of ['ENTRY', 'EMERGENCY'] as const) {
      const extra = { openings: [{ id: kind, kind, label: kind, position: { x: 0, z: -2 }, width: 4, facing: 'SOUTH' as const }] };
      const code = kind === 'EMERGENCY' ? 'EMERGENCY_ACCESS' : 'ENTRY_EXIT_BLOCKED';
      const key = kind === 'EMERGENCY' ? 'EMERGENCY_EXIT_ACCESS' : 'ENTRY_EXIT_ACCESS';
      expect(codes(f, context({}, extra))).toContain(code);
      expect(codes(f, context({ [key]: false }, extra))).not.toContain(code);
    }
  }
  const custom = { ...candidate, footprint: rect(-1, -1, 2, 2), openEdges: [2], posX: 8.5 };
  expect(codes(custom, context())).toContain('PERIPHERAL_CLEARANCE');
  expect(codes(custom, context({ peripheralClearance: false }))).not.toContain('PERIPHERAL_CLEARANCE');
  const off = Object.fromEntries(BASIC_RULE_IDS.map(id => [id, false]));
  expect(codes({ ...candidate, width: -2 }, context(off))).toContain('INVALID_DIMENSIONS');
  expect(codes({ ...candidate, posX: 15 }, context(off))).toEqual([]);
  expect(codes({ ...candidate, width: 2.3 }, context({ peripheralClearance: false }))).toContain('INVALID_DIMENSIONS');
});

test('free-space search uses enabled rules, and circular wall clearance is independent of the boundary', () => {
  const grid = new GridSystem(-10, -10, 20, 20);
  const zones = [{ id: 'all', kind: 'NO_CONSTRUCTION' as const, label: 'NC', polygon: rect(-10, -10, 20, 20) }];
  expect(new FreeSpaceMap(grid, context({}, { zones })).validPlacements(2, 2)).toEqual([]);
  expect(new FreeSpaceMap(grid, context({ NO_CONSTRUCTION: false }, { zones })).validPlacements(2, 2).length).toBeGreaterThan(0);
  const circle = { boundary: null, circleRadius: 10 };
  expect(codes({ ...candidate, posX: 8.5 }, context({}, circle))).toContain('PERIPHERAL_CLEARANCE');
  expect(codes({ ...candidate, posX: 8.5 }, context({ peripheralClearance: false }, circle))).not.toContain('PERIPHERAL_CLEARANCE');
  expect(codes({ ...candidate, posX: 15 }, context({ peripheralClearance: false }, circle))).toContain('OUTSIDE_HALL');
});

test('Rules panel updates issues immediately; picker can cancel/apply without library rules; choices save and reload', async ({ page }) => {
  const stalls = [testStall(1, { posX: 22.5, openSides: ['LEFT'] })];
  await setupPlanner(page, stalls);
  await page.getByRole('tab', { name: /Rules/ }).click();
  const panel = page.locator('app-violations-panel[section="rules"]');
  expect((await plannerState(page)).audit.flatMap((a: any) => a.violations.map((v: any) => v.code))).toContain('PERIPHERAL_CLEARANCE');
  await panel.getByRole('switch', { name: 'Wall clearance', exact: true }).uncheck();
  expect((await plannerState(page)).audit).toEqual([]);
  await page.getByRole('button', { name: 'Choose rules', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Which rules apply to this layout?' });
  await picker.getByRole('switch', { name: 'Wall clearance', exact: true }).check();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel.getByRole('switch', { name: 'Wall clearance', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Choose rules', exact: true }).click();
  await picker.getByRole('switch', { name: 'Compulsory passages', exact: true }).uncheck();
  await picker.getByRole('button', { name: 'Apply rules', exact: true }).click();
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
  expect(saved.hall.rules.enabledRules).toEqual({ peripheralClearance: false, PASSAGE: false });
  await expect(panel.getByRole('switch', { name: 'Wall clearance', exact: true })).not.toBeChecked();
  await expect(panel.getByRole('switch', { name: 'Compulsory passages', exact: true })).not.toBeChecked();
});

test('PDF rule choices clear stale checks, cancel safely, and carry into the imported layout', async ({ page }, info) => {
  await setupPlanner(page, [], { ...testHall, name: 'Hall 1' });
  const result = { page: { width: 100, height: 100, rotation: 0 }, layers: [], usedLayers: true,
    groups: [{ group: '1', pitchX: 5, pitchY: 5, originX: 0, originY: 0, rms: 0, gridLines: 10, dimensionChecks: 0, dimensionMaxError: null, usesHalfMetres: false }],
    stalls: [{ key: 's1', group: '1', blockId: '1-01', letter: 'A', name: 'Imported stall', outline: rect(0, 0, 4, 3), outlinePt: [],
      openEdges: [2], area: 12, shape: 'rectangle', category: 'standard', labels: { area: null, dims: null, texts: [] }, confidence: 'high', issues: [], include: true }],
    excluded: [], unresolved: [], issues: [] };
  const openReview = async () => {
    await page.getByRole('button', { name: 'Import PDF plan', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Import a CAD hall plan' })).toBeVisible();
    // Seed an extraction result at the same boundary as the upload response; no external parser required.
    await page.evaluate(r => {
      const dialog = (window as any).ng.getComponent(document.querySelector('app-pdf-import-dialog'));
      dialog.fileName.set('test.pdf'); dialog.start(r);
    }, result);
  };
  await openReview();
  const dialog = page.getByRole('dialog', { name: 'Import a CAD hall plan' });
  await dialog.getByRole('button', { name: 'Check planner rules', exact: true }).click();
  await expect(dialog.getByText('pass the planner rules together.', { exact: false })).toBeVisible();
  await dialog.getByRole('switch', { name: 'Wall clearance', exact: true }).uncheck();
  await expect(dialog.getByRole('button', { name: 'Check planner rules', exact: true })).toBeVisible();
  expect((await plannerState(page)).rules.enabledRules?.peripheralClearance).not.toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await plannerState(page)).rules.enabledRules?.peripheralClearance).not.toBe(false);
  await openReview();
  await expect(dialog.getByRole('switch', { name: 'Wall clearance', exact: true })).toBeChecked();
  await dialog.getByRole('switch', { name: 'Wall clearance', exact: true }).uncheck();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await dialog.getByRole('switch', { name: 'Hall boundary & floor', exact: true }).scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`pdf-basic-rules-${width}.png`) });
  }
  await dialog.getByRole('button', { name: 'Check planner rules', exact: true }).click();
  await dialog.getByRole('button', { name: /Import all 1 as drawn/ }).click();
  expect((await plannerState(page)).rules.enabledRules.peripheralClearance).toBe(false);
  expect((await plannerState(page)).stalls).toHaveLength(1);
});

for (const width of [1440, 390, 1920]) {
  test(`basic rules are accessible and fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await setupPlanner(page);
    await page.getByRole('tab', { name: /Rules/ }).click();
    await page.getByRole('button', { name: 'Choose rules', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Which rules apply to this layout?' });
    await expect(picker.getByRole('switch')).toHaveCount(BASIC_RULE_IDS.length);
    const toggle = picker.getByRole('switch', { name: 'Wall clearance', exact: true });
    await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).not.toBeChecked();
    await picker.getByRole('button', { name: 'All off', exact: true }).click();
    await expect(picker.getByRole('switch', { checked: true })).toHaveCount(0);
    await picker.getByRole('button', { name: 'All on', exact: true }).click();
    await expect(picker.getByRole('switch', { checked: true })).toHaveCount(BASIC_RULE_IDS.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`basic-rules-${width}.png`) });
    await picker.getByRole('button', { name: 'Apply rules', exact: true }).click();
  });
}
