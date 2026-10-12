import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page, test } from '@playwright/test';

/**
 * ITPO's Hall 11 as T_HALL_LAYOUTS has it (59 × 126 m, walls, the foyer annex), every rule off,
 * and the stalls the server read from the IITF 2026 plan of Halls 8 to 11 (the drawing itself is
 * not in the repository: fixtures/hall-11-drawing.json is what the server returns for it). The
 * stalls must land exactly where the drawing puts them, named as drawn.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const planner = fixture('hall-11-planner.json');
const drawing = fixture('hall-11-drawing.json');
const SHOTS = process.env['PW_SHOTS'];

async function mockHall11(page: Page) {
  const saves: any[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const user = { id: 'u', name: 'Owner', email: 'owner@test.local', isPlatformAdmin: false };
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
          membership: { id: 'm', role: { id: 'r', name: 'Owner' }, scope: {}, eventScoped: false },
          permissions: ['events.view', 'layouts.view', 'layouts.edit'],
        },
      });
    if (path.endsWith('/plan/drawing')) return route.fulfill({ json: drawing });
    if (path.endsWith('/plan/check')) return route.fulfill({ json: { findings: [] } });
    if (path.endsWith('/plan') && req.method() === 'PUT') {
      const body = req.postDataJSON();
      saves.push(body);
      return route.fulfill({
        json: {
          ...body,
          revision: body.revision + 1,
          updatedAt: '2026-10-11T00:00:00Z',
          published: null,
        },
      });
    }
    if (path.endsWith('/plan')) return route.fulfill({ json: planner });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { saves };
}

const noSpace = (s: string) => s.replace(/\s+/g, '');

test('Hall 11 of the IITF 2026 plan lands on ITPO’s Hall 11 exactly as drawn, named as drawn', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { saves } = await mockHall11(page);
  await page.goto('/itpo/events/ev/halls/h11/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();

  await page.locator('nav.ribbon input[type=file]').setInputFiles({
    name: 'IITF-2026 H-8,9,10 & 11.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  const dialog = page.locator('app-drawing-import-dialog');
  await expect(dialog).toContainText('Hall 11 of the drawing is Hall 11.');
  await expect(dialog).toContainText("The drawing's other halls (10, 9, 8) are left out.");
  // The drawing's grid is the hall's open floor: placed as drawn, not fitted.
  await expect(dialog).toContainText(
    "Placed where the drawing's grid matches the hall's grid: as drawn.",
  );
  await expect(dialog.locator('dl.stats')).toContainText(/In the drawing\s*71/);
  await expect(dialog.locator('dl.stats')).toContainText(/L-shaped: draw by hand\s*2/);
  await expect(dialog.locator('dl.stats')).toContainText(/Off the hall floor\s*0/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hall-11-review.png` });
  await dialog.getByRole('button', { name: 'Import 69 stalls' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('nav.ribbon').getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saves.length).toBe(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hall-11-planned.png` });

  // Every rectangle where the drawing has it, by one shift (the hall's walls), at its size.
  const saved: any[] = saves[0].stalls;
  expect(saved).toHaveLength(69);
  const label = (s: any) => noSpace(`${s.islandNumber ?? ''}${s.stallNumber}`);
  const shifts = new Set<string>();
  for (const d of drawing.stalls.filter((s: any) => s.shape === 'rectangle')) {
    const s = saved.find((x) => label(x) === noSpace(d.name));
    expect(s, d.name).toBeDefined();
    const xs = d.outline.map((p: any) => p.x);
    const zs = d.outline.map((p: any) => p.z);
    expect([s.width, s.depth], d.name).toEqual([
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    ]);
    shifts.add(`${s.x - Math.min(...xs)},${s.y - Math.min(...zs)}`);
  }
  // The drawing's grid starts inside Hall 11's 2 m west wall and 1 m north wall.
  expect([...shifts]).toEqual(['2,1']);

  // The lines along the walls carry their block, as ITPO numbers them.
  const names = new Set(saved.map(label));
  for (const name of ['11-13B', '11-13G', '11-13L', '11-05C', '11-05F', '11-01G', '11-01I']) {
    expect(names, name).toContain(name);
  }
  expect(names.size).toBe(saved.length);
  // L-shaped stalls are left to draw by hand.
  expect(names).not.toContain('11-13H');
  expect(names).not.toContain('11-10C');
  // Premium and marquee stalls as the drawing marks them.
  expect(saved.filter((s) => s.isPremium)).toHaveLength(
    drawing.stalls.filter((s: any) => s.shape === 'rectangle' && s.category === 'premium').length,
  );
});
