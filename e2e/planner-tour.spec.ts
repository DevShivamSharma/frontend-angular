import { expect, Page, test } from '@playwright/test';

/**
 * The stall planner's guided tour, for an organiser (event role) against a mocked API. It opens
 * by itself the first time, follows real actions and keyboard shortcuts, does steps on request,
 * and removes what was made in it.
 */
const SHOTS = process.env['PW_SHOTS'];

const floor = {
  schema: 'floor/1',
  width: 40,
  depth: 30,
  areas: [{ kind: 'passage', x: 0, y: 0, width: 4, height: 30, label: 'Passage' }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

async function mockOrganiser(page: Page, options: { categories: boolean } = { categories: true }) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const user = { id: 'arch', name: 'Architect', email: 'a@expo.test', isPlatformAdmin: false };
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
            bookingMode: 'inquiry',
          },
          membership: {
            id: 'm',
            role: { id: 'r', name: 'Organiser Architect' },
            scope: {},
            eventScoped: true,
          },
          permissions: ['events.view', 'layouts.view', 'layouts.edit'],
        },
      });
    if (path.endsWith('/plan/check')) {
      const body = req.postDataJSON();
      const changed = new Set(body.changed);
      const findings = body.stalls
        .filter((s: any) => changed.has(s.id) && s.x < 4)
        .map((s: any) => ({ ruleId: 'PASSAGE', message: 'Stands on a passage.', ids: [s.id] }));
      return route.fulfill({ json: { findings } });
    }
    if (path.endsWith('/plan'))
      return route.fulfill({
        json: {
          canEdit: true,
          readOnlyReason: null,
          canPublish: false,
          plan: {
            revision: 0,
            updatedAt: null,
            published: null,
            zones: [],
            stalls: [],
            seats: [],
            objects: [],
          },
          hall: {
            event: { id: 'ev', name: 'Footwear Expo', kind: 'external', audience: 'B2B' },
            hall: {
              hallId: 'h5',
              name: 'Hall 5',
              code: null,
              level: null,
              venue: { id: 'v', name: 'Pragati' },
              width: 40,
              depth: 30,
              floorArea: 1200,
              floorVersion: 1,
              latestFloorVersion: 1,
              rulesOn: 3,
              drawingProfile: 'grid',
              overlaps: [],
            },
            floor,
            rules: {
              switches: { hallBoundary: true, stallOverlap: true, PASSAGE: true },
              values: { passageWidth: { B2B: 3, B2C: 4 } },
              drawingProfile: 'grid',
            },
            categories: options.categories ? [{ id: 'c1', name: 'Premium', status: 'active' }] : [],
            plan: { stalls: 0, seats: 0, revision: 0 },
          },
        },
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  // Lets the popover finish gliding to its place first.
  await page.waitForTimeout(400);
  const box = (await page.locator('app-planner-canvas canvas').boundingBox())!;
  const p = (f: [number, number]) => ({
    x: box.x + box.width * f[0],
    y: box.y + box.height * f[1],
  });
  const [a, b] = [p(from), p(to)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('an organiser is taken round the planner, and what the tour made goes', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await mockOrganiser(page);
  await page.goto('/venue/events/ev/halls/h5/planner');
  // The hall's rules come first; the tour starts after them.
  await page.getByRole('button', { name: 'Start planning' }).click();

  const dialog = page.getByRole('dialog');
  const step = (n: number, title: string) =>
    expect(dialog).toContainText(new RegExp(`Step ${n} of 20[\\s\\S]*${title}`));
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const canvasAt = async (fx: number, fy: number) => {
    // The popover glides to its new place for 300 ms; a click meanwhile could land on it.
    await page.waitForTimeout(400);
    const box = (await page.locator('app-planner-canvas canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  };

  // Opens by itself, the first time.
  await step(1, 'Welcome');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-1.png` });
  await button('Start').click();
  await step(2, 'Your hall at a glance');
  await expect(page.locator('app-tour-overlay .spot')).toBeVisible();
  // An info step lets nothing else be clicked.
  await page.locator('[data-tour="booth-tool"]').click({ force: true });
  await expect(page.locator('[data-tour="booth-tool"]')).toHaveAttribute('aria-pressed', 'false');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-2.png` });
  await button('Next').click();

  // Your turn: the keyboard shortcut does it.
  await step(3, 'Pick the Zone tool');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-3.png` });
  await page.keyboard.press('z');
  await expect(dialog).toContainText('Well done');
  await step(4, 'Draw a zone');
  await drag(page, [0.45, 0.25], [0.7, 0.5]);
  await step(5, 'Pick the Booth tool');
  await page.locator('[data-tour="booth-tool"]').click();
  await step(6, 'Draw a booth');
  // No "Do it for me": every step is done by hand, or skipped.
  await expect(dialog.getByRole('button', { name: 'Do it for me' })).toHaveCount(0);
  await canvasAt(0.25, 0.35);
  // A rule at work: a booth on the passage is refused, and the tour moves on.
  await step(7, 'See a rule at work');
  await canvasAt(0.14, 0.5);
  await expect(page.locator('p-toast')).toContainText('Stands on a passage');
  await step(8, 'Back to Select');
  await page.keyboard.press('v');
  await step(9, 'Select your booth');
  await canvasAt(0.25, 0.35);
  await step(10, 'Give it a category');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-10.png` });
  await page.locator('[data-tour="stall-categories"] p-multiselect').click();
  await page.getByRole('option', { name: 'Premium' }).click();
  await step(11, 'Open a side');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-11.png` });
  await page.locator('[data-tour="open-sides"]').getByRole('button', { name: 'right' }).click();
  await step(12, 'Copy it');
  await page.keyboard.press('Control+d');
  await step(13, 'Undo it');
  await page.keyboard.press('Control+z');
  await step(14, 'See it in 3D');
  await page.keyboard.press('3');
  await step(15, 'Back to the plan');
  await page.locator('[data-tour="cube-top"]').click();
  await step(16, 'Fill a hall in one go');
  for (const [n, title] of [
    [17, 'Change many at once'],
    [18, 'Measure and look'],
    // An architect saves; the organiser admin publishes.
    [19, 'Save your work'],
    [20, 'You’re ready'],
  ] as const) {
    await button('Next').click();
    await step(n, title);
  }
  await expect(page.locator('dl.stats dt', { hasText: /^Total$/ })).toHaveCount(0);

  // What the tour made goes, and the plan is as it was: nothing to save.
  await dialog.getByRole('button', { name: /Remove what I made/ }).click();
  await expect(
    page.getByText('Removed what you made in the tour (1 booth, 1 zone).'),
  ).toBeVisible();
  await expect(page.locator('nav.ribbon').getByRole('button', { name: 'Saved' })).toBeVisible();
  await button('Finish').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start the guided tour' })).toBeVisible();

  // Not by itself again; Help starts it, Esc leaves it.
  await page.reload();
  await page.getByRole('button', { name: 'Start planning' }).click();
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(dialog).toHaveCount(0);
  await page.locator('nav.ribbon').getByRole('button', { name: 'Help' }).click();
  await step(1, 'Welcome');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('on a narrow screen the hidden plan panel is passed over, and a hall without categories says so', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockOrganiser(page, { categories: false });
  await page.goto('/venue/events/ev/halls/h5/planner');
  // The hall's rules come first; the tour starts after them.
  await page.getByRole('button', { name: 'Start planning' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Step 1 of 20');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  // Step 2, the plan panel, is hidden at this width: the tour goes straight to step 3.
  await expect(dialog).toContainText(/Step 3 of 20[\s\S]*Pick the Zone tool/);
  // Passing the other action steps by; a booth is drawn, so Properties has it to show.
  for (let i = 0; i < 10; i++) {
    const text = await dialog.innerText();
    if (text.includes('Categories come from the venue')) break;
    if (text.includes('Draw a booth')) {
      await page.waitForTimeout(400);
      const box = (await page.locator('app-planner-canvas canvas').boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
      await expect(dialog).not.toContainText('Draw a booth');
      continue;
    }
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await expect(dialog).toContainText('Categories come from the venue');
  await expect(dialog).not.toContainText('Your turn');
});
