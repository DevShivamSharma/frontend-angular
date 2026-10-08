import { expect, Page, test } from '@playwright/test';

const ALL = [
  'venues.view',
  'events.view',
  'events.manage',
  'layouts.view',
  'bookings.view',
  'bookings.manage',
  'team.view',
  'team.invite',
  'team.manage',
];
const date = '2026-10-08T00:00:00Z';
const venue = { id: 'venue-1', name: 'Bharat Mandapam', code: 'BM', address: null, hallCount: 3 };

function event(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    code: null,
    kind: 'internal',
    eventType: 'B2B',
    status: 'draft',
    startsOn: '2030-11-14',
    endsOn: '2030-11-27',
    venue: { id: venue.id, name: venue.name },
    organiser: { name: null, email: null, phone: null },
    description: null,
    cancelledReason: null,
    hallCount: 0,
    createdAt: date,
    updatedAt: date,
    ...extra,
  };
}

const hall = (id: string, name: string, floorVersion: number, currentVersion: number) => ({
  hallId: id,
  name,
  code: null,
  level: null,
  width: 60,
  depth: 40,
  floorArea: 2400,
  floorVersion,
  currentVersion,
});

const exhibitor = (id: string, name: string, eventIds: string[]) => ({
  id,
  name,
  contactName: null,
  email: null,
  phone: null,
  gstin: null,
  address: null,
  eventIds,
  createdAt: date,
});

interface Call {
  method: string;
  path: string;
  query: string;
  body: any;
}

