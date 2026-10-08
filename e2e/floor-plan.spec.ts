import { expect, Page, test } from '@playwright/test';
import type {
  PlanPage,
  PlanRegion,
  PlanReview,
  PlanView,
} from '../src/app/core/venues/floor-plan.models';
const geometry = (x: number, y: number, width: number, height: number): PlanRegion['geometry'] => [
  [
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ],
  ],
];
function document(count = 1, unknownScale = false): PlanView {
  const regions: PlanRegion[] = Array.from({ length: count }, (_, i) => ({
    id: `hall-${i}`,
    name: i ? 'South hall' : 'North hall',
    role: 'hall',
    geometry: geometry(i * 85 + 10, 10, 60, 70),
    hallIds: [],
    confirmed: false,
    restrictionsConfirmed: false,
    grid: { x: i * 85 + 10, y: 10, width: 2, height: 2, rotation: 0 },
    printedArea: 4200,
  }));
  const page: PlanPage = {
    number: 1,
    width: count * 85 + 30,
    height: 100,
    format: 'pdf-vector',
    preview: '',
    texts: [],
    regions,
    objects: [],
    calibration: {
      metresPerUnit: unknownScale ? null : 1,
      source: unknownScale ? 'Scale not established' : 'Drawing units',
      confirmed: !unknownScale,
    },
    grid: null,
    dimensions: [],
    legend: [],
    warnings: [],
  };
  return {
    id: 'test-document',
    fileName: 'Generic venue.pdf',
    revision: 1,
    status: 'ready',
    error: null,
    pages: [page],
    halls: [],
    committed: {},
  };
}
async function mockImport(
  page: Page,
  options: {
    count?: number;
    unknownScale?: boolean;
    missingEvidence?: boolean;
    separatePages?: boolean;
    failSecondOnce?: boolean;
    misclassifiedFoyer?: boolean;
    cadRestrictions?: boolean;
    helperCards?: boolean;
  } = {},
) {
  let current = document(options.count ?? 1, options.unknownScale ?? false);
  if (options.helperCards) {
    current.pages[0].legend = [
      { label: 'Columns', color: '#777777' },
      { label: 'Compulsory passage', color: '#00cc44' },
    ];
    current.pages[0].annotations = ['toilet-male', 'toilet-female', 'stairs'].map((kind, i) => ({
      id: 'helper-' + i,
      type: 'facility',
      kind,
      text: ['Toilet (Male)', 'Toilet (Female)', 'Stairs/Elevators'][i],
      anchor: [20 + i * 2, 10],
      regionIds: ['hall-0'],
      confirmed: true,
      evidence: { source: 'text', detail: 'Source facility label' },
    }));
  }
  if (options.cadRestrictions) {
    current.pages[0].objects = [
      {
        id: 'column',
        kind: 'column',
        label: 'CAD column',
        geometry: geometry(20, 20, 2, 2),
        color: '#777777',
        confirmed: false,
        evidence: { source: 'geometry', detail: 'CAD column layer' },
      },
      {
        id: 'uncertain',
        kind: 'unknown',
        label: 'Uncertain area',
        geometry: geometry(25, 25, 2, 2),
        color: '#ff0000',
        confirmed: false,
        evidence: { source: 'geometry', detail: 'Unclassified fill' },
      },
      {
        id: 'other',
        kind: 'column',
        label: 'Outside selected hall',
        geometry: geometry(200, 20, 2, 2),
        color: '#777777',
        confirmed: false,
        evidence: { source: 'geometry', detail: 'CAD column layer' },
      },
    ];
  }
  if (options.misclassifiedFoyer) {
    current.pages[0].regions[1].name = 'Entry foyer';
    current.pages[0].dimensions.push({
      id: 'foyer-dimension',
      label: 'Former hall dimension',
      a: [95, 10],
      b: [105, 10],
      metres: 10,
      regionId: 'hall-1',
      confirmed: true,
    });
  }
  if (options.separatePages) {
    const original = current.pages[0];
    current.pages = original.regions.map((r, i) => ({
      ...structuredClone(original),
      number: i + 1,
      width: 100,
      regions: [{ ...r, geometry: geometry(10, 10, 60, 70) }],
    }));
  }
  const patches: any[] = [];
  const commits: any[] = [];
  const recompute = () => {
    current.halls = current.pages.flatMap((p) =>
      p.regions
        .filter((r) => r.role === 'hall')
        .map((r) => {
          const key = `${p.number}:${r.id}`;
          const scale = p.calibration.metresPerUnit ?? 0;
          const check = (id: string, label: string, ok: boolean | null, overridable = false) => ({
            id: `${key}:${id}`,
            label,
            status: ok === null ? ('unknown' as const) : ok ? ('pass' as const) : ('fail' as const),
            detail: label,
            blocking: true,
            overridable,
          });
          const checks = [
            check('scale', 'Metric scale', !!scale && p.calibration.confirmed),
            check('boundary', 'Hall boundary reviewed', r.confirmed),
            check(
              'restrictions',
              'Restrictions and facilities reviewed',
              !!r.restrictionsConfirmed,
            ),
            check('grid', 'Grid pitch established', !!r.grid),
            check('geometry', 'Valid geometry', true),
          ];
          if (options.missingEvidence)
            checks.push(
              check('area', 'Printed hall area', null, true),
              check('dimensions', 'Source dimensions linked', false, true),
            );
          if (options.cadRestrictions)
            checks.push(
              check(
                'objects',
                'Area meanings confirmed',
                p.objects
                  .filter((o) => o.id !== 'other')
                  .every((o) => o.confirmed && o.kind !== 'unknown'),
              ),
            );
          return {
            key,
            page: p.number,
            regionId: r.id,
            name: r.name,
            width: 60 * scale,
            depth: 70 * scale,
            hallArea: 4200 * scale * scale,
            foyerArea: 0,
            drawableArea: 4200 * scale * scale,
            checks,
            ready: checks.every((c) => c.status === 'pass'),
            savedHallId: current.committed[key] ?? null,
            existing: [],
          } satisfies PlanReview;
        }),
    );
  };
  recompute();
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
    if (path.endsWith('/test-document/preview')) {
      const key = new URL(route.request().url()).searchParams.get('key');
      const h = current.halls.find((h) => h.key === key)!;
      const r = current.pages
        .find((p) => p.number === h.page)!
        .regions.find((r) => r.id === h.regionId)!;
      return route.fulfill({
        json: {
          review: h,
          diff: null,
          config: { data: [] },
          floor: h.width
            ? {
                schema: 'floor/1',
                areas: [],
                north: null,
                labels: options.helperCards
                  ? [{ text: r.name, x: 10, y: 75, width: 20, height: 2 }]
                  : [],
                iconGroups: options.helperCards
                  ? [
                      {
                        x: 10,
                        y: -7,
                        width: 27,
                        height: 4.5,
                        icons: current.pages[0]
                          .annotations!.filter((a) => a.confirmed)
                          .map((a) => ({ kind: a.kind, label: a.text })),
                      },
                    ]
                  : [],
                legend: current.pages[0].legend.map((l) => ({
                  ...l,
                  color: l.color,
                  showInView: true,
                })),
                width: h.width,
                depth: h.depth,
                geometry: {
                  schema: 'geometry/1',
                  unit: 'm',
                  boundary: geometry(0, 0, h.width, h.depth),
                  hallBoundary: geometry(0, 0, h.width, h.depth),
                  grid: { ...r.grid, x: 0, y: 0 },
                  objects: [],
                  zones: [],
                },
              }
            : null,
        },
      });
    }
    if (path.endsWith('/test-document/commit')) {
      const body = route.request().postDataJSON();
      commits.push(body);
      const results = body.selections.map((s: any) => {
        const h = current.halls.find((h) => h.key === s.key)!;
        if (
          !h.checks.every(
            (c) => c.status === 'pass' || (c.overridable && s.acknowledgements.includes(c.id)),
          )
        )
          return { key: s.key, error: 'Unresolved checks' };
        if (options.failSecondOnce && commits.length === 1 && s.key.endsWith('hall-1'))
          return { key: s.key, error: 'Temporary save failure. Please retry.' };
        const hallId = 'saved-' + s.key.replaceAll(':', '-');
        current.committed[s.key] = hallId;
        return { key: s.key, hallId, version: 1 };
      });
      recompute();
      return route.fulfill({ json: results });
    }
    if (path.endsWith('/floor-plans') && route.request().method() === 'POST')
      return route.fulfill({ json: { id: current.id } });
    if (path.endsWith('/floor-plans/test-document')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        patches.push(body);
        const { revision, page: pageNumber, ...changes } = body;
        current.pages = current.pages.map((p) =>
          p.number === pageNumber ? { ...p, ...changes } : p,
        );
        current.revision++;
        recompute();
      }
      return route.fulfill({ json: current });
    }
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return {
    patches,
    commits,
    deleteSavedHall(key: string) {
      delete current.committed[key];
      recompute();
    },
    get current() {
      return current;
    },
  };
}
async function openReview(page: Page, keepTour = false) {
  await page.goto('/venue/venues/venue-id/import-floor-plan?document=test-document');
  const tour = page.getByRole('dialog');
  await expect(tour.getByRole('heading', { name: 'Hall import tour' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Import from floor plan', includeHidden: true }),
  ).toBeVisible();
  await expect(page.getByText('Generic venue.pdf')).toBeVisible();
  if (!keepTour) {
    await tour.getByRole('button', { name: 'Back to import', exact: true }).click();
    await expect(tour).toHaveCount(0);
  }
}
async function confirmAndPreview(page: Page) {
  await page.getByLabel('Hall outline is correct', { exact: true }).check();
  await page.getByLabel('Columns, exits and restricted areas are correct', { exact: true }).check();
  await page.getByRole('button', { name: 'Preview imported hall', exact: false }).click();
  await expect(page.getByLabel('The imported hall looks correct', { exact: true })).toBeVisible();
  await page.getByLabel('The imported hall looks correct', { exact: true }).check();
}

test('single hall opens a guided review and saves edits automatically before preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await mockImport(page);
  await openReview(page);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'North hall', exact: true })).toBeVisible();
  await expect(page.getByText('Scale: metres per source unit', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply review edits' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Preview imported hall', exact: false }),
  ).toBeInViewport();
  await page.getByLabel('Hall name', { exact: true }).fill('Reviewed north hall');
  await confirmAndPreview(page);
  expect(api.patches).toHaveLength(1);
  expect(api.patches[0].regions[0].confirmed).toBe(true);
  expect(api.patches[0].preview).toBeUndefined();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
      if (el.scrollLeft) el.scrollLeft = 0;
    });
  });
  await expect(
    page.getByRole('button', { name: 'Continue to save', exact: false }),
  ).toBeInViewport();
  const contentOverflow = await page
    .locator('main')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(contentOverflow).toBe(false);
  await page.screenshot({ path: 'test-results/guided-floor-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await page.getByRole('button', { name: 'Save hall', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toBeVisible();
  expect(api.commits[0].selections[0].name).toBe('Reviewed north hall');
  expect(errors).toEqual([]);
});

