import { expect, Page, test } from '@playwright/test';

/**
 * The stall planner against a mocked API: a 40 × 30 m hall with a pillar and a passage. The
 * mocked check refuses any stall reaching into the passage (x < 4), as the server's rules would.
 */
const SHOTS = process.env['PW_SHOTS'];

const hallFloor = {
  schema: 'floor/1',
  width: 40,
  depth: 30,
  areas: [
    { kind: 'passage', x: 0, y: 0, width: 4, height: 30, label: 'Passage' },
    { kind: 'column', x: 19.5, y: 14.5, width: 1, height: 1, label: 'Pillar' },
  ],
  labels: [{ text: 'HALL 5 — ELECTRONICS', x: 24, y: 2, width: 12, height: 1.5 }],
  iconGroups: [{ x: 30, y: 26, width: 6, height: 2, icons: [{ kind: 'toilet', label: 'Toilet' }] }],
  north: null,
  legend: [],
};

const switches = { hallBoundary: true, stallOverlap: true, PASSAGE: true };

async function mockPlanner(page: Page, eventScoped = false) {
  const saves: any[] = [];
  const checks: any[] = [];
  const publishes: number[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const user = { id: 'u', name: 'Owner', email: 'owner@test.local', isPlatformAdmin: false };
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ json: { accessToken: 'mock', expiresIn: 3600, user } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { user, memberships: [] } });
    if (path.endsWith('/public-config'))
      return route.fulfill({
        json: {
          slug: 'venue',
          name: 'Any venue',
          branding: {
            primaryColor: '#0b5394',
            accentColor: null,
            fontFamily: 'Inter',
            logoUrl: null,
            logoDarkUrl: null,
            faviconUrl: null,
          },
          locale: { defaultLanguage: 'en', languages: ['en'] },
        },
      });
    if (path.endsWith('/context'))
      return route.fulfill({
        json: {
          organisation: {
            id: 'org',
            slug: 'venue',
            name: 'Any venue',
            features: {},
            bookingMode: 'inquiry',
          },
          membership: { id: 'm', role: { id: 'r', name: 'Owner' }, scope: {}, eventScoped },
          permissions: [
            'events.view',
            'events.manage',
            'layouts.view',
            'layouts.edit',
            'categories.manage',
          ],
        },
      });
    if (path.endsWith('/plan/check')) {
      const body = req.postDataJSON();
      checks.push(body);
      const changed = new Set(body.changed);
      const findings = body.stalls
        .filter((s: any) => changed.has(s.id) && s.x < 4)
        .map((s: any) => ({
          ruleId: 'PASSAGE',
          message: `Stall ${s.islandNumber ?? ''}${s.stallNumber} stands on a compulsory passage.`,
          ids: [s.id],
        }));
      return route.fulfill({ json: { findings } });
    }
    if (path.endsWith('/plan/publish')) {
      const { revision } = req.postDataJSON();
      publishes.push(revision);
      return route.fulfill({
        json: {
          ...saves[saves.length - 1],
          revision,
          published: { revision, at: '2026-10-09T10:00:00Z' },
        },
      });
    }
    if (path.endsWith('/plan') && req.method() === 'PUT') {
      const body = req.postDataJSON();
      saves.push(body);
      return route.fulfill({
        json: { ...body, revision: body.revision + 1, updatedAt: '2026-10-09T00:00:00Z' },
      });
    }
    if (path.endsWith('/plan'))
      return route.fulfill({
        json: {
          canEdit: true,
          readOnlyReason: null,
          canPublish: true,
          plan: {
            revision: 0,
            updatedAt: null,
            published: null,
            zones: [],
            stalls: [],
            seats: [],
            objects: [],
          },
          hall: {
            event: { id: 'ev', name: 'IITF 2026', kind: 'internal', audience: 'B2B' },
            hall: {
              hallId: 'h5',
              name: 'Hall 5',
              code: null,
              level: null,
              venue: { id: 'v', name: 'Pragati' },
              width: 40,
              depth: 30,
              floorArea: 1200,
              floorVersion: 1,
              latestFloorVersion: 1,
              rulesOn: 3,
              drawingProfile: 'grid',
              overlaps: [],
            },
            floor: hallFloor,
            rules: {
              switches,
              values: { passageWidth: { B2B: 3, B2C: 4 } },
              drawingProfile: 'grid',
            },
            categories: [
              { id: 'c1', name: 'Premium', status: 'active' },
              { id: 'c2', name: 'Corner', status: 'active' },
            ],
            plan: { stalls: 0, seats: 0, revision: 0 },
          },
        },
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { saves, checks, publishes };
}

/** A point on the canvas, as a share of its width and height. */
async function at(page: Page, fx: number, fy: number) {
  const box = (await page.locator('app-planner-canvas canvas').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

/** A number of the Hall Statistics card. */
const stat = (page: Page, label: string) =>
  page
    .locator('dl.stats dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** A button of the ribbon, by its label. */
const tool = (page: Page, name: string) =>
  page.locator('nav.ribbon').getByRole('button', { name, exact: true });

async function clickAt(page: Page, ...points: Array<[number, number]>) {
  for (const p of points) {
    const at_ = await at(page, ...p);
    await page.mouse.click(at_.x, at_.y);
  }
}

test('every tool of the ribbon, the view cube, the wheel and 3D work', async ({ page }) => {
  // A long walk through every tool.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 960 });
  const { saves, publishes } = await mockPlanner(page);
  await page.goto('/venue/events/ev/halls/h5/planner');
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();
  // The legend: the hall's areas, and what the plan draws.
  const legend = page.locator('app-planner-canvas details.legend');
  await expect(legend).toContainText('Passage');
  await expect(legend).toContainText('Column');
  await expect(legend).toContainText('Open side');
  // The view cube is for 3D only.
  await expect(page.locator('app-planner-canvas .cube')).toHaveCount(0);

  // Zone, then booths: one refused on the passage, one made.
  await tool(page, 'Zone').click();
  await drag(page, [0.45, 0.3], [0.75, 0.6]);
  await expect(stat(page, 'Zones')).toHaveText('1');
  await tool(page, 'Booth').click();
  await clickAt(page, [0.14, 0.5]);
  await expect(page.locator('p-toast')).toContainText('stands on a compulsory passage');
  await clickAt(page, [0.3, 0.75]);
  await expect(stat(page, 'Total Booths')).toHaveText('1');
  // On whole grid cells, wherever in a cell the click was.
  const whole = async () => {
    const values = await page
      .locator('app-planner-properties p-inputnumber input')
      .evaluateAll((els) => els.slice(0, 4).map((e) => Number((e as HTMLInputElement).value)));
    expect(values.every(Number.isInteger)).toBe(true);
  };
  await whole();
  await page.locator('.p-toast-close-button').first().click();

  // Modify: copy, split, merge, rotate, mirror, number, scale, row.
  await tool(page, 'Copy').click();
  await expect(stat(page, 'Total Booths')).toHaveText('2');
  await tool(page, 'Split').click();
  await expect(stat(page, 'Total Booths')).toHaveText('3');
  await expect(page.locator('app-planner-properties h3')).toHaveText('2 stalls');
  await tool(page, 'Merge').click();
  await expect(stat(page, 'Total Booths')).toHaveText('2');
  await expect(page.locator('app-planner-properties h3')).toHaveText(/^Stall /);
  for (const name of ['Rotate', 'Mirror', 'Mirror X', 'Number']) await tool(page, name).click();
  // Number skips 1: the other booth has it.
  await expect(page.locator('app-planner-properties h3')).toHaveText('Stall 2');
  await tool(page, 'Scale').click();
  await page.locator('app-scale-dialog input').fill('200');
  await page.locator('app-scale-dialog input').press('Tab');
  await page.locator('app-scale-dialog').getByRole('button', { name: 'Scale' }).click();
  await expect(page.locator('app-planner-properties')).toContainText('36 m²');
  await tool(page, 'Row').click();
  const addRow = page.locator('app-row-dialog').getByRole('button', { name: /^Add \d+ booths$/ });
  const inRow = Number((await addRow.textContent())!.match(/\d+/)![0]);
  await addRow.click();
  await expect(stat(page, 'Total Booths')).toHaveText(String(2 + inRow));
  // Undo takes the row back; redo brings it again.
  await tool(page, 'Undo').click();
  await expect(stat(page, 'Total Booths')).toHaveText('2');
  await tool(page, 'Redo').click();
  await expect(stat(page, 'Total Booths')).toHaveText(String(2 + inRow));

  // Draw: line, rectangle, circle, polyline and text.
  await tool(page, 'Line').click();
  await clickAt(page, [0.2, 0.2], [0.35, 0.2]);
  await tool(page, 'Rect').click();
  await drag(page, [0.8, 0.2], [0.9, 0.3]);
  await tool(page, 'Circle').click();
  await drag(page, [0.85, 0.8], [0.9, 0.8]);
  await tool(page, 'Polyline').click();
  await clickAt(page, [0.2, 0.9], [0.3, 0.92]);
  const last = await at(page, 0.4, 0.9);
  await page.mouse.dblclick(last.x, last.y);
  await tool(page, 'Object').click();
  await clickAt(page, [0.6, 0.15]);
  await expect(page.locator('app-planner-properties h3')).toHaveText('Text');

  // Measure: distance, area, angle, height.
  const chips = page.locator('app-planner-canvas .overlay');
  await tool(page, 'Distance').click();
  await clickAt(page, [0.2, 0.4], [0.3, 0.4]);
  const end = await at(page, 0.3, 0.5);
  await page.mouse.dblclick(end.x, end.y);
  await expect(chips).toContainText('Total');
  await tool(page, 'Area').click();
  await clickAt(page, [0.2, 0.4], [0.3, 0.4], [0.3, 0.5]);
  await page.keyboard.press('Enter');
  await expect(chips).toContainText('m²');
  await tool(page, 'Angle').click();
  await clickAt(page, [0.2, 0.4], [0.3, 0.4], [0.3, 0.5]);
  await expect(chips).toContainText('°');
  await tool(page, 'Height').click();
  await clickAt(page, [0.2, 0.4], [0.3, 0.5]);
  await expect(chips).toContainText('↕');

  // View: zoom window, split view, grid, labels, way out.
  await tool(page, 'Zoom window').click();
  await drag(page, [0.4, 0.4], [0.6, 0.6]);
  await tool(page, 'Split view').click();
  await expect(page.locator('app-planner-canvas')).toHaveCount(2);
  await tool(page, 'Split view').click();
  await expect(page.locator('app-planner-canvas')).toHaveCount(1);
  await tool(page, 'Grid').click();
  await expect(tool(page, 'Grid')).toHaveAttribute('aria-pressed', 'false');
  await tool(page, 'Labels').click();
  await expect(tool(page, 'Labels')).toHaveAttribute('aria-pressed', 'false');
  await tool(page, 'Grid').click();
  await tool(page, 'Labels').click();
  // Way out is gone from the toolbar.
  await expect(tool(page, 'Way out')).toHaveCount(0);
  await tool(page, 'Select').click();

  // The view cube and the wheel; 3D and back.
  const cube = page.locator('app-planner-canvas .cube-wrap');
  const pressed = (name: string) => cube.getByRole('button', { name, exact: true });
  await pressed('3D').click();
  await expect(pressed('3D')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('FRONT')).toHaveAttribute('aria-pressed', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-3d.png` });
  await pressed('RIGHT').click();
  await expect(pressed('RIGHT')).toHaveAttribute('aria-pressed', 'true');
  const ring = cube.locator('.ring');
  const before = await ring.getAttribute('style');
  const box = (await ring.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await ring.getAttribute('style')).not.toBe(before);
  await expect(pressed('BACK')).toHaveAttribute('aria-pressed', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-3d-back.png` });
  // Booths are drawn in 3D too: drag on the floor.
  await tool(page, 'Booth').click();
  await expect(pressed('3D')).toHaveAttribute('aria-pressed', 'true');
  const before3d = Number(await stat(page, 'Total Booths').textContent());
  await drag(page, [0.55, 0.62], [0.62, 0.7]);
  await expect(stat(page, 'Total Booths')).toHaveText(String(before3d + 1));
  await whole();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-3d-booth.png` });
  // Other drawing tools go back to the plan from above, where the cube is not shown.
  await tool(page, 'Line').click();
  await expect(pressed('2D')).toHaveAttribute('aria-pressed', 'true');
  await expect(cube.locator('.cube')).toHaveCount(0);
  await tool(page, 'Select').click();

  // To booth: the rectangular zone becomes a booth.
  await page.locator('.zones .zone').first().click();
  const booths = Number(await stat(page, 'Total Booths').textContent());
  await tool(page, 'To booth').click();
  await expect(stat(page, 'Zones')).toHaveText('0');
  await expect(stat(page, 'Total Booths')).toHaveText(String(booths + 1));

  // Export, then import the file back.
  const download = page.waitForEvent('download');
  await page.locator('nav.ribbon').getByRole('button', { name: 'Export' }).click();
  const file = await (await download).path();
  await page.locator('nav.ribbon input[type=file]').setInputFiles(file!);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('p-toast')).toContainText('Plan brought in');
  await expect(stat(page, 'Total Booths')).toHaveText(String(booths + 1));

  // Save, then publish.
  await page.locator('nav.ribbon').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('nav.ribbon').getByRole('button', { name: 'Saved' })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0].stalls).toHaveLength(booths + 1);
  expect(saves[0].objects).toHaveLength(5);
  await page.locator('nav.ribbon').getByRole('button', { name: 'Publish' }).click();
  await page.locator('app-confirm-dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('nav.ribbon').getByRole('button', { name: 'Published' })).toBeVisible();
  expect(publishes).toEqual([1]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-published.png` });
});

test('the venue admin adds categories one by one and from a CSV', async ({ page }) => {
  const created: any[] = [];
  const imported: any[] = [];
  let list = [
    {
      id: 'c1',
      name: 'Premium',
      status: 'active',
      eventHalls: 2,
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ];
  await mockPlanner(page);
  await page.route('**/api/orgs/venue/categories**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/import')) {
      imported.push(req.postDataJSON());
      list = [
        ...list,
        {
          id: 'c3',
          name: 'Corner',
          status: 'active',
          eventHalls: 0,
          updatedAt: '2026-10-09T00:00:00Z',
        },
      ];
      return route.fulfill({
        json: { created: 1, skipped: [{ name: 'Premium', reason: 'Already listed' }] },
      });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      created.push(body);
      const row = { id: 'c2', ...body, eventHalls: 0, updatedAt: '2026-10-09T00:00:00Z' };
      list = [...list, row];
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: list });
  });
  await page.goto('/venue/categories');
  await expect(page.getByRole('heading', { name: 'Stall categories' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Categories' })).toBeVisible();
  // Sold on event halls: it cannot be deleted, only made inactive.
  await expect(page.getByRole('button', { name: 'Delete Premium' })).toBeDisabled();

  await page.getByRole('button', { name: 'New category' }).click();
  await page.locator('#category-dialog-name').fill('Pavilion');
  await page.getByText('Inactive', { exact: true }).click();
  await page.getByRole('button', { name: 'Create category' }).click();
  expect(created).toEqual([{ name: 'Pavilion', status: 'inactive' }]);
  await expect(page.getByRole('cell', { name: 'Pavilion', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.locator('app-category-import-dialog input[type=file]').setInputFiles({
    name: 'categories.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,status\nCorner,active\nPremium,\ncorner,\n'),
  });
  await expect(page.locator('app-category-import-dialog')).toContainText('Twice in the file');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/categories-import.png` });
  await page.getByRole('button', { name: 'Import 2 categories' }).click();
  expect(imported).toEqual([
    {
      rows: [
        { name: 'Corner', status: 'active' },
        { name: 'Premium', status: 'active' },
      ],
    },
  ]);
  await expect(page.locator('p-toast')).toContainText('1 category added; 1 skipped');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/categories.png` });
});