/** A signed-in member of `itpo`; the API keeps a little state so writes show up on reload. */
async function mockApi(
  page: Page,
  options: { permissions?: string[]; scope?: Record<string, unknown> } = {},
) {
  const calls: Call[] = [];
  const events = [
    event('evt-1', 'India Book Fair', {
      hallCount: 1,
      organiser: { name: 'NBT', email: 'fair@nbt.test', phone: null },
    }),
    event('evt-2', 'Trade Fair', { status: 'scheduled', startsOn: '2030-11-10' }),
  ];
  let detail = { ...events[0], halls: [hall('hall-1', 'Hall 1', 1, 2)] };
  const exhibitors = [
    exhibitor('x-1', 'Acme Books', ['evt-1']),
    exhibitor('x-2', 'Paper Mill', ['evt-2']),
  ];
  const user = { id: 'u', name: 'Asha Rao', email: 'asha@itpo.test', isPlatformAdmin: false };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    calls.push({ method, path, query: url.search, body });
    const json = (value: unknown) => route.fulfill({ json: value });

    if (path === '/auth/refresh') return json({ accessToken: 'mock', expiresIn: 3600, user });
    if (path === '/auth/me') return json({ user, memberships: [] });
    if (path === '/orgs/itpo/public-config')
      return json({
        slug: 'itpo',
        name: 'Bharat Mandapam (ITPO)',
        branding: {
          primaryColor: '#0b5394',
          accentColor: null,
          fontFamily: 'Inter',
          logoUrl: null,
          logoDarkUrl: null,
          faviconUrl: null,
        },
        locale: { defaultLanguage: 'en', languages: ['en'] },
      });
    if (path === '/orgs/itpo/context')
      return json({
        organisation: {
          id: 'org',
          slug: 'itpo',
          name: 'Bharat Mandapam (ITPO)',
          bookingMode: 'own_portal',
          features: { aiAssist: false, pdfPlot: false, exhibitorPortal: true, wayfinding: false },
        },
        membership: {
          id: 'm-self',
          role: {
            id: 'r-admin',
            key: 'venue_admin',
            name: 'Venue Admin',
            scopeKind: options.scope?.eventIds ? 'event' : 'organisation',
          },
          scope: options.scope ?? {},
        },
        permissions: options.permissions ?? ALL,
      });
    if (path === '/orgs/itpo/venues') return json([venue]);

    if (path === '/orgs/itpo/events' && method === 'POST') {
      const created = event('evt-new', body.name, { ...body, venue: detail.venue });
      return json(created);
    }
    if (path === '/orgs/itpo/events') {
      const status = url.searchParams.get('status');
      return json(status ? events.filter((e) => e.status === status) : events);
    }
    if (path === '/orgs/itpo/events/evt-new')
      return json({ ...event('evt-new', 'New'), halls: [] });
    if (path === '/orgs/itpo/events/evt-1/status') {
      detail = { ...detail, status: body.status };
      const { halls, ...view } = detail;
      return json(view);
    }
    if (path === '/orgs/itpo/events/evt-1/hall-options')
      return json([
        { hallId: 'hall-1', name: 'Hall 1', code: null, booked: true, conflicts: [] },
        {
          hallId: 'hall-2',
          name: 'Hall 2',
          code: null,
          booked: false,
          conflicts: [
            { eventId: 'evt-2', name: 'Trade Fair', startsOn: '2030-11-10', endsOn: '2030-11-27' },
          ],
        },
        { hallId: 'hall-3', name: 'Hall 3', code: 'H3', booked: false, conflicts: [] },
      ]);
    if (path === '/orgs/itpo/events/evt-1/halls/hall-3' && method === 'PUT') {
      detail = {
        ...detail,
        hallCount: 2,
        halls: [...detail.halls, hall('hall-3', 'Hall 3', 4, 4)],
      };
      return json(detail);
    }
    if (path === '/orgs/itpo/events/evt-1/plans')
      return json(
        detail.halls.map((h, i) => ({
          hallId: h.hallId,
          hallName: h.name,
          planId: i ? null : 'plan-1',
          status: i ? null : 'draft',
          revision: i ? 0 : 3,
          stallCount: i ? 0 : 42,
          activeBookings: 0,
        })),
      );
    if (path === '/orgs/itpo/events/evt-1') return json(detail);

    if (path === '/orgs/itpo/exhibitors' && method === 'POST') {
      const created = exhibitor('x-new', body.name, body.eventId ? [body.eventId] : []);
      exhibitors.push({ ...created, ...body, eventIds: created.eventIds });
      return json(created);
    }
    if (path === '/orgs/itpo/exhibitors') {
      const eventId = url.searchParams.get('eventId');
      return json(eventId ? exhibitors.filter((x) => x.eventIds.includes(eventId)) : exhibitors);
    }

    if (path === '/orgs/itpo/members')
      return json([
        {
          id: 'm-self',
          user: { id: 'u', name: 'Asha Rao', email: 'asha@itpo.test', lastLoginAt: null },
          role: { id: 'r-admin', key: 'venue_admin', name: 'Venue Admin' },
          scope: {},
          joinedAt: date,
        },
        {
          id: 'm-2',
          user: { id: 'u2', name: 'Ravi Kumar', email: 'ravi@acme.test', lastLoginAt: null },
          role: { id: 'r-exhibitor', key: 'exhibitor', name: 'Exhibitor' },
          scope: { eventIds: ['evt-1'], exhibitorId: 'x-1' },
          joinedAt: date,
        },
      ]);
    if (path === '/orgs/itpo/roles') {
      const role = (id: string, key: string, name: string, scopeKind: string, p: string[]) => ({
        id,
        key,
        name,
        description: null,
        scopeKind,
        permissions: p,
        isSystem: true,
        isLocked: key === 'venue_admin',
        organisation: null,
        assignable: true,
        reason: null,
      });
      return json([
        role('r-admin', 'venue_admin', 'Venue Admin', 'organisation', ALL),
        role('r-architect', 'venue_architect', 'Venue Architect', 'organisation', ['venues.view']),
        role('r-organiser', 'organiser_architect', 'Organiser Architect', 'event', [
          'events.view',
          'layouts.view',
        ]),
        role('r-exhibitor', 'exhibitor', 'Exhibitor', 'event', ['layouts.view', 'stalls.book']),
      ]);
    }
    if (path === '/orgs/itpo/invitations' && method === 'POST')
      return json({
        id: 'inv-1',
        email: body.email,
        role: { id: body.roleId, key: 'exhibitor', name: 'Exhibitor' },
        scope: { eventIds: body.eventIds, exhibitorId: body.exhibitorId },
        invitedBy: { name: 'Asha Rao', email: 'asha@itpo.test' },
        createdAt: date,
        expiresAt: date,
        expired: false,
        inviteUrl: 'http://localhost/itpo/accept-invite?token=abc',
      });
    if (path === '/orgs/itpo/invitations') return json([]);

    return route.fulfill({ status: 404, json: { status: 404, message: 'Not mocked ' + path } });
  });
  return calls;
}

