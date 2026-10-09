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
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

const switches = { hallBoundary: true, stallOverlap: true, PASSAGE: true };

async function mockPlanner(page: Page, eventScoped = false) {
  const saves: any[] = [];
  const checks: any[] = [];
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
          plan: { revision: 0, updatedAt: null, zones: [], stalls: [], seats: [] },
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
  return { saves, checks };
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

const count = (page: Page, label: string) =>
  page
    .locator('.counts dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

test('plans zones, booths and seats; a booth breaking a rule is not made', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 920 });
  const { saves } = await mockPlanner(page);
  await page.goto('/venue/events/ev/halls/h5/planner');
  await expect(page.getByText('Hall 5', { exact: true })).toBeVisible();
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();

  // A rectangular zone.
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await drag(page, [0.45, 0.3], [0.75, 0.6]);
  await expect(page.locator('.zones li')).toHaveCount(1);
  await expect(count(page, 'Zones')).toHaveText('1');
  await expect(page.locator('app-planner-properties')).toContainText('Length × breadth');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-zone.png` });

  // A booth on the passage is refused, with the rule in a toast.
  await page.getByRole('button', { name: 'Booth', exact: true }).click();
  const passage = await at(page, 0.14, 0.5);
  await page.mouse.click(passage.x, passage.y);
  await expect(page.locator('p-toast')).toContainText('stands on a compulsory passage');
  await expect(count(page, 'Stalls')).toHaveText('0');

  // A booth on open floor is made, numbered 1.
  const open = await at(page, 0.3, 0.75);
  await page.mouse.click(open.x, open.y);
  await expect(count(page, 'Stalls')).toHaveText('1');
  await expect(page.locator('app-planner-properties h3')).toHaveText('Stall 1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-stall.png` });

  // Auto-booths fills the zone.
  await page.getByRole('button', { name: 'Auto-booths' }).click();
  const dialog = page.locator('app-auto-booths-dialog');
  await expect(dialog).toContainText('Fill zone “Zone 1” with booths');
  const add = dialog.getByRole('button', { name: /^Add \d+ booths$/ });
  await expect(add).toBeEnabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-auto-booths.png` });
  const made = Number((await add.textContent())!.match(/\d+/)![0]);
  await add.click();
  await expect(count(page, 'Stalls')).toHaveText(String(1 + made));

  // A block of seats.
  await page.getByRole('button', { name: 'Seats', exact: true }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-seats.png` });
  await page.locator('app-seats-dialog').getByRole('button', { name: 'Add 30 seats' }).click();
  await expect(count(page, 'Seats')).toHaveText('30');

  // Auto-seats fills the zone too.
  await page.locator('.zones .zone').first().click();
  await page.getByRole('button', { name: 'Auto-seats' }).click();
  const seats = page.locator('app-auto-seats-dialog');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-auto-seats.png` });
  await seats.getByRole('button', { name: /^Add [\d,]+ seats$/ }).click();
  await expect(count(page, 'Seats')).not.toHaveText('30');

  // Undo takes the whole fill back in one step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(count(page, 'Seats')).toHaveText('30');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ revision: 0, zones: [{ name: 'Zone 1' }] });
  expect(saves[0].stalls).toHaveLength(1 + made);
  expect(saves[0].seats).toHaveLength(30);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-saved.png` });
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
