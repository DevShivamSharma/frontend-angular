import { expect, Page, test } from '@playwright/test';

const PLAN_URL = '/venue/events/e1/halls/h1/plan';
const EVERY = ['layouts.view', 'layouts.edit', 'layouts.approve', 'layouts.publish', 'rules.view'];

const floor = {
  schema: 'floor/1',
  width: 40,
  depth: 30,
  areas: [{ kind: 'column', x: 20, y: 15, width: 1, height: 1 }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

const rules = [
  { id: 'sizeStep', state: 'checked', violations: 0, overridden: 0 },
  { id: 'stallOverlap', state: 'checked', violations: 0, overridden: 0 },
  { id: 'maxUtilization', state: 'off', violations: 0, overridden: 0 },
];

const catalogue = {
  rules: [
    ['sizeStep', 'Size step'],
    ['stallOverlap', 'Stalls overlap'],
    ['maxUtilization', 'Floor use'],
  ].map(([id, label]) => ({
    id,
    label,
    description: '',
    reference: 'ITPO 4.1',
    group: 'stalls',
    available: true,
  })),
  limits: [],
  profiles: [],
};

const firstStall = {
  id: 's1',
  number: '1',
  x: 2,
  y: 2,
  width: 3,
  depth: 3,
  area: 9,
  openSides: ['bottom'],
  stallType: 'shell',
};

/** A stall plan as the API returns it: a saved draft at revision 3 that passes the rules. */
function planView(change: Record<string, unknown> = {}): any {
  return {
    id: 'plan-1',
    event: { id: 'e1', name: 'World Book Fair', status: 'scheduled', eventType: 'B2C' },
    hall: { id: 'h1', name: 'Hall 5', floorVersion: 2, currentVersion: 3 },
    status: 'draft',
    revision: 3,
    stalls: [firstStall],
    overrides: [],
    approvedAt: null,
    publishedAt: null,
    activeBookings: 0,
    floor,
    report: { passed: true, violations: [], rules, utilisation: 0.05 },
    ...change,
  };
}

type Reply = { status?: number; json: unknown };

/**
 * A signed-in member of `venue` with the given permissions, and one event hall's plan. Saves
 * and steps answer with `put` / `step` when given; otherwise they succeed as the backend would.
 */
async function mockPlan(
  page: Page,
  options: {
    permissions: string[];
    plan: any;
    put?: (body: any) => Reply;
    step?: (step: string, body: any) => Reply;
  },
) {
  const calls = { gets: 0, puts: [] as any[], steps: [] as { step: string; body: any }[] };
  let current = options.plan;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const user = { id: 'u', name: 'Planner', email: 'planner@test.local', isPlatformAdmin: false };
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
            bookingMode: 'own_portal',
          },
          membership: { id: 'm', role: { id: 'r', name: 'Planner' }, scope: {} },
          permissions: options.permissions,
        },
      });
    if (path.endsWith('/rules/catalogue')) return route.fulfill({ json: catalogue });
    if (path.endsWith('/events/e1/halls/h1/plan') && request.method() === 'GET') {
      calls.gets++;
      return route.fulfill({ json: current });
    }
    if (path.endsWith('/events/e1/halls/h1/plan') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      calls.puts.push(body);
      const reply: Reply = options.put?.(body) ?? {
        json: planView({
          revision: body.revision + 1,
          stalls: body.stalls.map((s: any, i: number) => ({
            ...s,
            id: s.id ?? `saved-${i}`,
            area: s.width * s.depth,
          })),
          overrides: body.overrides,
        }),
      };
      if (!reply.status) current = reply.json;
      return route.fulfill(reply);
    }
    const step = /\/plan\/(approve|publish|reopen)$/.exec(path)?.[1];
    if (step) {
      const body = request.postDataJSON();
      calls.steps.push({ step, body });
      const status = { approve: 'approved', publish: 'published', reopen: 'draft' }[step];
      const reply: Reply = options.step?.(step, body) ?? {
        json: { ...current, status, revision: body.revision + 1 },
      };
      if (!reply.status) current = reply.json;
      return route.fulfill(reply);
    }
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return calls;
}

