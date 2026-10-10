import { expect, Page, test } from '@playwright/test';
import type { HallFloor } from '../src/app/core/api/api.models';

async function mockManualHall(page: Page) {
  const creates: any[] = [],
    updates: any[] = [];
  let detail: any;
  const date = '2026-10-08T00:00:00Z';
  const version = (n: number) => ({
    version: n,
    source: 'blank',
    sourceRef: null,
    note: null,
    createdAt: date,
    createdBy: null,
    current: true,
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
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
          membership: { id: 'm', role: { id: 'r', name: 'Owner' }, scope: {} },
          permissions: ['venues.view', 'venues.manage'],
        },
      });
    if (path.endsWith('/venues/venue-id'))
      return route.fulfill({
        json: {
          id: 'venue-id',
          name: 'Manual venue',
          code: null,
          address: null,
          hallCount: detail ? 1 : 0,
        },
      });
    if (path.endsWith('/venue-id/halls')) {
      if (route.request().method() !== 'POST')
        return route.fulfill({ json: detail ? [detail] : [] });
      const body = route.request().postDataJSON();
      creates.push(body);
      const boundary: NonNullable<HallFloor['geometry']>['boundary'] = [
        [
          [
            [0, 0],
            [body.width, 0],
            [body.width, body.depth],
            [0, body.depth],
            [0, 0],
          ],
        ],
      ];
      detail = {
        ...body,
        id: 'manual-hall',
        venueId: 'venue-id',
        venue: { id: 'venue-id', name: 'Manual venue' },
        floorArea: body.width * body.depth,
        currentVersion: 1,
        source: null,
        updatedAt: date,
        versions: [version(1)],
        floor: {
          schema: 'floor/1',
          width: body.width,
          depth: body.depth,
          areas: [],
          north: null,
          ...body.annotations,
          geometry: {
            schema: 'geometry/1',
            unit: 'm',
            boundary,
            hallBoundary: boundary,
            grid: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
            objects: [],
            zones: [],
            source: {
              documentId: 'manual',
              page: 1,
              regionId: 'hall',
              origin: [0, 0],
              metresPerUnit: 1,
            },
            review: { revision: 1, checks: [], acknowledgements: [] },
          },
        },
      };
      return route.fulfill({ json: detail });
    }
    if (path.endsWith('/halls/manual-hall')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        updates.push(body);
        detail = {
          ...detail,
          ...body,
          currentVersion: detail.currentVersion + 1,
          floor: { ...detail.floor, ...body.annotations },
          versions: [
            version(detail.currentVersion + 1),
            ...detail.versions.map((v: any) => ({ ...v, current: false })),
          ],
        };
      }
      return route.fulfill({ json: detail });
    }
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { creates, updates };
}
async function openCreate(page: Page) {
  await page.goto('/venue/venues/venue-id');
  await page.getByRole('button', { name: 'Add hall', exact: false }).click();
  await page.getByRole('menuitem', { name: 'Draw by size', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'New hall by size' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Manual north');
  await page.getByLabel('Width', { exact: true }).fill('20');
  await page.getByLabel('Depth', { exact: true }).fill('30');
}
test('manually creates, places and drags helpers, saves legends, then edits saved positions', async ({
  page,
}) => {
  // Long: create, place, drag, save and edit again; under a full parallel run it nears 30 s.
  test.setTimeout(60_000);
  const api = await mockManualHall(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openCreate(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add helper', exact: true }).click();
  await dialog.getByRole('button', { name: 'Place on layout', exact: true }).click();
  const canvas = dialog.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(dialog.getByRole('button', { name: 'Place on layout', exact: true })).toBeVisible();
  const originalX = Number(await dialog.getByLabel('Helper X position').inputValue());
  const originalY = Number(await dialog.getByLabel('Helper Y position').inputValue());
  await page.mouse.move(x + 5, y + 5);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 25, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await dialog.getByLabel('Helper X position').inputValue()))
    .toBeGreaterThan(originalX);
  expect(Number(await dialog.getByLabel('Helper Y position').inputValue())).toBeGreaterThan(
    originalY,
  );
  await dialog.getByLabel('Helper type').selectOption('stairs');
  await dialog.getByRole('button', { name: 'Add helper', exact: true }).click();
  await dialog.getByLabel('Helper text', { exact: true }).fill('Staircase A');
  await dialog.getByLabel('Helper X position').fill('25');
  await dialog.getByLabel('Helper Y position').fill('-5');
  await dialog.getByLabel('Helper type').selectOption('lift');
  await dialog.getByRole('button', { name: 'Add helper', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add text label', exact: true }).click();
  await dialog.getByLabel('Helper text', { exact: true }).fill('Gate A');
  await dialog.getByLabel('Helper X position').fill('2');
  await dialog.getByLabel('Helper Y position').fill('32');
  await dialog.getByText('Helper size', { exact: true }).click();
  await dialog.getByLabel('Helper width', { exact: true }).fill('12');
  await dialog.getByLabel('Helper height', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Add legend', exact: true }).click();
  await dialog.getByLabel('Legend text').fill('Facilities');
  await dialog.getByLabel('Legend colour').fill('#ff9652');
  await dialog.locator('app-three-plan summary').click();
  await expect(
    dialog.locator('app-three-plan').getByText('Facilities', { exact: true }),
  ).toBeVisible();
  await dialog.screenshot({ path: 'test-results/manual-hall-helpers.png' });
  await dialog.getByRole('button', { name: 'Create hall', exact: true }).click();
  await expect(page).toHaveURL(/halls\/manual-hall/);
  expect(api.creates[0]).toMatchObject({
    width: 20,
    depth: 30,
    annotations: {
      labels: [{ text: 'Gate A', x: 2, y: 32, width: 12, height: 2 }],
      legend: [{ label: 'Facilities', color: '#ff9652', showInView: true }],
    },
  });
  expect(api.creates[0].annotations.iconGroups.map((g: any) => g.icons[0].kind)).toEqual([
    'toilet',
    'stairs',
    'lift',
  ]);
  expect(api.creates[0].annotations.iconGroups[1]).toMatchObject({ x: 25, y: -5 });
  await expect(page.locator('app-floor-view [data-helper-kind="stairs"]')).toHaveText(
    'Staircase A',
  );
  await page.getByRole('button', { name: 'Edit details', exact: false }).click();
  await dialog.getByRole('button', { name: 'Staircase A', exact: true }).click();
  await expect(dialog.getByLabel('Helper X position')).toHaveValue('25');
  await dialog.getByLabel('Helper X position').fill('28');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.updates[0].expectedVersion).toBe(1);
  expect(api.updates[0].annotations.iconGroups[1].x).toBe(28);
  await expect(page.getByText('20 × 30 m', { exact: true })).toBeVisible();
});
test('manual helpers can be removed and unnamed entries block saving on a narrow screen', async ({
  page,
}) => {
  await mockManualHall(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCreate(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add text label', exact: true }).click();
  await dialog.getByLabel('Helper text', { exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: 'Create hall', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Remove helper', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create hall', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add legend', exact: true }).click();
  await dialog.getByLabel('Legend text').fill('');
  await expect(dialog.getByRole('button', { name: 'Create hall', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Remove legend', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create hall', exact: true })).toBeEnabled();
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
});

test('draws a hall of any shape: a cinema fan by its measurements, and an outline clicked on the grid', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  const { creates } = await mockManualHall(page);
  await page.goto('/venue/venues/venue-id');
  await page.getByRole('button', { name: 'Add hall', exact: false }).click();
  await page.getByRole('menuitem', { name: 'Draw by size', exact: false }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('Name', { exact: true }).fill('Auditorium');
  const shapes = dialog.getByRole('radiogroup', { name: 'Hall shape' });
  await expect(shapes.getByRole('radio', { name: 'Rectangle' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // A cinema: a fan from the screen, measured by its screen, depth and angle.
  await shapes.getByRole('radio', { name: 'Cinema / auditorium' }).click();
  await expect(dialog).toContainText('A fan widening from the screen or stage');
  await page.getByLabel('Screen / stage width').fill('20');
  await expect(dialog.locator('p.area')).toContainText('m² of floor');
  await expect(dialog.locator('app-hall-annotations-editor')).toBeVisible();
  if (process.env['PW_SHOTS']) {
    await dialog.locator('app-hall-annotations-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env['PW_SHOTS']}/hall-cinema.png` });
  }

  // Measurements that make no hall say why, and nothing can be created.
  await shapes.getByRole('radio', { name: 'L-shape' }).click();
  await page.getByLabel('Corner cut-out width').fill('60');
  await expect(dialog.getByRole('alert')).toContainText('cut-out must be smaller');
  await expect(dialog.getByRole('button', { name: 'Create hall' })).toBeDisabled();

  // Any other outline: its corners clicked on the grid, snapped to half a metre.
  await shapes.getByRole('radio', { name: 'Custom' }).click();
  const grid = dialog.getByRole('img', { name: 'Click to add a corner of the hall' });
  const box = (await grid.boundingBox())!;
  for (const [fx, fy] of [
    [0.1, 0.1],
    [0.8, 0.15],
    [0.7, 0.85],
    [0.15, 0.7],
  ]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  const corners = dialog.getByLabel(/Corners, in order/);
  await expect(corners).toHaveValue(/^([\d.]+, [\d.]+\n){3}[\d.]+, [\d.]+$/);
  // A typed corner moves it.
  const typed = (await corners.inputValue()).split('\n');
  typed[0] = '0, 0';
  await corners.fill(typed.join('\n'));
  await page.screenshot({ path: test.info().outputPath('custom-hall.png') });
  await dialog.getByRole('button', { name: 'Create hall' }).click();

  await expect.poll(() => creates.length).toBe(1);
  const sent = creates[0];
  expect(sent.outline).toHaveLength(4);
  expect(sent.outline[0]).toEqual([0, 0]);
  for (const [x, y] of sent.outline) {
    expect((x * 2) % 1).toBe(0);
    expect((y * 2) % 1).toBe(0);
  }
  expect(sent.width).toBe(Math.max(...sent.outline.map((p: number[]) => p[0])));
});
