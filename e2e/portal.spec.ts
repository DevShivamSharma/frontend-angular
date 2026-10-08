import { expect, Page, test } from '@playwright/test';

const floor = {
  schema: 'floor/1',
  width: 30,
  depth: 20,
  areas: [],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

const stalls = [
  { id: 's1', number: 'A1', x: 2, y: 2, width: 3, depth: 3 },
  { id: 's2', number: 'A2', x: 6, y: 2, width: 3, depth: 3 },
  { id: 's3', number: 'A3', x: 10, y: 2, width: 3, depth: 3 },
  { id: 's4', number: 'A4', x: 14, y: 2, width: 3, depth: 3 },
].map((s) => ({ ...s, area: 9, openSides: ['bottom'], stallType: null }));

interface Booking {
  id: string;
  stallId: string;
  own: boolean;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired';
  note: string | null;
}

/**
 * A signed-in exhibitor user of Acme Corp, registered for `ev1`. Its own A2 is held and A4
 * confirmed; A3 is another exhibitor's. Records every portal booking call.
 */
async function mockPortal(page: Page, options: { closedReason?: string } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const bookings: Booking[] = [
    { id: 'b1', stallId: 's2', own: true, status: 'held', note: null },
    { id: 'b2', stallId: 's3', own: false, status: 'held', note: null },
    { id: 'b3', stallId: 's4', own: true, status: 'confirmed', note: null },
  ];
  const event = { id: 'ev1', name: 'Tech Expo', status: 'scheduled' };
  const closedReason = options.closedReason ?? null;
  const active = (stallId: string) =>
    bookings.find((b) => b.stallId === stallId && ['held', 'confirmed'].includes(b.status));
  const view = (b: Booking) => {
    const stall = stalls.find((s) => s.id === b.stallId)!;
    return {
      id: b.id,
      event,
      hall: { id: 'h1', name: 'Hall 1' },
      stall: {
        id: stall.id,
        number: stall.number,
        area: stall.area,
        openSides: stall.openSides,
        stallType: null,
      },
      exhibitor: { id: 'x1', name: 'Acme Corp' },
      channel: 'external',
      status: b.status,
      paymentStatus: null,
      note: b.note,
      externalRef: null,
      cancelReason: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      confirmedAt: null,
      cancelledAt: null,
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const user = { id: 'u', name: 'Asha', email: 'asha@acme.test', isPlatformAdmin: false };
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ json: { accessToken: 'mock', expiresIn: 3600, user } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { user, memberships: [] } });
    if (path.endsWith('/public-config'))
      return route.fulfill({
        json: {
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
        },
      });
    if (path.endsWith('/context'))
      return route.fulfill({
        json: {
          organisation: {
            id: 'org',
            slug: 'itpo',
            name: 'Bharat Mandapam (ITPO)',
            features: { exhibitorPortal: !closedReason },
            bookingMode: 'own_portal',
          },
          membership: {
            id: 'm',
            role: { id: 'r', key: 'exhibitor', name: 'Exhibitor' },
            scope: { eventIds: ['ev1'] },
          },
          permissions: ['layouts.view', 'stalls.book'],
        },
      });
    if (path === '/api/orgs/itpo/portal')
      return route.fulfill({
        json: {
          exhibitor: { id: 'x1', name: 'Acme Corp' },
          bookingMode: 'own_portal',
          closedReason,
          events: [
            {
              ...event,
              startsOn: '2026-11-10',
              endsOn: '2026-11-14',
              venue: 'Bharat Mandapam',
              halls: [
                {
                  hallId: 'h1',
                  name: 'Hall 1',
                  published: true,
                  freeStalls: stalls.filter((s) => !active(s.id)).length,
                },
                { hallId: 'h2', name: 'Hall 2', published: false, freeStalls: 0 },
              ],
            },
          ],
        },
      });
    if (path === '/api/orgs/itpo/portal/events/ev1/halls/h1/stalls')
      return route.fulfill({
        json: {
          event: { ...event, eventType: 'B2B' },
          hall: { id: 'h1', name: 'Hall 1', floorVersion: 1 },
          bookable: !closedReason,
          floor,
          stalls: stalls.map((s) => {
            const b = active(s.id);
            return {
              ...s,
              state: !b ? 'free' : b.status === 'held' ? 'held' : 'booked',
              // Another exhibitor's booking comes without a name.
              booking: b?.own ? { id: b.id, exhibitor: 'Acme Corp', own: true } : null,
            };
          }),
        },
      });
    if (path === '/api/orgs/itpo/portal/bookings' && method === 'GET')
      return route.fulfill({ json: bookings.filter((b) => b.own).map(view) });
    if (path === '/api/orgs/itpo/portal/bookings' && method === 'POST') {
      const body = request.postDataJSON();
      calls.push({ method, path, body });
      const booking: Booking = {
        id: `b${bookings.length + 1}`,
        stallId: body.stallId,
        own: true,
        status: 'held',
        note: body.note,
      };
      bookings.push(booking);
      return route.fulfill({ status: 201, json: view(booking) });
    }
    const cancel = /^\/api\/orgs\/itpo\/portal\/bookings\/(\w+)\/cancel$/.exec(path);
    if (cancel && method === 'POST') {
      calls.push({ method, path, body: request.postDataJSON() });
      const booking = bookings.find((b) => b.id === cancel[1])!;
      booking.status = 'cancelled';
      return route.fulfill({ json: view(booking) });
    }
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { calls };
}

test('an exhibitor sees its own stalls, others only as taken, and holds a free one', async ({
  page,
}) => {
  const api = await mockPortal(page);
  await page.goto('/itpo/portal');

  await expect(page.getByRole('heading', { name: 'Acme Corp' })).toBeVisible();
  await expect(page.getByText('Stall plan not published yet')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('portal.png'), fullPage: true });
  await page.getByRole('link', { name: /Hall 1.*1 free stall/ }).click();

  await expect(page.getByRole('heading', { name: 'Hall 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stall A2, yours (held)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stall A4, yours (booked)' })).toBeVisible();
  await page.getByRole('button', { name: 'Stall A3, taken' }).click();
  const side = page.getByRole('complementary', { name: 'Selected stall' });
  await expect(side.getByText('Taken by another exhibitor.')).toBeVisible();
  await expect(side.getByRole('button', { name: 'Hold this stall' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Stall A1, free' }).click();
  await side.getByLabel('Note for the organiser').fill('Near the entrance, please');
  await side.getByRole('button', { name: 'Hold this stall' }).click();

  await expect(side.getByRole('heading', { name: 'Stall A1 is held for you' })).toBeVisible();
  await expect(side.getByText(/The organiser confirms the booking/)).toBeVisible();
  expect(api.calls).toEqual([
    {
      method: 'POST',
      path: '/api/orgs/itpo/portal/bookings',
      body: { eventId: 'ev1', stallId: 's1', note: 'Near the entrance, please' },
    },
  ]);
  await expect(page.getByRole('button', { name: 'Stall A1, yours (held)' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('portal-hall.png'), fullPage: true });
});

test('an exhibitor cancels its own held booking, not a confirmed one', async ({ page }) => {
  const api = await mockPortal(page);
  await page.goto('/itpo/portal');

  const table = page.getByRole('table', { name: 'My bookings' });
  await expect(table.getByText('Not tracked here').first()).toBeVisible();
  await expect(table.getByRole('button', { name: 'Cancel my hold on stall A4' })).toHaveCount(0);
  await expect(table.getByText('The organiser cancels confirmed bookings')).toBeVisible();

  await table.getByRole('button', { name: 'Cancel my hold on stall A2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel my hold' }).click();

  await expect(page.getByText('Your hold on stall A2 is cancelled.')).toBeVisible();
  expect(api.calls).toEqual([
    { method: 'POST', path: '/api/orgs/itpo/portal/bookings/b1/cancel', body: { reason: null } },
  ]);
  await expect(table.getByText('Cancelled', { exact: true })).toBeVisible();
});

test('a closed portal says why and offers no booking action', async ({ page }) => {
  const reason = 'Stall booking by exhibitors is not switched on for this organisation.';
  const api = await mockPortal(page, { closedReason: reason });
  await page.goto('/itpo/portal');

  await expect(page.getByRole('status').filter({ hasText: reason })).toBeVisible();
  const table = page.getByRole('table', { name: 'My bookings' });
  await expect(table.getByRole('button', { name: /Cancel my hold/ })).toHaveCount(0);

  await page.getByRole('link', { name: /Hall 1/ }).click();
  await expect(page.getByRole('status').filter({ hasText: reason })).toBeVisible();
  await page.getByRole('button', { name: 'Stall A1, free' }).click();
  const side = page.getByRole('complementary', { name: 'Selected stall' });
  await expect(side.getByText('Free, but stalls cannot be held here right now.')).toBeVisible();
  await expect(side.getByRole('button', { name: 'Hold this stall' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stall A2, yours (held)' }).click();
  await expect(side.getByRole('button', { name: 'Cancel my hold' })).toHaveCount(0);
  expect(api.calls).toEqual([]);
});