test('the events list filters by status and creates an event', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/itpo/events');

  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Events', exact: true })).toBeVisible();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'India Book Fair' })).toContainText('Draft');
  await expect(rows.filter({ hasText: 'Trade Fair' })).toContainText('Scheduled');

  await page.getByRole('radio', { name: 'Scheduled' }).click();
  await expect(rows.filter({ hasText: 'India Book Fair' })).toHaveCount(0);
  expect(calls.some((c) => c.path === '/orgs/itpo/events' && c.query === '?status=scheduled')).toBe(
    true,
  );

  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Auto Expo');
  await expect(dialog.getByRole('combobox', { name: 'Venue' })).toContainText('Bharat Mandapam');
  await dialog.getByRole('combobox', { name: 'Kind' }).click();
  await page.getByRole('option', { name: 'External' }).click();
  await dialog.getByLabel('First day').fill('2030-12-02');
  await dialog.getByLabel('Last day').fill('2030-12-01');
  await dialog.getByRole('button', { name: 'Create event' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The last day cannot be before the first day.',
  );
  await dialog.getByLabel('Last day').fill('2030-12-05');
  await dialog.getByLabel('Organiser email').fill('expo@siam.test');
  await dialog.getByRole('button', { name: 'Create event' }).click();

  await expect(page).toHaveURL(/\/itpo\/events\/evt-new$/);
  const created = calls.find((c) => c.method === 'POST' && c.path === '/orgs/itpo/events');
  expect(created?.body).toEqual({
    venueId: 'venue-1',
    name: 'Auto Expo',
    code: null,
    kind: 'external',
    eventType: 'B2B',
    startsOn: '2030-12-02',
    endsOn: '2030-12-05',
    organiserName: null,
    organiserEmail: 'expo@siam.test',
    organiserPhone: null,
    description: null,
  });
});

