import { expect, Page, test } from '@playwright/test';

/** A 30 × 20 m hall with three 3 × 3 m stalls. */
const floor = {
  schema: 'floor/1',
  width: 30,
  depth: 20,
  areas: [{ kind: 'column', x: 14, y: 9, width: 1, height: 1 }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

const stalls = [
  { id: 's1', number: 'A1', x: 2, y: 2, width: 3, depth: 3 },
  { id: 's2', number: 'A2', x: 6, y: 2, width: 3, depth: 3 },
  { id: 's3', number: 'A3', x: 10, y: 2, width: 3, depth: 3 },
].map((s) => ({ ...s, area: 9, openSides: ['bottom'], stallType: 'shell' }));

const exhibitors = [
  { id: 'x1', name: 'Acme Corp', contactName: null, email: null, eventIds: ['ev1'] },
  { id: 'x2', name: 'Globex', contactName: null, email: null, eventIds: ['ev1'] },
];

interface Booking {
  id: string;
  stallId: string;
  exhibitorId: string;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired';
  channel: 'internal' | 'external';
  paymentStatus: 'pending' | 'completed' | 'timeout' | 'cancelled' | null;
  note: string | null;
  cancelReason: string | null;
}

/**
 * A signed-in organiser admin of `itpo` and one event, `ev1`, with a published Hall 1 and a draft
 * Hall 2. Stall A2 is held by Globex. Records every booking call.
 */
async function mockStaff(
  page: Page,
  options: { eventStatus?: string; takenMeanwhile?: boolean } = {},
) {
  const calls: { method: string; path: string; body: any }[] = [];
  const bookings: Booking[] = [
    {
      id: 'b1',
      stallId: 's2',
      exhibitorId: 'x2',
      status: 'held',
      channel: 'external',
      paymentStatus: 'pending',
      note: 'Near the entrance',
      cancelReason: null,
    },
  ];
  const event = {
    id: 'ev1',
    name: 'Tech Expo',
    status: options.eventStatus ?? 'scheduled',
  };
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
        stallType: stall.stallType,
      },
      exhibitor: exhibitors.find((x) => x.id === b.exhibitorId)!,
      channel: b.channel,
      status: b.status,
      paymentStatus: b.paymentStatus,
      note: b.note,
      externalRef: null,
      cancelReason: b.cancelReason,
      createdAt: '2026-10-01T10:00:00.000Z',
      confirmedAt: null,
      cancelledAt: null,
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
  };
  const active = (stallId: string) =>
    bookings.find((b) => b.stallId === stallId && ['held', 'confirmed'].includes(b.status));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const user = {
      id: 'u',
      name: 'Organiser',
      email: 'organiser@test.local',
      isPlatformAdmin: false,
    };
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
            features: { exhibitorPortal: true },
            bookingMode: 'hybrid_hold',
          },
          membership: {
            id: 'm',
            role: { id: 'r', key: 'organiser_admin', name: 'Organiser Admin' },
            scope: {},
          },
          permissions: ['events.view', 'layouts.view', 'bookings.view', 'bookings.manage'],
        },
      });
    if (path === '/api/orgs/itpo/events/ev1')
      return route.fulfill({
        json: {
          ...event,
          startsOn: '2026-11-10',
          endsOn: '2026-11-14',
          venue: { id: 'v1', name: 'Bharat Mandapam' },
          halls: [
            { hallId: 'h1', name: 'Hall 1' },
            { hallId: 'h2', name: 'Hall 2' },
          ],
        },
      });
    if (path === '/api/orgs/itpo/events/ev1/plans')
      return route.fulfill({
        json: [
          {
            hallId: 'h1',
            hallName: 'Hall 1',
            planId: 'p1',
            status: 'published',
            revision: 3,
            stallCount: 3,
            activeBookings: 1,
          },
          {
            hallId: 'h2',
            hallName: 'Hall 2',
            planId: 'p2',
            status: 'draft',
            revision: 1,
            stallCount: 0,
            activeBookings: 0,
          },
        ],
      });
    if (path === '/api/orgs/itpo/exhibitors') return route.fulfill({ json: exhibitors });
    if (path === '/api/orgs/itpo/events/ev1/halls/h1/stalls') {
      return route.fulfill({
        json: {
          event: { ...event, eventType: 'B2B' },
          hall: { id: 'h1', name: 'Hall 1', floorVersion: 2 },
          bookable: event.status === 'scheduled',
          floor,
          stalls: stalls.map((s) => {
            const b = active(s.id);
            return {
              ...s,
              state: !b ? 'free' : b.status === 'held' ? 'held' : 'booked',
              booking: b
                ? {
                    id: b.id,
                    exhibitor: exhibitors.find((x) => x.id === b.exhibitorId)!.name,
                    own: false,
                  }
                : null,
            };
          }),
        },
      });
    }
    if (path === '/api/orgs/itpo/bookings' && method === 'GET')
      return route.fulfill({ json: [...bookings].reverse().map(view) });
    if (path === '/api/orgs/itpo/bookings' && method === 'POST') {
      const body = request.postDataJSON();
      calls.push({ method, path, body });
      const stall = stalls.find((s) => s.id === body.stallId)!;
      if (options.takenMeanwhile) {
        // Globex held the stall through the portal after this page loaded the map.
        bookings.push({
          id: 'b9',
          stallId: body.stallId,
          exhibitorId: 'x2',
          status: 'held',
          channel: 'external',
          paymentStatus: 'pending',
          note: null,
          cancelReason: null,
        });
        options.takenMeanwhile = false;
      }
      if (active(body.stallId)) {
        return route.fulfill({
          status: 409,
          json: { status: 409, message: `Stall ${stall.number} is already held.` },
        });
      }
      const booking: Booking = {
        id: `b${bookings.length + 1}`,
        stallId: body.stallId,
        exhibitorId: body.exhibitorId,
        status: body.confirm ? 'confirmed' : 'held',
        channel: 'internal',
        paymentStatus: body.confirm ? null : 'pending',
        note: body.note,
        cancelReason: null,
      };
      bookings.push(booking);
      return route.fulfill({ status: 201, json: view(booking) });
    }
    const action = /^\/api\/orgs\/itpo\/bookings\/(\w+)\/(confirm|cancel|move|selfcare-row)$/.exec(
      path,
    );
    if (action && method === 'POST') {
      const body = request.postDataJSON();
      calls.push({ method, path, body });
      const booking = bookings.find((b) => b.id === action[1])!;
      if (action[2] === 'selfcare-row') {
        const stall = stalls.find((s) => s.id === booking.stallId)!;
        return route.fulfill({
          json: {
            T_STALLS: {
              id: body.stall_id ?? null,
              island_number: stall.number,
              stall_number: null,
            },
            T_STALL_BOOKING: { event_name: event.name, booking_status: 'Pending' },
            T_STALL_BOOKING_DETAIL: [{ area: stall.area, rate: body.pricing?.shell_rate ?? null }],
          },
        });
      }
      if (action[2] === 'confirm') booking.status = 'confirmed';
      else if (action[2] === 'move') booking.stallId = body.stallId;
      else {
        booking.status = 'cancelled';
        booking.cancelReason = body.reason;
      }
      return route.fulfill({ json: view(booking) });
    }
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { calls, bookings };
}

