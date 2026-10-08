import { expect, Page, test } from '@playwright/test';
const rect = (w: number, h: number) => [
  [
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
      [0, 0],
    ],
  ],
];
async function mockCsv(page: Page, options: { missingUnits?: boolean; multiple?: boolean } = {}) {
  const previews: any[] = [],
    commits: any[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: 'u',
      name: 'Reviewer',
      email: 'reviewer@test.local',
      isPlatformAdmin: false,
    };
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
          membership: { id: 'm', role: { id: 'r', name: 'Reviewer' }, scope: {} },
          permissions: ['venues.view', 'halls.import'],
        },
      });
    if (path.endsWith('/halls/import/csv/preview')) {
      const body = route.request().postDataJSON();
      previews.push(body);
      const bad = options.missingUnits && !body.mapping.unit;
      const rows = ['North hall', ...(options.multiple ? ['South hall'] : [])].map((name, i) => ({
        externalId: `hall-${i}`,
        name,
        width: 20,
        depth: 33,
        floorArea: 600,
        warnings: [],
        error: bad
          ? 'Choose source units, or enter metres per source unit for a pixel drawing.'
          : null,
        existing: null,
        floor: bad
          ? null
          : {
              schema: 'floor/1',
              width: 20,
              depth: 33,
              areas: [],
              labels: [{ x: 2, y: 2, text: 'Gate A' }],
              iconGroups: [],
              north: null,
              legend: [],
              geometry: {
                schema: 'geometry/1',
                unit: 'm',
                boundary: rect(20, 33),
                hallBoundary: rect(20, 30),
                grid: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
                objects: [],
                zones: [
                  {
                    id: 'foyer',
                    name: 'Entry foyer',
                    kind: 'foyer',
                    geometry: [
                      [
                        [
                          [0, 30],
                          [5, 30],
                          [5, 33],
                          [0, 33],
                          [0, 30],
                        ],
                      ],
                    ],
                    shared: false,
                    hallKeys: [],
                  },
                ],
              },
            },
      }));
      return route.fulfill({
        json: {
          rows,
          previewToken: 'a'.repeat(64),
          fields: ['width', 'height', 'objects'],
          collectionPaths: ['halls'],
          areaTypes: [],
        },
      });
    }
    if (path.endsWith('/halls/import/csv')) {
      const body = route.request().postDataJSON();
      commits.push(body);
      return route.fulfill({
        json: {
          created: body.halls.map((h: any) => ({ id: h.externalId, name: h.name })),
          updated: [],
          unchanged: [],
        },
      });
    }
    if (path.endsWith('/venue-id/halls')) return route.fulfill({ json: [] });
    if (path.endsWith('/venues/venue-id'))
      return route.fulfill({
        json: { id: 'venue-id', name: 'Generic venue', code: null, address: null, hallCount: 0 },
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { previews, commits };
}
async function openCsv(page: Page) {
  await page.goto('/venue/venues/venue-id');
  await page.getByRole('button', { name: 'Import from CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Import from CSV', exact: true, includeHidden: true }),
  ).toBeVisible();
  const tour = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Hall import tour', exact: true }),
  });
  await expect(tour.getByRole('heading', { name: 'Upload venue CSV', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Back to import', exact: true }).click();
  await expect(tour).toHaveCount(0);
}
async function upload(page: Page) {
  await page.getByLabel('Choose venue CSV file').setInputFiles({
    name: 'venue-layout.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name,width,depth,unit\r\nnorth,North hall,20,30,m\r\n'),
  });
  await expect(page.getByRole('heading', { name: 'Choose halls', exact: true })).toBeVisible();
}
test('generic CSV option converts, previews in Three.js and requires inspection before save', async ({
  page,
}) => {
  const api = await mockCsv(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openCsv(page);
  await upload(page);
  expect(api.previews[0].content).toContain('id,name,width,depth,unit\r\n');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save 1 hall', exact: true })).toBeDisabled();
  await page.getByLabel('CSV hall name', { exact: true }).fill('Venue North');
  await page.getByLabel('Confirm reviewed CSV hall North hall', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save 1 hall', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/csv-import-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Save 1 hall', exact: true }).click();
  await expect(
    page.getByText('1 halls created, 0 updated, 0 already up to date in Generic venue.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(api.commits[0]).toMatchObject({
    halls: [{ name: 'Venue North' }],
    reviewed: true,
    previewToken: 'a'.repeat(64),
  });
  expect(errors).toEqual([]);
});
test('missing units are repaired by mapping and mapping edits invalidate the reviewed preview', async ({
  page,
}) => {
  const api = await mockCsv(page, { missingUnits: true });
  await openCsv(page);
  await upload(page);
  await expect(
    page.getByText('Choose source units, or enter metres per source unit for a pixel drawing.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('CSV source units', { exact: true }).selectOption('m');
  await page.getByRole('button', { name: 'Update preview', exact: true }).click();
  await page.getByLabel('Confirm reviewed CSV hall North hall', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save 1 hall', exact: true })).toBeEnabled();
  await page.getByText('Units and field mapping', { exact: true }).click();
  await page.getByLabel('CSV Width field', { exact: true }).fill('size.width');
  await expect(page.getByRole('button', { name: 'Save 1 hall', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Update preview', exact: true }).click();
  await expect(
    page.getByLabel('Confirm reviewed CSV hall North hall', { exact: true }),
  ).not.toBeChecked();
  expect(api.previews.at(-1).mapping).toMatchObject({ unit: 'm', width: 'size.width' });
});
test('multiple CSV halls need separate previews before saving the selected batch', async ({
  page,
}) => {
  const api = await mockCsv(page, { multiple: true });
  await openCsv(page);
  await upload(page);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByLabel('Include CSV hall North hall', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Include CSV hall South hall', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Select all available', exact: true }).click();
  await expect(page.getByLabel('Include CSV hall North hall', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Include CSV hall South hall', { exact: true })).toBeChecked();
  await expect(page.getByText('0 of 2 selected halls reviewed.', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm reviewed CSV hall North hall', { exact: true }).check();
  await expect(page.getByText('1 of 2 selected halls reviewed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save 2 halls', exact: true })).toBeDisabled();
  await page.getByLabel('Include CSV hall South hall', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Save 1 hall', exact: true })).toBeEnabled();
  await page.getByLabel('Include CSV hall South hall', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save 2 halls', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review next hall', exact: true }).click();
  await expect(page.getByText('Hall 2 of 2', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm reviewed CSV hall South hall', { exact: true }).check();
  await expect(page.getByText('2 of 2 selected halls reviewed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'North hall', exact: true }).click();
  await expect(
    page.getByLabel('Confirm reviewed CSV hall North hall', { exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save 2 halls', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save 2 halls', exact: true }).click();
  expect(api.commits[0].halls).toHaveLength(2);
});

test('CSV upload rejects a JSON file without requesting conversion', async ({ page }) => {
  const api = await mockCsv(page);
  await openCsv(page);
  await page.getByLabel('Choose venue CSV file').setInputFiles({
    name: 'layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"width":20,"depth":30}'),
  });
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a .csv file with a header row and one row per hall.',
  );
  expect(api.previews).toHaveLength(0);
  expect(api.commits).toHaveLength(0);
});

test('the venue import tour launches CSV import and its help opens the mapping controls', async ({
  page,
}) => {
  const api = await mockCsv(page, { missingUnits: true });
  await page.goto('/venue/venues/venue-id');
  await page.getByRole('button', { name: 'Start import tour', exact: true }).click();
  const tour = page.getByRole('dialog');
  await tour.getByRole('button', { name: 'CSV', exact: true }).click();
  await expect(tour.getByRole('heading', { name: 'Upload venue CSV', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Open CSV importer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Import from CSV', exact: true, includeHidden: true }),
  ).toBeVisible();
  const initialTour = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Hall import tour', exact: true }),
  });
  await expect(
    initialTour.getByRole('heading', { name: 'Upload venue CSV', exact: true }),
  ).toBeVisible();
  await initialTour.getByRole('button', { name: 'Back to import', exact: true }).click();
  await expect(initialTour).toHaveCount(0);
  await upload(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start import tour', exact: true })
    .click();
  const nestedTour = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Hall import tour', exact: true }) });
  await expect(
    nestedTour.getByRole('heading', { name: 'Repair units and field mapping', exact: true }),
  ).toBeVisible();
  await nestedTour.getByRole('button', { name: 'Show on page', exact: false }).click();
  await expect(page.getByLabel('CSV source units', { exact: true })).toBeInViewport();
  expect(api.commits).toHaveLength(0);
});