test('an event-scoped member cannot create events', async ({ page }) => {
  await mockApi(page, { scope: { eventIds: ['evt-1'] } });
  await page.goto('/itpo/events');
  await expect(page.getByRole('row').filter({ hasText: 'India Book Fair' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0);
});

test('the event page schedules the event and books a free hall, not a taken one', async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.goto('/itpo/events/evt-1');

  await expect(page.getByRole('heading', { name: 'India Book Fair' })).toBeVisible();
  await expect(page.getByText("The hall's floor is now version 2")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bookings' })).toHaveAttribute(
    'href',
    '/itpo/events/evt-1/bookings',
  );
  await expect(page.getByRole('link', { name: 'Open the plan of Hall 1' })).toHaveAttribute(
    'href',
    '/itpo/events/evt-1/halls/hall-1/plan',
  );
  await expect(page.getByText('Acme Books')).toBeVisible();

  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();
  expect(calls.find((c) => c.path === '/orgs/itpo/events/evt-1/status')?.body).toEqual({
    status: 'scheduled',
  });
  await expect(page.getByRole('button', { name: 'Back to draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add hall' }).click();
  const taken = page.getByRole('menuitem', { name: /Hall 2/ });
  await expect(taken).toBeDisabled();
  await expect(taken).toContainText('Booked by Trade Fair');
  await expect(page.getByRole('menuitem', { name: /Hall 1/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: /Hall 3/ }).click();

  await expect(page.getByText('Hall 3 added to India Book Fair.')).toBeVisible();
  expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/halls/hall-3'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Halls (2)' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Hall 3' })).toContainText('Not started');
});

test('an exhibitor is created and registered for an event', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/itpo/exhibitors');

  await expect(page.getByRole('row').filter({ hasText: 'Acme Books' })).toContainText(
    'India Book Fair',
  );
  await page.getByRole('button', { name: 'New exhibitor' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company name').fill('Lotus Prints');
  await dialog.getByLabel('Contact name').fill('Meera Shah');
  await dialog.getByLabel('Email').fill('meera@lotus.test');
  await dialog.getByLabel('GSTIN').fill('07AAACI1681G1ZN');
  await dialog.getByRole('combobox', { name: 'Register for event' }).click();
  await page.getByRole('option', { name: 'Trade Fair' }).click();
  await dialog.getByRole('button', { name: 'Create exhibitor' }).click();

  await expect(page.getByText('Lotus Prints created.')).toBeVisible();
  expect(
    calls.find((c) => c.method === 'POST' && c.path === '/orgs/itpo/exhibitors')?.body,
  ).toEqual({
    name: 'Lotus Prints',
    contactName: 'Meera Shah',
    email: 'meera@lotus.test',
    phone: null,
    gstin: '07AAACI1681G1ZN',
    address: null,
    eventId: 'evt-2',
  });
  await expect(page.getByRole('row').filter({ hasText: 'Lotus Prints' })).toContainText(
    'Trade Fair',
  );
});

test('an event role is invited for its events and the exhibitor it books for', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/itpo/team');

  const ravi = page.getByRole('row').filter({ hasText: 'Ravi Kumar' });
  await expect(ravi).toContainText('Event: India Book Fair');
  await expect(ravi).toContainText('Exhibitor: Acme Books');

  await page.getByRole('button', { name: 'Invite' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill('new@acme.test');
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Exhibitor' }).click();

  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByText('Choose the events this person works on')).toBeVisible();
  expect(calls.some((c) => c.method === 'POST' && c.path === '/orgs/itpo/invitations')).toBe(false);

  await dialog.getByRole('combobox', { name: 'Events' }).click();
  await page.getByRole('option', { name: 'India Book Fair' }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('combobox', { name: 'Exhibitor' }).click();
  await expect(page.getByRole('option')).toHaveText(['Acme Books']);
  await page.getByRole('option', { name: 'Acme Books' }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  await expect(dialog.getByText('new@acme.test is invited as Exhibitor.')).toBeVisible();
  await expect(dialog.getByText('Exhibitor: Acme Books')).toBeVisible();
  expect(
    calls.find((c) => c.method === 'POST' && c.path === '/orgs/itpo/invitations')?.body,
  ).toEqual({
    email: 'new@acme.test',
    roleId: 'r-exhibitor',
    eventIds: ['evt-1'],
    exhibitorId: 'x-1',
  });
});

test('a whole-organisation role is invited without events', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/itpo/team');
  await page.getByRole('button', { name: 'Invite' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill('architect@itpo.test');
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Venue Architect' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Events' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByText('architect@itpo.test is invited as')).toBeVisible();
  expect(
    calls.find((c) => c.method === 'POST' && c.path === '/orgs/itpo/invitations')?.body,
  ).toEqual({ email: 'architect@itpo.test', roleId: 'r-architect' });
});

test('the event routes leave the plan and bookings pages under an event to their own routes', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/itpo/events/evt-1');
  await page.getByRole('link', { name: 'Open the plan of Hall 1' }).click();
  await expect(page).toHaveURL(/\/itpo\/events\/evt-1\/halls\/hall-1\/plan$/);
  await page.goto('/itpo/events/evt-1/bookings');
  await expect(page).toHaveURL(/\/itpo\/events\/evt-1\/bookings$/);
});
