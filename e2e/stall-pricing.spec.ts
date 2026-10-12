import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page, test } from '@playwright/test';

/**
 * Pricing an internal event's hall, as ITPO does: the rate card (bare and shell rates, open-side
 * percentages, the catalogue charge), then prices set on alike stalls at once, and on one stall.
 * Prices are saved at once, apart from the plan; the mocked server keeps them.
 */
const planner = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'hall-11-planner.json'), 'utf8'),
);
const SHOTS = process.env['PW_SHOTS'];

const stall = (id: string, number: string, x: number, more: Record<string, unknown> = {}) => ({
  id,
  zoneId: null,
  islandNumber: '11-01 ',
  stallNumber: number,
  x,
  y: 20,
  width: 3,
  depth: 3,
  openSides: ['bottom'],
  scheme: 'shell',
  categoryIds: [],
  isPremium: false,
  isBlocked: false,
  isFnb: false,
  isBranding: false,
  isHorseshoe: false,
  isMarqueeAvailable: false,
  isRestrictedForOverseas: false,
  isActive: true,
  location: null,
  description: null,
  ...more,
});

type Pricing = {
  card: unknown;
  prices: Array<{ stallId: string; price: number; note: string | null }>;
  canManage: boolean;
  readOnlyReason: string | null;
};