test('a draft plan opens on its floor, takes a new stall and saves it at its revision', async ({
  page,
}) => {
  const calls = await mockPlan(page, { permissions: EVERY, plan: planView() });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PLAN_URL);

  await expect(page.getByRole('heading', { name: 'Stall plan · Hall 5' })).toBeVisible();
  await expect(page.getByText('World Book Fair', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Scheduled event', { exact: true })).toBeVisible();
  await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Floor version 2 (hall is now at 3)', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Floor of Hall 5 with its stalls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.getByLabel('New stall x', { exact: true }).fill('10');
  await page.getByLabel('New stall y', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add stall', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stall 2', exact: true })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByLabel('Stall type', { exact: true }).click();
  await page.getByRole('option', { name: 'Bare space', exact: true }).click();

  // A click on open floor (two thirds across and down) places one more, with the next number.
  const floorImage = page.getByRole('img', { name: 'Floor of Hall 5 with its stalls' });
  const box = (await floorImage.boundingBox())!;
  await floorImage.click({ position: { x: box.width * 0.66, y: box.height * 0.66 } });
  await expect(page.getByRole('button', { name: 'Stall 3', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Plan saved. It passes the rules.')).toBeVisible();
  expect(calls.puts).toHaveLength(1);
  expect(calls.puts[0]).toMatchObject({
    revision: 3,
    stalls: [
      { id: 's1', number: '1', x: 2, y: 2, width: 3, depth: 3, openSides: ['bottom'] },
      {
        number: '2',
        x: 10,
        y: 4,
        width: 3,
        depth: 3,
        openSides: ['bottom'],
        stallType: 'bare',
      },
      { number: '3', width: 3, depth: 3 },
    ],
    overrides: [],
  });
  expect(calls.puts[0].stalls[1].id).toBeUndefined();
  // Placed where clicked, its corner on a whole metre (viewBox -2 to 42 by -2 to 32).
  const placed = calls.puts[0].stalls[2];
  expect(Number.isInteger(placed.x) && Number.isInteger(placed.y)).toBe(true);
  expect(placed.x).toBeGreaterThanOrEqual(25);
  expect(placed.x).toBeLessThanOrEqual(29);
  expect(placed.y).toBeGreaterThanOrEqual(18);
  expect(placed.y).toBeLessThanOrEqual(22);
  await expect(page.getByText('Revision 4', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a violation picks its stall and is set aside with a reason saved with the plan', async ({
  page,
}) => {
  const violation = {
    ruleId: 'sizeStep',
    reference: 'ITPO 4.1',
    message: 'Stall 1 is not on the 1 m size step.',
    stallIds: ['s1'],
    areas: [{ x: 2, y: 2, width: 3, height: 3 }],
    overridden: null,
  };
  const calls = await mockPlan(page, {
    permissions: EVERY,
    plan: planView({
      report: { passed: false, violations: [violation], rules, utilisation: 0.05 },
    }),
  });
  await page.goto(PLAN_URL);

  await expect(page.getByText('1 to fix', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Show on the floor: Stall 1 is not on the 1 m size step.' })
    .click();
  await expect(page.getByRole('heading', { name: 'Stall 1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Set aside…', exact: true }).click();
  await page.getByLabel('Reason (shown at approval)').fill('Corner stall, agreed with the venue');
  await page.getByRole('button', { name: 'Set aside', exact: true }).click();
  const setAside = page.getByRole('region', { name: 'Rules set aside' });
  await expect(setAside.getByText('Stall 1', { exact: true })).toBeVisible();
  await expect(setAside.getByText('Corner stall, agreed with the venue')).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Revision 4', { exact: true })).toBeVisible();
  expect(calls.puts[0]).toMatchObject({
    revision: 3,
    overrides: [
      { ruleId: 'sizeStep', stallIds: ['s1'], reason: 'Corner stall, agreed with the venue' },
    ],
  });
});

test('a saved draft is approved, then published to booking', async ({ page }) => {
  const calls = await mockPlan(page, { permissions: EVERY, plan: planView() });
  await page.goto(PLAN_URL);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Plan approved.')).toBeVisible();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add stall', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Publish to booking', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen as draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish to booking', exact: true })).toHaveCount(
    0,
  );
  expect(calls.steps).toEqual([
    { step: 'approve', body: { revision: 3 } },
    { step: 'publish', body: { revision: 4 } },
  ]);
});

test('approving a plan that breaks the rules shows the reason the server gives', async ({
  page,
}) => {
  const message =
    'The plan breaks 1 rule check(s). Fix them, or set them aside with a reason, before approving.';
  await mockPlan(page, {
    permissions: EVERY,
    plan: planView(),
    step: () => ({ status: 409, json: { status: 409, message } }),
  });
  await page.goto(PLAN_URL);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload plan', exact: true })).toBeVisible();
});

test('a member who only sees layouts reads a published plan', async ({ page }) => {
  await mockPlan(page, {
    permissions: ['layouts.view'],
    plan: planView({ status: 'published', revision: 5, publishedAt: '2026-10-01T10:00:00Z' }),
  });
  await page.goto(PLAN_URL);

  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText('Published to booking.', { exact: true })).toBeVisible();
  for (const name of [
    'Save',
    'Approve',
    'Publish to booking',
    'Reopen as draft',
    'Delete draft',
    'Add stall',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Stall 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stall 1', exact: true })).toBeVisible();
  await expect(page.getByText('Shell scheme', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Stall number')).toHaveCount(0);
});

test('a stale save explains itself and reloads the plan', async ({ page }) => {
  const message = 'The plan changed since you opened it. Reload it first.';
  const calls = await mockPlan(page, {
    permissions: EVERY,
    plan: planView(),
    put: () => ({ status: 409, json: { status: 409, message } }),
  });
  await page.goto(PLAN_URL);

  await page.getByRole('button', { name: 'Add stall', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  expect(calls.puts[0].revision).toBe(3);

  await page.getByRole('button', { name: 'Reload plan', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: message })).toHaveCount(0);
  expect(calls.gets).toBe(2);
});

test('a hall with no plan yet invites the first stall', async ({ page }) => {
  await mockPlan(page, {
    permissions: EVERY,
    plan: planView({ id: null, revision: 0, stalls: [] }),
  });
  await page.goto(PLAN_URL);
  await expect(page.getByText('No stalls yet. Add the first one.', { exact: true })).toBeVisible();
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete draft', exact: true })).toHaveCount(0);
});
