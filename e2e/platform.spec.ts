import { expect, Page, test } from '@playwright/test';

const itpo = {
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
};

/** No session, and one organisation (`itpo`) that also answers to its old slug `pragati`. */
async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { status: 401, message: 'Sign in to continue.' } }),
  );
  await page.route('**/api/orgs/*/public-config', (route) => {
    const slug = new URL(route.request().url()).pathname.split('/')[3];
    return ['itpo', 'pragati'].includes(slug)
      ? route.fulfill({ json: itpo })
      : route.fulfill({ status: 404, json: { status: 404, message: 'Not found' } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

test('the bare domain lists no organisations', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: "This link doesn't lead anywhere" }),
  ).toBeVisible();
});

test('an unknown organisation shows the invalid-link page', async ({ page }) => {
  await page.goto('/no-such-venue');
  await expect(
    page.getByRole('heading', { name: "This link doesn't lead anywhere" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/no-such-venue$/);
});

test("an organisation's pages open in its own look", async ({ page }) => {
  await page.goto('/itpo');

  await expect(page).toHaveURL(/\/itpo\/login\?returnUrl=%2Fitpo$/);
  await expect(page.getByText('Bharat Mandapam (ITPO)').first()).toBeVisible();
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary'),
  );
  expect(primary).toContain('light-dark(');
  await expect(page).toHaveTitle('Sign in · Bharat Mandapam (ITPO)');
});

test('an old slug moves to the current one', async ({ page }) => {
  await page.goto('/pragati/login');
  await expect(page).toHaveURL(/\/itpo\/login$/);
});

test('the console asks the Super Admin to sign in', async ({ page }) => {
  await page.goto('/admin/organisations');
  await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
  await expect(page.getByText('Platform administration').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a failed sign-in explains itself', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: { status: 401, message: 'Email or password is incorrect.' },
    }),
  );
  await page.goto('/itpo/login');
  await page.getByLabel('Email').fill('someone@itpo.test');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
});
