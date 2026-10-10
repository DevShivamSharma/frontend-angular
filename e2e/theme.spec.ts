import { expect, Page, test } from '@playwright/test';

/** Light, dark or as the device is, from the top bar; the choice stays after a reload. */
const SHOTS = process.env['PW_SHOTS'];

async function mockOrg(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: 'u', name: 'Ops', email: 'ops@test.local', isPlatformAdmin: false };
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
            role: { id: 'r', name: 'Venue Admin' },
            scope: {},
            eventScoped: false,
          },
          permissions: ['events.view', 'events.manage', 'categories.manage'],
        },
      });
    if (path.endsWith('/categories'))
      return route.fulfill({
        json: [
          {
            id: 'c1',
            name: 'Premium',
            status: 'active',
            eventHalls: 0,
            updatedAt: '2026-10-01T00:00:00Z',
          },
        ],
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
}

test('the theme is chosen in the top bar and kept', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockOrg(page);
  await page.goto('/venue/categories');
  const html = page.locator('html');
  const toggle = page.getByRole('button', { name: /^Theme:/ });
  await expect(toggle).toHaveAccessibleName('Theme: As the device');
  await expect(html).not.toHaveClass(/app-dark/);

  await toggle.click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/app-dark/);
  await expect(html).toHaveCSS('color-scheme', 'dark');
  // Our surfaces and PrimeNG's both turn dark.
  const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(body).not.toBe('rgb(255, 255, 255)');
  if (SHOTS) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/theme-dark.png` });
  }

  await page.reload();
  await expect(html).toHaveClass(/app-dark/);
  await expect(toggle).toHaveAccessibleName('Theme: Dark');

  // As the device: follows it, whatever was chosen before.
  await toggle.click();
  await page.getByRole('menuitemradio', { name: 'As the device' }).click();
  await expect(html).not.toHaveClass(/app-dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/app-dark/);
});
