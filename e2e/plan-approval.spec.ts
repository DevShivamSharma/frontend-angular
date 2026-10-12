import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page, test } from '@playwright/test';

/**
 * An external event's plan goes to the venue for approval: the organiser sends the saved plan,
 * can take it back, and the venue approves it (which publishes it) or sends it back with a note.
 * The mocked server keeps the review as the real one does; each step is emailed there.
 */
const planner = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'hall-11-planner.json'), 'utf8'),
);

const SHOTS = process.env['PW_SHOTS'];

type Review = {
  status: 'submitted' | 'approved' | 'rejected';
  revision: number;
  submittedAt: string;
  submittedBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
};

async function mockApproval(page: Page, side: 'organiser' | 'venue') {
  const server = {
    review: null as Review | null,
    published: null as { revision: number; at: string } | null,
    calls: [] as Array<{ step: string; body: unknown }>,
    findings: [] as Array<{ ruleId: string; message: string; ids: string[] }>,
  };
  if (side === 'venue') {
    server.review = {
      status: 'submitted',
      revision: 1,
      submittedAt: '2026-10-12T10:00:00Z',
      submittedBy: 'Expo Lead',
      reviewedAt: null,
      reviewedBy: null,
      note: null,
    };
  }
  const organiser = side === 'organiser';
  // The planner's tour opens by itself for organisers the first time; this is not about it.
  await page.addInitScript(() => localStorage.setItem('vpTourAutoOff:u', '1'));
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
  const view = () => {
    const waiting = server.review?.status === 'submitted';
    return {
      ...planner,
      hall: {
        ...planner.hall,
        event: { ...planner.hall.event, kind: 'external', organiserName: 'Expo Co' },
      },
      plan: {
        ...planner.plan,
        revision: 1,
        published: server.published,
        review: server.review,
        stalls: organiser
          ? planner.plan.stalls
          : [
              stall('s1', 'A', 20, { isPremium: true, openSides: ['bottom', 'right'] }),
              stall('s2', 'B', 26),
            ],
      },
      findings: organiser ? null : server.findings,
      canEdit: organiser && !waiting,
      readOnlyReason: organiser
        ? waiting
          ? 'The plan was sent to ITPO for approval. It can change again once they answer, or after you withdraw it.'
          : null
        : 'Expo Co plans the stalls of this external event.',
      canPublish: false,
      needsApproval: true,
      canSubmit: organiser && !waiting,
      canWithdraw: organiser && waiting,
      canApprove: !organiser && waiting,
    };
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const user = { id: 'u', name: 'Someone', email: 'u@test.local', isPlatformAdmin: false };
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
            role: { id: 'r', name: organiser ? 'Organiser Admin' : 'Venue Admin' },
            scope: {},
            eventScoped: organiser,
          },
          permissions: organiser
            ? ['events.view', 'layouts.view', 'layouts.edit', 'layouts.publish']
            : ['events.view', 'layouts.view', 'layouts.approve'],
        },
      });
    const step = path.match(/\/plan\/(submit|withdraw|approve|reject)$/)?.[1];
    if (step && req.method() === 'POST') {
      const body = req.postDataJSON();
      server.calls.push({ step, body });
      const now = '2026-10-12T11:00:00Z';
      if (step === 'submit')
        server.review = {
          status: 'submitted',
          revision: body.revision,
          submittedAt: now,
          submittedBy: 'Expo Lead',
          reviewedAt: null,
          reviewedBy: null,
          note: null,
        };
      if (step === 'withdraw') server.review = null;
      if (step === 'approve' || step === 'reject') {
        server.review = {
          ...server.review!,
          status: step === 'approve' ? 'approved' : 'rejected',
          reviewedAt: now,
          reviewedBy: 'Ops',
          note: body.note ?? null,
        };
        if (step === 'approve') server.published = { revision: body.revision, at: now };
      }
      return route.fulfill({ json: view().plan });
    }
    if (path.endsWith('/plan')) return route.fulfill({ json: view() });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return server;
}

/** The hall as the event has it, an external event's. */
const view0 = () => ({
  ...planner.hall,
  event: { ...planner.hall.event, kind: 'external', organiserName: 'Expo Co' },
});

const actions = (page: Page) => page.locator('nav.ribbon .actions');