test('multiple halls review one at a time and the second edit preserves the first inspection', async ({
  page,
}) => {
  const api = await mockImport(page, { count: 2 });
  await openReview(page);
  await expect(
    page.getByRole('heading', { name: 'Which halls do you want to import?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review selected halls', exact: false }).click();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Next hall', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'South hall', exact: true })).toBeVisible();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Save 2 halls', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save 2 halls', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(2);
  expect(api.commits[0].selections).toHaveLength(2);
});

test('re-uploading a saved plan reopens deleted halls and requires another visual review', async ({
  page,
}) => {
  const api = await mockImport(page, { count: 2 });
  const uploadAgain = () =>
    page.locator('.file-change input[type="file"]').setInputFiles({
      name: 'Generic venue.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('same plan'),
    });
  await openReview(page);
  await page.getByRole('button', { name: 'Review selected halls', exact: false }).click();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Next hall', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'South hall', exact: true })).toBeVisible();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await page.getByRole('button', { name: 'Save 2 halls', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(2);
  await uploadAgain();
  await expect(page.getByRole('heading', { name: 'Your halls are saved' })).toBeVisible();
  api.deleteSavedHall('1:hall-0');
  await uploadAgain();
  await expect(page.getByRole('heading', { name: 'North hall', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your halls are saved' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview imported hall', exact: false }).click();
  await expect(
    page.getByLabel('The imported hall looks correct', { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toBeDisabled();
  await page.getByLabel('The imported hall looks correct', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await page.getByRole('button', { name: 'Save hall', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(2);
  expect(api.commits[1].selections.map((s: any) => s.key)).toEqual(['1:hall-0']);
  api.deleteSavedHall('1:hall-0');
  api.deleteSavedHall('1:hall-1');
  await uploadAgain();
  await expect(
    page.getByRole('heading', { name: 'Which halls do you want to import?' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Review selected halls', exact: false }),
  ).toBeEnabled();
});

test('restriction review confirms recognised CAD objects while uncertain areas remain explicit', async ({
  page,
}) => {
  const api = await mockImport(page, { cadRestrictions: true });
  await openReview(page);
  await confirmAndPreview(page);
  expect(api.patches[0].objects.find((o: any) => o.id === 'column').confirmed).toBe(true);
  expect(api.patches[0].objects.find((o: any) => o.id === 'uncertain').confirmed).toBe(false);
  expect(api.patches[0].objects.find((o: any) => o.id === 'other').confirmed).toBe(false);
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toBeDisabled();
  await page.getByLabel('Meaning of Uncertain area').selectOption('no_build');
  await page.getByRole('button', { name: 'Preview imported hall', exact: false }).click();
  await page.getByLabel('The imported hall looks correct', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toBeEnabled();
  await page
    .getByLabel('Columns, exits and restricted areas are correct', { exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Preview imported hall', exact: false }).click();
  expect(
    api.patches
      .at(-1)
      .objects.filter((o: any) => o.id !== 'other')
      .every((o: any) => !o.confirmed),
  ).toBe(true);
});

test('imported preview renders exterior facility cards and a separate legend panel, and persists label edits', async ({
  page,
}) => {
  const api = await mockImport(page, { helperCards: true });
  await page.setViewportSize({ width: 1536, height: 1050 });
  await openReview(page);
  await page.getByText('Labels and facility cards (3)', { exact: true }).click();
  await page.getByLabel('Card or label text', { exact: true }).nth(2).fill('Stairs and elevators');
  await confirmAndPreview(page);
  const canvas = page.locator('app-three-plan');
  await expect(canvas.locator('[data-helper-kind="toilet-male"]')).toHaveText('Toilet (Male)');
  await expect(canvas.locator('[data-helper-kind="stairs"]')).toHaveText('Stairs and elevators');
  await canvas.locator('summary').filter({ hasText: 'Legends' }).click();
  await expect(canvas.getByText('Columns', { exact: true })).toBeVisible();
  const layout = await canvas.evaluate((el) => ({
    grid: el.querySelector('.canvas')!.getBoundingClientRect().right,
    legends: el.querySelector('.plan-legends')!.getBoundingClientRect().left,
  }));
  expect(layout.legends).toBeGreaterThanOrEqual(layout.grid);
  expect(api.patches[0].annotations[2].text).toBe('Stairs and elevators');
  await canvas.screenshot({ path: 'test-results/exterior-helper-cards.png' });
});

test('missing size asks for metres rather than source coordinates', async ({ page }) => {
  const api = await mockImport(page, { unknownScale: true });
  await openReview(page);
  await expect(page.getByLabel('Grid square width in metres')).toBeVisible();
  await page.getByLabel('Grid square width in metres').fill('2');
  await page.getByRole('button', { name: 'Use this grid size', exact: true }).click();
  await confirmAndPreview(page);
  expect(api.patches[0].calibration.metresPerUnit).toBe(1);
  expect(api.patches[0].calibration.confirmed).toBe(true);
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toBeEnabled();
});

test('measurement acknowledgements stay explicit and cannot be bypassed by the visual confirmation', async ({
  page,
}) => {
  const api = await mockImport(page, { missingEvidence: true });
  await openReview(page);
  await confirmAndPreview(page);
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toBeDisabled();
  await page
    .getByLabel('I checked the source and these measurements are unavailable', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await page.getByRole('button', { name: 'Save hall', exact: true }).click();
  expect(api.commits[0].selections[0].acknowledgements).toEqual([
    '1:hall-0:area',
    '1:hall-0:dimensions',
  ]);
});

test('correction tools are available on demand and mobile review has no horizontal overflow', async ({
  page,
}) => {
  await mockImport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page);
  await expect(page.getByRole('heading', { name: 'Make a correction', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Adjust outline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make a correction', exact: true })).toBeVisible();
  await expect(page.getByText('Advanced settings', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Scale: metres per source unit', { exact: true })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  const contentOverflow = await page
    .locator('main')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(contentOverflow).toBe(false);
  await page.screenshot({ path: 'test-results/guided-floor-mobile.png', fullPage: true });
});

test('halls on different pages retain their reviews and a partial save retries only the pending hall', async ({
  page,
}) => {
  const api = await mockImport(page, { count: 2, separatePages: true, failSecondOnce: true });
  await openReview(page);
  await page.getByRole('button', { name: 'Review selected halls', exact: false }).click();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Next hall', exact: false }).click();
  await expect(page.getByText('Hall 2 of 2 · Page 2', { exact: true })).toBeVisible();
  await confirmAndPreview(page);
  await page.getByRole('button', { name: 'Continue to save', exact: false }).click();
  await page.getByRole('button', { name: 'Save 2 halls', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(1);
  await expect(
    page.getByText('South hall: Temporary save failure. Please retry.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save hall', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save hall', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open saved hall' })).toHaveCount(2);
  expect(api.commits[1].selections.map((s: any) => s.key)).toEqual(['2:hall-1']);
});

test('a visual confirmation cannot bypass an unknown metric scale', async ({ page }) => {
  await mockImport(page, { unknownScale: true });
  await openReview(page);
  await page.getByLabel('Hall outline is correct', { exact: true }).check();
  await page.getByLabel('Columns, exits and restricted areas are correct', { exact: true }).check();
  await page.getByRole('button', { name: 'Preview imported hall', exact: false }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Set the size of the plan before previewing this hall.' }),
  ).toBeVisible();
  await expect(page.getByLabel('The imported hall looks correct', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue to save', exact: false })).toHaveCount(0);
});

test('a fresh floor-plan screen opens the upload tour on every screen load', async ({ page }) => {
  const api = await mockImport(page);
  await page.goto('/venue/venues/venue-id/import-floor-plan');
  const tour = page.getByRole('dialog');
  await expect(tour.getByRole('heading', { name: 'Upload your plan', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Back to import', exact: true }).click();
  await expect(page.getByLabel('Choose floor plan file')).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(tour.getByRole('heading', { name: 'Upload your plan', exact: true })).toBeVisible();
  expect(api.patches).toHaveLength(0);
  expect(api.commits).toHaveLength(0);
});

test('import tour opens automatically, explains pending actions and locates a control without confirming the hall', async ({
  page,
}) => {
  const api = await mockImport(page);
  await openReview(page, true);
  const tour = page.getByRole('dialog');
  await expect(tour.getByRole('heading', { name: 'Hall import tour' })).toBeVisible();
  await expect(
    tour.getByRole('heading', { name: 'Review the hall outline', exact: true }),
  ).toBeVisible();
  await expect(tour.getByText('Pending in your current import', { exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Next topic', exact: false }).click();
  await expect(
    tour.getByRole('heading', { name: 'Keep foyers separate and linked' }),
  ).toBeVisible();
  await expect(
    tour.getByRole('img', { name: 'A hall in green and its separate linked foyer in blue' }),
  ).toBeVisible();
  await tour.getByRole('button', { name: 'Hinglish', exact: true }).click();
  await expect(
    tour.getByRole('heading', { name: 'Foyer ka type aur hall link sahi rakho' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'test-results/import-tour.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await tour.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
  await tour.getByRole('button', { name: 'Show on page', exact: false }).click();
  await expect(tour).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add or link a foyer', exact: true }),
  ).toBeInViewport();
  await expect(page.getByLabel('Hall outline is correct', { exact: true })).not.toBeChecked();
  expect(api.patches).toHaveLength(0);
  expect(api.commits).toHaveLength(0);
});

test('a misclassified hall can become a foyer linked to the actual hall', async ({ page }) => {
  const api = await mockImport(page, { count: 2, misclassifiedFoyer: true });
  await openReview(page);
  await page.getByRole('button', { name: 'Review selected halls', exact: false }).click();
  await page.getByRole('button', { name: 'Adjust outline', exact: true }).click();
  await page.getByLabel('Shape to correct', { exact: true }).selectOption('hall-1');
  await page.getByLabel('Shape type', { exact: true }).selectOption('foyer');
  await expect(page.getByRole('group', { name: 'Foyer belongs to' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Foyer belongs to' }).getByLabel('North hall'),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(api.patches[0].regions.find((r: any) => r.id === 'hall-1')).toMatchObject({
    role: 'foyer',
    hallIds: ['hall-0'],
    confirmed: false,
  });
  expect(api.patches[0].dimensions).toEqual([]);
  await expect(
    page.getByLabel('Entry foyer outline and hall links are correct', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Change hall selection', exact: true }).click();
  await expect(page.getByLabel('Include Entry foyer', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Include North hall', { exact: true })).toBeVisible();
});
