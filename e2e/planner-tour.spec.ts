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

async function mockOrganiser(
  page: Page,
  options: { categories: boolean; eventScoped?: boolean } = { categories: true },
) {
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
            eventScoped: options.eventScoped ?? true,
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

/** The tour plays by itself: each step comes on its own, within its reading time. */
const STEP_MS = 20_000;

test('the tour plays itself round the planner, waits only for Finish, and what it made goes', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1600, height: 960 });
  await mockOrganiser(page);
  await page.goto('/venue/events/ev/halls/h5/planner');
  // The hall's rules come first; the tour starts after them.
  await page.getByRole('button', { name: 'Start planning' }).click();

  const dialog = page.getByRole('dialog');
  const step = (n: number, title: string) =>
    expect(dialog).toContainText(new RegExp(`Step ${n} of 20[\\s\\S]*${title}`), {
      timeout: STEP_MS,
    });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });

  // Opens by itself, the first time; no Next or Back, only Skip.
  await step(1, 'Welcome');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-1.png` });
  await expect(dialog).toContainText('Plays by itself');
  await expect(dialog.getByRole('button', { name: /Next|Back|Start/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Skip the tour' })).toBeVisible();

  await step(2, 'Your hall at a glance');
  await expect(page.locator('app-tour-overlay .spot')).toBeVisible();
  // Nothing on the page takes clicks while the tour plays.
  await page.locator('[data-tour="booth-tool"]').click({ force: true });
  await expect(page.locator('[data-tour="booth-tool"]')).toHaveAttribute('aria-pressed', 'false');

  // The tour does each step itself, and says so.
  await step(3, 'Pick the Zone tool');
  await expect(dialog).toContainText('Watch: Zone is picked in the toolbar');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-3.png` });
  await expect(page.locator('[data-tour="zone-tool"]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: STEP_MS,
  });
  await expect(dialog).toContainText('Done — on to the next step');
  await step(4, 'Draw a zone');
  await step(5, 'Pick the Booth tool');
  await step(6, 'Draw a booth');
  // A rule at work: the booth it puts half over the wall is refused, with the rule's message.
  await step(7, 'See a rule at work');
  await expect(page.locator('p-toast')).toContainText('Stands on a passage', { timeout: STEP_MS });
  await step(8, 'Back to Select');
  await step(9, 'Select your booth');
  await step(10, 'Give it a category');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-10.png` });
  await step(11, 'Open a side');
  await step(12, 'Copy it');
  await step(13, 'Undo it');
  await step(14, 'See it in 3D');
  await step(15, 'Back to the plan');
  await step(16, 'Fill a hall in one go');
  await step(17, 'Change many at once');
  await step(18, 'Measure and look');
  // An architect saves; the organiser admin publishes.
  await step(19, 'Save your work');
  await step(20, 'You’re ready');

  // The last step waits for Finish.
  await page.waitForTimeout(5000);
  await step(20, 'You’re ready');
  await expect(dialog).not.toContainText('Plays by itself');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-20.png` });

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
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockOrganiser(page, { categories: false });
  await page.goto('/venue/events/ev/halls/h5/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Step 1 of 20');
  // Step 2, the plan panel, is hidden at this width: the tour goes straight to step 3.
  await expect(dialog).toContainText(/Step 3 of 20[\s\S]*Pick the Zone tool/, {
    timeout: STEP_MS,
  });
  await expect(dialog).toContainText('Categories come from the venue', { timeout: 150_000 });
  await expect(dialog).not.toContainText('Watch:');
  // Skip stops it at once.
  await dialog.getByRole('button', { name: 'Skip the tour' }).click();
  await expect(dialog).toHaveCount(0);
});

test('the venue team does not get the tour by itself, but Help starts it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await mockOrganiser(page, { categories: true, eventScoped: false });
  await page.goto('/venue/events/ev/halls/h5/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();
  await page.waitForTimeout(800);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start the guided tour' })).toBeVisible();
  await page.locator('nav.ribbon').getByRole('button', { name: 'Help' }).click();
  await expect(dialog).toContainText(/Step 1 of 20[\s\S]*Welcome/);
});
