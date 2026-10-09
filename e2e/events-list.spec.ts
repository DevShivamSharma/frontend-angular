import { expect, test } from '@playwright/test';

/** An organiser's own events, as cards with where each stands today. */
test('lists events as cards with their phase', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T10:00:00'));
  const event = (over: Record<string, unknown>) => ({
    id: 'e',
    kind: 'external',
    name: 'test',
    venueEventId: null,
    organiserName: 'adidada',
    audience: 'B2B',
    startsOn: '2026-10-02',
    endsOn: '2026-10-17',
    buildUpOn: null,
    dismantleOn: null,
    hallCount: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: 'u', name: 'Organiser', email: 'o@test.local', isPlatformAdmin: false };
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ json: { accessToken: 'mock', expiresIn: 3600, user } });
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
          membership: {
            id: 'm',
            role: { id: 'r', name: 'Organiser Admin' },
            scope: {},
            eventScoped: true,
          },
          permissions: ['events.view', 'layouts.view', 'layouts.edit'],
        },
      });
    if (path.endsWith('/events'))
      return route.fulfill({
        json: [
          event({ id: 'a', venueEventId: '12312312' }),
          event({
            id: 'b',
            name: 'Footwear Expo',
            startsOn: '2026-11-20',
            endsOn: '2026-11-22',
            buildUpOn: '2026-11-17',
            hallCount: 3,
          }),
          event({
            id: 'c',
            name: 'Book Fair',
            kind: 'internal',
            organiserName: null,
            audience: 'B2C',
            startsOn: '2026-10-05',
            endsOn: '2026-10-07',
            dismantleOn: '2026-10-10',
            hallCount: 0,
          }),
          event({ id: 'd', name: 'Auto Show', startsOn: '2026-09-01', endsOn: '2026-09-05' }),
        ],
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  await page.goto('/venue/events');
  const cards = page.locator('.event-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('Live');
  await expect(cards.nth(0)).toContainText('12312312');
  await expect(cards.nth(1)).toContainText('In 42 days');
  await expect(cards.nth(2)).toContainText('Dismantling');
  await expect(cards.nth(2)).toContainText('No halls yet');
  await expect(cards.nth(3)).toContainText('Ended');
  const shots = process.env['PW_SHOTS'];
  if (shots) await page.screenshot({ path: `${shots}/events-list.png` });
});
