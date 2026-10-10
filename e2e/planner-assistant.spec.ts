import { expect, Page, test } from '@playwright/test';

/**
 * The planner's AI assistant, used as a person would: they type what they want in Hinglish, the
 * assistant opens Plan hall filled in with what they said, they pick a layout, and then they
 * change and ask about the booths in the chat. The API is mocked, and so is the model: a small
 * script answers each request with the tool calls a real model makes for it, so the planner's
 * side (tools, dialog, rules, undo) is what is tested. assistant-live.spec.ts runs a real model.
 */
const SHOTS = process.env['PW_SHOTS'];

const floor = {
  schema: 'floor/1',
  width: 40,
  depth: 30,
  areas: [{ kind: 'column', x: 19.5, y: 14.5, width: 1, height: 1, label: 'Pillar' }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

type Message = { role: string; text?: string; name?: string; result?: string };

/** What the model would do next with the conversation so far. */
function model(messages: Message[]) {
  const last = messages[messages.length - 1];
  const call = (name: string, args: Record<string, unknown>) => ({
    text: '',
    calls: [{ id: `c${messages.length}`, name, args }],
  });
  if (last.role === 'tool') {
    const result = JSON.parse(last.result ?? '{}');
    if (!result.ok) return { text: 'Ye nahi ho paya, phir se bataiye.', calls: [] };
    if (last.name === 'plan_hall') {
      return { text: `Ho gaya: ${result.added} stall bana diye (${result.layout}).`, calls: [] };
    }
    if (last.name === 'update_booths') {
      return { text: `${result.changed} stall block kar diye.`, calls: [] };
    }
    if (last.name === 'get_plan_summary') {
      const b = result.booths;
      return { text: `Hall mein ${b.total} stall hain, ${b.blocked} blocked.`, calls: [] };
    }
    return { text: 'Ho gaya.', calls: [] };
  }
  const said = (last.text ?? '').toLowerCase();
  if (said.includes('kitne')) return call('get_plan_summary', {});
  if (said.includes('block')) {
    return call('update_booths', { booths: { island: 'H5-A' }, blocked: true });
  }
  return call('plan_hall', {
    zone: 'hall',
    width: 6,
    depth: 3,
    numbering: 'line',
    prefix: 'H5-',
    categories: ['Premium'],
  });
}

async function mockPlanner(page: Page) {
  const asked: Message[][] = [];
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
          membership: { id: 'm', role: { id: 'r', name: 'Owner' }, scope: {}, eventScoped: false },
          permissions: ['events.view', 'layouts.view', 'layouts.edit'],
        },
      });
    if (path.endsWith('/assistant')) {
      const { messages } = req.postDataJSON();
      asked.push(messages);
      // A model takes a moment; the chat shows it thinking.
      await new Promise((r) => setTimeout(r, 300));
      return route.fulfill({ json: model(messages) });
    }
    if (path.endsWith('/plan/check')) return route.fulfill({ json: { findings: [] } });
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
            event: { id: 'ev', name: 'IITF 2026', kind: 'internal', audience: 'B2B' },
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
              rulesOn: 2,
              drawingProfile: 'grid',
              overlaps: [],
            },
            floor,
            rules: {
              switches: { hallBoundary: true, stallOverlap: true },
              values: { passageWidth: { B2B: 3, B2C: 4 } },
              drawingProfile: 'grid',
            },
            categories: [
              { id: 'c1', name: 'Premium', status: 'active' },
              { id: 'c2', name: 'Corner', status: 'active' },
            ],
            plan: { stalls: 0, seats: 0, revision: 0 },
          },
        },
      });
    return route.fulfill({ status: 404, json: { message: 'Not mocked ' + path } });
  });
  return { asked };
}

/** A number of the Hall Statistics card. */
const stat = (page: Page, label: string) =>
  page
    .locator('dl.stats dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** Types into the chat as a person does, a key at a time, and sends. */
async function say(page: Page, words: string) {
  const box = page.getByRole('textbox', { name: 'Your question or command' });
  await box.click();
  await box.pressSequentially(words, { delay: 15 });
  await page.keyboard.press('Enter');
}

test('a person has the assistant cut the hall into stalls, then blocks a line and asks how many', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 960 });
  const { asked } = await mockPlanner(page);
  await page.goto('/venue/events/ev/halls/h5/planner');
  // The hall's rules come first; read, then on to planning.
  await page.getByRole('button', { name: 'Start planning' }).click();
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();

  await page.getByRole('button', { name: 'AI Assistant' }).click();
  const chat = page.getByRole('region', { name: 'AI Assistant' });
  await expect(chat).toBeVisible();

  // 1. They say what they want; Plan hall opens with it filled in.
  await say(page, 'Poore hall mein 6x3 ke stall kaat do, number H5- se, sab Premium');
  await expect(chat).toContainText('Poore hall mein 6x3');
  const dialog = page.locator('app-plan-hall-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '6 × 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByPlaceholder('e.g. H6-')).toHaveValue('H5-');
  await expect(dialog.locator('p-multiselect')).toContainText('Premium');
  const layouts = dialog.getByRole('radio');
  await expect(layouts.first()).not.toContainText('Checking the hall');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-1-plan.png` });

  // They look the layouts over and take the second.
  await layouts.nth(1).click();
  const use = dialog.getByRole('button', { name: /^Use layout B/ });
  const count = Number((await use.innerText()).match(/\(([\d,]+) booths\)/)![1].replace(',', ''));
  await use.click();
  await expect(dialog).toHaveCount(0);
  await expect(chat).toContainText(`Ho gaya: ${count} stall bana diye`);
  await expect(stat(page, 'Total Booths')).toHaveText(String(count));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-2-made.png` });

  // The model was given the tools' results, and Plan hall's brief only once.
  const toolTurn = asked.find((m) => m[m.length - 1].role === 'tool')!;
  expect(JSON.parse(toolTurn[toolTurn.length - 1].result!)).toMatchObject({
    ok: true,
    added: count,
    done: expect.stringContaining('Nothing is left to choose'),
  });

  // 2. They block the first line.
  await say(page, 'A line ke saare stall block kar do');
  await expect(chat).toContainText(/\d+ stall block kar diye/);
  const blocked = Number((await stat(page, 'Blocked').innerText()).trim());
  expect(blocked).toBeGreaterThan(0);
  expect(blocked).toBeLessThan(count);

  // 3. They ask how many there are; the answer comes from the plan.
  await say(page, 'Hall mein kitne stall hain?');
  await expect(chat).toContainText(`Hall mein ${count} stall hain, ${blocked} blocked.`);

  // Each command has its own Undo in the chat: the block first, then the stalls themselves.
  const undos = chat.getByRole('button', { name: /Undo/ });
  await undos.last().click();
  await expect(stat(page, 'Blocked')).toHaveText('0');
  await expect(stat(page, 'Total Booths')).toHaveText(String(count));
  await undos.first().click();
  await expect(stat(page, 'Total Booths')).toHaveText('0');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-3-undo.png` });
});
