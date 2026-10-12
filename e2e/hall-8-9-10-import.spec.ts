import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page, test } from '@playwright/test';

/**
 * ITPO's Hall 8-9-10 as T_HALL_LAYOUTS has it (133 × 43 m, the walls between the halls, its
 * passages), every rule off, and the stalls of Halls 10, 9 and 8 the server read from the IITF
 * 2026 plan of Halls 8 to 11 (fixtures/hall-8-9-10-drawing.json is what the server returns for
 * it). The three halls keep their places to each other as drawn, each on its own walls.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const planner = fixture('hall-8-9-10-planner.json');
const drawing = fixture('hall-8-9-10-drawing.json');
const SHOTS = process.env['PW_SHOTS'];

async function mockHall8910(page: Page) {
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

test('Halls 10, 9 and 8 of the IITF 2026 plan land on ITPO’s Hall 8-9-10 together, each on its walls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { saves } = await mockHall8910(page);
  await page.goto('/itpo/events/ev/halls/h8/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();

  await page.locator('nav.ribbon input[type=file]').setInputFiles({
    name: 'IITF-2026 H-8,9,10 & 11.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  const dialog = page.locator('app-drawing-import-dialog');
  await expect(dialog).toContainText('Halls 10, 9 and 8 of the drawing are Hall 8-9-10.');
  await expect(dialog).toContainText("The drawing's other halls (11) are left out.");
  await expect(dialog).toContainText(
    "Placed where the drawing's grid matches the hall's grid: as drawn.",
  );
  await expect(dialog.locator('dl.stats')).toContainText(/In the drawing\s*76/);
  // On ITPO's passages the drawing has six stalls: the hall's rules decide (here all off).
  await expect(dialog.locator('dl.stats')).toContainText(/Off the hall floor\s*0/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hall-8-9-10-review.png` });
  // The stall the drawing gives no number (Stall s116) is not made.
  await expect(dialog.locator('dl.stats')).toContainText(/No number in the drawing\s*1/);
  await dialog.getByRole('button', { name: 'Import 75 stalls' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('nav.ribbon').getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saves.length).toBe(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hall-8-9-10-planned.png` });

  // Each hall of the drawing moves as one, its stalls at their size.
  const saved: any[] = saves[0].stalls;
  expect(saved).toHaveLength(75);
  const label = (s: any) => noSpace(`${s.islandNumber ?? ''}${s.stallNumber}`);
  expect(saved.map(label)).not.toContain('Stalls116');
  const shift: Record<string, Set<string>> = {};
  for (const d of drawing.stalls.filter((s: any) => s.name !== `Stall ${s.key}`)) {
    const s = saved.find((x) => label(x) === noSpace(d.name));
    expect(s, d.name).toBeDefined();
    const xs = d.outline.map((p: any) => p.x);
    const zs = d.outline.map((p: any) => p.z);
    expect([s.width, s.depth], d.name).toEqual([
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    ]);
    (shift[d.group] ??= new Set()).add(`${s.x - Math.min(...xs)},${s.y - Math.min(...zs)}`);
  }
  const at = (g: string) => {
    expect(shift[g].size, `hall ${g} moves as one`).toBe(1);
    return [...shift[g]][0].split(',').map(Number);
  };
  // The halls stay where the drawing puts them to each other, within a step of their walls.
  const cal = Object.fromEntries(drawing.groups.map((g: any) => [g.group, g]));
  for (const g of ['9', '8']) {
    const [x, z] = at(g);
    const [x10, z10] = at('10');
    const drawn = [
      (cal[g].originX - cal['10'].originX) / cal['10'].pitchX,
      (cal[g].originY - cal['10'].originY) / cal['10'].pitchY,
    ];
    expect(Math.abs(x - x10 - drawn[0]), `hall ${g} across`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(z - z10 - drawn[1]), `hall ${g} down`).toBeLessThanOrEqual(1.5);
  }

  // No stall stands on a wall of the hall.
  const walls = planner.hall.floor.geometry.objects
    .filter((o: any) => o.kind === 'wall')
    .flatMap((o: any) => o.geometry.map((poly: any) => poly[0]))
    .map((ring: number[][]) => ({
      x0: Math.min(...ring.map((p) => p[0])),
      x1: Math.max(...ring.map((p) => p[0])),
      y0: Math.min(...ring.map((p) => p[1])),
      y1: Math.max(...ring.map((p) => p[1])),
    }));
  for (const s of saved) {
    const hit = walls.find(
      (w: any) => s.x < w.x1 && s.x + s.width > w.x0 && s.y < w.y1 && s.y + s.depth > w.y0,
    );
    expect(hit, `${label(s)} on a wall`).toBeUndefined();
  }
});