test('the organiser sends the plan for approval, and can take it back', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  const server = await mockApproval(page, 'organiser');
  await page.goto('/itpo/events/ev/halls/h11/planner');
  await page.getByRole('button', { name: 'Start planning' }).click();

  // No Publish on an external event: the venue's approval publishes it.
  await expect(actions(page).getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await actions(page).getByRole('button', { name: 'Send for approval' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Version 1 goes to ITPO, who get an email.');
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Sent for approval. You will get an email')).toBeVisible();
  expect(server.calls).toEqual([{ step: 'submit', body: { revision: 1 } }]);

  // While it waits the plan cannot change; it can be taken back.
  await expect(page.locator('.readonly')).toContainText('The plan was sent to ITPO for approval.');
  await expect(actions(page).getByRole('button', { name: 'Save' })).toHaveCount(0);
  await actions(page).getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText('Taken back. You can change the plan again.')).toBeVisible();
  await expect(page.locator('.readonly')).toHaveCount(0);
  await expect(actions(page).getByRole('button', { name: 'Send for approval' })).toBeEnabled();
});

test('the venue reviews the plan on its own screen, sends it back with a note, then approves it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  const server = await mockApproval(page, 'venue');
  await page.goto('/itpo/events/ev/halls/h11/planner');

  // A review, not the planner: no drawing tools, no rules dialog, no tour.
  const review = page.locator('app-plan-review');
  await expect(review.getByRole('heading', { name: 'Review: Hall 11' })).toBeVisible();
  await expect(review).toContainText('IITF 2026 · drawn by Expo Co · version 1');
  await expect(page.locator('nav.ribbon')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start planning' })).toHaveCount(0);
  await expect(page.locator('app-tour-overlay')).toHaveCount(0);
  await expect(review.locator('.status')).toHaveText(/Waiting for approval · v1/);
  // Opens in 3D; 2D is a click away.
  await expect(review.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(review).toContainText('It keeps every rule of the hall.');
  const holds = review.locator('section.card', { hasText: 'What it holds' });
  await expect(holds).toContainText(/Stalls\s*2/);
  await expect(holds).toContainText(/Premium\s*1/);
  await expect(holds).toContainText(/Corner \(2\+ open sides\)\s*1/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-3d.png` });

  await review.getByRole('button', { name: 'Send back' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Expo Lead gets an email with your note');
  await dialog.getByLabel('What should change').fill('Leave 3 m in front of the fire exit.');
  await dialog.getByRole('button', { name: 'Send back' }).click();
  await expect(page.getByText('Sent back. The organiser gets an email')).toBeVisible();
  await expect(review.locator('.status')).toHaveText(/Sent back · v1/);
  await expect(review.locator('blockquote')).toHaveText('Leave 3 m in front of the fire exit.');
  await expect(review.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // Sent again (as the organiser would), but a rule now breaks: it cannot be approved.
  server.review = {
    ...server.review!,
    status: 'submitted',
    reviewedAt: null,
    reviewedBy: null,
    note: null,
  };
  server.findings = [
    { ruleId: 'passage', message: 'Stall 11-01 B stands on a passage.', ids: ['s2'] },
  ];
  await page.reload();
  await expect(review).toContainText('The plan breaks 1 rule now:');
  await expect(review.getByRole('button', { name: 'Approve' })).toBeDisabled();
  // The broken rule's stall is shown on the plan, in 2D.
  await review.getByRole('button', { name: 'Stall 11-01 B stands on a passage.' }).click();
  await expect(review.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(review.locator('section.card', { hasText: 'Selected stall' })).toContainText(
    '11-01 B',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-2d.png` });

  // Fixed, then approved: it is published.
  server.findings = [];
  await page.reload();
  await review.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(
    page.getByText('Approved and published. The organiser gets an email.'),
  ).toBeVisible();
  await expect(review.locator('.status')).toHaveText(/Approved · v1/);
  expect(server.calls).toEqual([
    { step: 'reject', body: { revision: 1, note: 'Leave 3 m in front of the fire exit.' } },
    { step: 'approve', body: { revision: 1 } },
  ]);
});

test('the hall page offers the venue Review, not the planner, on an external event', async ({
  page,
}) => {
  await mockApproval(page, 'venue');
  await page.route('**/api/orgs/itpo/events/ev/halls/h11', (route) =>
    route.fulfill({
      json: {
        ...view0(),
        plan: { stalls: 2, seats: 0, revision: 1 },
      },
    }),
  );
  await page.route('**/api/orgs/itpo/rules/catalogue', (route) =>
    route.fulfill({ json: { rules: [], profiles: [] } }),
  );
  await page.route('**/api/orgs/itpo/categories', (route) => route.fulfill({ json: [] }));
  await page.goto('/itpo/events/ev/halls/h11');
  await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Plan stalls|Open stall planner/ })).toHaveCount(0);
});

test('leaving the planner closes its dialogs and toasts', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await mockApproval(page, 'organiser');
  await page.route('**/api/orgs/itpo/events/ev/halls/h11', (route) =>
    route.fulfill({ json: { ...view0(), plan: { stalls: 0, seats: 0, revision: 1 } } }),
  );
  await page.route('**/api/orgs/itpo/rules/catalogue', (route) =>
    route.fulfill({ json: { rules: [], profiles: [] } }),
  );
  await page.route('**/api/orgs/itpo/categories', (route) => route.fulfill({ json: [] }));
  await page.goto('/itpo/events/ev/halls/h11');
  await page.getByRole('link', { name: 'Open stall planner' }).click();
  await page.getByRole('button', { name: 'Start planning' }).click();

  await actions(page).getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('dialog')).toContainText('Send the plan for approval?');
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Open stall planner' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.p-dialog-mask')).toHaveCount(0);
});