async function mockPricing(page: Page) {
  const server = {
    pricing: { card: null, prices: [], canManage: true, readOnlyReason: null } as Pricing,
    calls: [] as Array<{ path: string; body: any }>,
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const user = { id: 'u', name: 'Ops', email: 'ops@test.local', isPlatformAdmin: false };
    if (path.endsWith('/auth/refresh'))
      return route.fulfill({ json: { accessToken: 'mock', expiresIn: 3600, user } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { user, memberships: [] } });
    if (path.endsWith('/public-config'))
      return route.fulfill({
        json: {
          slug: 'itpo',
          name: 'ITPO',
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
            name: 'ITPO',
            features: {},
            bookingMode: 'inquiry',
          },
          membership: {
            id: 'm',
            role: { id: 'r', name: 'Venue Admin' },
            scope: {},
            eventScoped: false,
          },
          permissions: [
            'events.view',
            'layouts.view',
            'layouts.edit',
            'layouts.publish',
            'pricing.view',
            'pricing.manage',
          ],
        },
      });
    if (path.endsWith('/plan/pricing/card') && req.method() === 'PUT') {
      const body = req.postDataJSON();
      server.calls.push({ path: 'card', body });
      server.pricing = { ...server.pricing, card: body };
      return route.fulfill({ json: server.pricing });
    }
    if (path.endsWith('/plan/pricing/stalls') && req.method() === 'PUT') {
      const body = req.postDataJSON();
      server.calls.push({ path: 'stalls', body });
      const prices = new Map(server.pricing.prices.map((p) => [p.stallId, p]));
      for (const p of body.prices) {
        if (p.price === null) prices.delete(p.stallId);
        else prices.set(p.stallId, { stallId: p.stallId, price: p.price, note: p.note ?? null });
      }
      server.pricing = { ...server.pricing, prices: [...prices.values()] };
      return route.fulfill({ json: server.pricing });
    }
    if (path.endsWith('/plan/check')) return route.fulfill({ json: { findings: [] } });
    if (path.endsWith('/plan'))
      return route.fulfill({
        json: {
          ...planner,
          plan: {
            ...planner.plan,
            revision: 1,
            review: null,
            stalls: [
              stall('s1', 'A', 20),
              stall('s2', 'B', 24),
              stall('s3', 'C', 28, { isPremium: true, openSides: ['bottom', 'right'] }),
            ],
          },
          findings: null,
          pricing: server.pricing,
          canPublish: true,
          needsApproval: false,
          canSubmit: false,
          canWithdraw: false,
          canApprove: false,
        },
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return server;
}

const stats = (page: Page, label: string) =>
  page.locator('dl.stats dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');

async function typeInto(page: Page, id: string, value: string) {
  const input = page.locator(`#${id}`);
  await input.click();
  await input.press('Control+a');
  await input.pressSequentially(value);
  await input.press('Tab');
}

test('the venue prices a hall by its rate card, alike stalls at once, and one stall', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  const server = await mockPricing(page);
  await page.goto('/itpo/events/ev/halls/h11/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();

  // Nothing priced yet: the toolbar and the statistics say so.
  const pricing = page.locator('nav.ribbon').getByRole('button', { name: 'Pricing' });
  await expect(pricing.locator('.dot')).toBeVisible();
  await expect(stats(page, 'Without a price')).toHaveText('3');

  // The rate card, as ITPO's price master has it.
  await pricing.click();
  const dialog = page.locator('app-pricing-dialog');
  await expect(dialog).toContainText('3 without a price');
  await typeInto(page, 'general-bareRate', '8000');
  await typeInto(page, 'general-shellRate', '9500');
  await typeInto(page, 'general-side2Percent', '5');
  await typeInto(page, 'general-catalogueCharge', '5000');
  await dialog.getByRole('button', { name: 'Save rate card' }).click();
  await expect(page.getByText('Rate card saved. Stall prices follow it.')).toBeVisible();
  expect(server.calls[0]).toEqual({
    path: 'card',
    body: {
      general: {
        bareRate: 8000,
        shellRate: 9500,
        side2Percent: 5,
        side3Percent: 0,
        side4Percent: 0,
        catalogueCharge: 5000,
        fnbPrice: null,
      },
      premium: null,
      marquee: null,
    },
  });
  // 9 m² × ₹9,500 + ₹5,000 = ₹90,500 each; the corner +5%: ₹94,775. ₹2,75,775 in all.
  await expect(dialog).toContainText('0 without a price');
  await expect(dialog).toContainText('₹2,75,775 in all');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pricing-card.png` });

  // Alike stalls at once: the two 3 × 3 m one-side stalls.
  await dialog.getByRole('button', { name: 'Stall prices' }).click();
  const row = dialog.locator('tr', { hasText: '3 × 3 m · shell · 1 side open' });
  await expect(row).toContainText('₹90,500');
  await typeInto(page, 'group-0', '100000');
  await row.getByRole('button', { name: 'Set' }).click();
  await expect(page.getByText('Price set on 2 stalls.')).toBeVisible();
  expect(server.calls[1]).toEqual({
    path: 'stalls',
    body: {
      prices: [
        { stallId: 's1', price: 100000 },
        { stallId: 's2', price: 100000 },
      ],
    },
  });
  await expect(row).toContainText('₹1,00,000');
  await expect(row).toContainText('set on the stalls');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pricing-stalls.png` });
  await dialog.getByRole('button', { name: 'Close' }).click();

  // One stall: its price, how it was worked out, and back to the rate card.
  await page.locator('.side.left').getByText('Stall 11-01 C').click();
  const card = page.locator('app-stall-price-card');
  await expect(card).toContainText('₹94,775');
  await expect(card).toContainText('9 m² × ₹9,500 shell + 5% for 2 open sides + ₹5,000 catalogue');
  await page.locator('.side.left').getByText('Stall 11-01 A').click();
  await expect(card).toContainText('₹1,00,000');
  await expect(card).toContainText('set on the stall');
  await card.getByRole('button', { name: 'Use rate card' }).click();
  await expect(card).toContainText('₹90,500');
  expect(server.calls[2]).toEqual({
    path: 'stalls',
    body: { prices: [{ stallId: 's1', price: null }] },
  });
  await expect(stats(page, 'Value (excl. GST)')).toHaveText('₹2,85,275');
  await expect(stats(page, 'Without a price')).toHaveText('0');
  await expect(pricing.locator('.dot')).toHaveCount(0);
});