test('staff book a free stall for a registered exhibitor', async ({ page }) => {
  const api = await mockStaff(page);
  await page.goto('/itpo/events/ev1/bookings');

  await expect(page.getByRole('heading', { name: 'Bookings', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Hall 1' })).toBeVisible();
  await expect(page.getByText('Not published yet: Hall 2 (plan in draft).')).toBeVisible();
  // Payment is never claimed: the venue's system has not reported one.
  const table = page.getByRole('table', { name: 'Bookings of the event' });
  await expect(table.getByRole('cell', { name: 'Awaiting venue payment' })).toBeVisible();

  await page.getByRole('button', { name: 'Stall A1, free' }).click();
  await page.getByRole('button', { name: 'Book this stall' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Book stall A1' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Exhibitor' }).click();
  await page.getByRole('option', { name: 'Acme Corp' }).click();
  await dialog.getByLabel('Note').fill('Corner preferred');
  await dialog.getByRole('button', { name: 'Hold stall' }).click();

  await expect(page.getByText('Stall A1 held for Acme Corp.')).toBeVisible();
  expect(api.calls[0]).toEqual({
    method: 'POST',
    path: '/api/orgs/itpo/bookings',
    body: {
      eventId: 'ev1',
      stallId: 's1',
      exhibitorId: 'x1',
      note: 'Corner preferred',
      confirm: false,
    },
  });
  await expect(page.getByRole('button', { name: 'Stall A1, held by Acme Corp' })).toBeVisible();
  await expect(table.getByRole('cell', { name: /Acme Corp/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('event-bookings.png'), fullPage: true });
});

test('staff confirm a held booking, then cancel it with a reason', async ({ page }) => {
  const api = await mockStaff(page);
  await page.goto('/itpo/events/ev1/bookings');

  await page.getByRole('button', { name: 'Stall A2, held by Globex' }).click();
  const side = page.getByRole('complementary', { name: 'Selected stall' });
  await expect(side.getByText('Awaiting venue payment')).toBeVisible();
  await side.getByRole('button', { name: 'Confirm' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/confirming records no payment/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Confirm booking' }).click();

  await expect(page.getByText('Stall A2 confirmed for Globex.')).toBeVisible();
  expect(api.calls[0]).toEqual({
    method: 'POST',
    path: '/api/orgs/itpo/bookings/b1/confirm',
    body: {},
  });
  await expect(page.getByRole('button', { name: 'Stall A2, booked by Globex' })).toBeVisible();
  // A confirmed booking is neither confirmed again nor exported to SelfCare.
  await expect(side.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'SelfCare export' })).toHaveCount(0);

  await side.getByRole('button', { name: 'Cancel booking' }).click();
  const cancel = page.getByRole('dialog');
  await expect(cancel.getByRole('button', { name: 'Cancel booking' })).toBeDisabled();
  await cancel.getByLabel('Reason (kept with the booking)').fill('Exhibitor withdrew');
  await cancel.getByRole('button', { name: 'Cancel booking' }).click();

  await expect(page.getByText('The booking of stall A2 is cancelled.')).toBeVisible();
  expect(api.calls[1]).toEqual({
    method: 'POST',
    path: '/api/orgs/itpo/bookings/b1/cancel',
    body: { reason: 'Exhibitor withdrew' },
  });
  await expect(page.getByRole('button', { name: 'Stall A2, free' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Bookings of the event' });
  await expect(table.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(table.getByText('Exhibitor withdrew')).toBeVisible();
});

test('a stall taken meanwhile shows the conflict and the map as it is now', async ({ page }) => {
  await mockStaff(page, { takenMeanwhile: true });
  await page.goto('/itpo/events/ev1/bookings');

  await page.getByRole('button', { name: 'Stall A3, free' }).click();
  await page.getByRole('button', { name: 'Book this stall' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Exhibitor' }).click();
  await page.getByRole('option', { name: 'Acme Corp' }).click();
  await dialog.getByRole('button', { name: 'Hold stall' }).click();

  await expect(page.getByText('Stall A3 is already held.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stall A3, held by Globex' })).toBeVisible();
});

test('booking actions are explained away while the event is a draft', async ({ page }) => {
  await mockStaff(page, { eventStatus: 'draft' });
  await page.goto('/itpo/events/ev1/bookings');

  await expect(
    page.getByText('Stalls are booked once the event is scheduled; Tech Expo is still a draft.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stall A1, free' }).click();
  await expect(page.getByRole('button', { name: 'Book this stall' })).toHaveCount(0);
  // A held booking of a draft event can still be cancelled, not confirmed.
  await page.getByRole('button', { name: 'Stall A2, held by Globex' }).click();
  const side = page.getByRole('complementary', { name: 'Selected stall' });
  await expect(side.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
});

test('staff move a booking to another free stall of the event', async ({ page }) => {
  const api = await mockStaff(page);
  await page.goto('/itpo/events/ev1/bookings');

  await page.getByRole('button', { name: 'Stall A2, held by Globex' }).click();
  const side = page.getByRole('complementary', { name: 'Selected stall' });
  await side.getByRole('button', { name: 'Move' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'New stall' }).click();
  // Only free stalls are offered; A2 itself is not.
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: /^A3/ }).click();
  await dialog.getByRole('button', { name: 'Move booking' }).click();

  await expect(page.getByText('Globex moved to stall A3 (Hall 1).')).toBeVisible();
  expect(api.calls).toEqual([
    { method: 'POST', path: '/api/orgs/itpo/bookings/b1/move', body: { stallId: 's3' } },
  ]);
  await expect(page.getByRole('button', { name: 'Stall A3, held by Globex' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stall A2, free' })).toBeVisible();
});

test('the SelfCare export sends only what is entered and shows the rows', async ({ page }) => {
  const api = await mockStaff(page);
  await page.goto('/itpo/events/ev1/bookings');

  await page.getByRole('button', { name: 'Stall A2, held by Globex' }).click();
  await page
    .getByRole('complementary', { name: 'Selected stall' })
    .getByRole('button', { name: 'SelfCare export' })
    .click();
  const dialog = page.getByRole('dialog');
  // Nothing is pre-filled: no id, price or tax is assumed.
  for (const label of ['User id', 'Hall id', 'Bare rate', 'Shell rate', 'CGST', 'IGST']) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await dialog.getByLabel('Shell rate', { exact: true }).fill('9000');
  await dialog.getByRole('button', { name: 'Make SelfCare rows' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Choose whether corner charges apply to these prices.',
  );
  expect(api.calls).toEqual([]);

  await dialog.getByRole('combobox', { name: 'Corner charges apply' }).click();
  await page.getByRole('option', { name: 'No', exact: true }).click();
  await dialog.getByRole('button', { name: 'Make SelfCare rows' }).click();

  await expect(dialog.getByLabel('SelfCare rows as JSON')).toContainText('"T_STALL_BOOKING"');
  expect(api.calls).toEqual([
    {
      method: 'POST',
      path: '/api/orgs/itpo/bookings/b1/selfcare-row',
      body: {
        pricing: {
          bare_rate: null,
          shell_rate: 9000,
          two_side_open_rate_percent: null,
          three_side_open_rate_percent: null,
          four_side_open_rate_percent: null,
          catlog_entry_charge: null,
          corner_charges_applicable: false,
        },
      },
    },
  ]);
  await expect(dialog.getByRole('button', { name: 'Copy JSON' })).toBeVisible();
});
