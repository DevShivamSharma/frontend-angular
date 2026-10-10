import { expect, Locator, Page, test } from '@playwright/test';

/**
 * The planner's AI assistant with a REAL model and a real backend, used as a person would: they
 * sign in, open a hall's planner, and talk the assistant through cutting the hall into stalls.
 * When the assistant asks something back, they answer it, as a person would. The transcript is
 * printed and attached to the report.
 *
 * Skipped unless PW_LIVE_PLANNER is set. Use a hall whose plan may be changed (nothing is saved
 * unless the model is asked to save), and a running backend with an AI key:
 *
 *   PW_PORT=4200 PW_LIVE_PLANNER=/itpo/events/<event id>/halls/<hall id>/planner \
 *   PW_LIVE_EMAIL=ops@itpo.test PW_LIVE_PASSWORD=… npx playwright test assistant-live
 */
const planner = process.env['PW_LIVE_PLANNER'] ?? '';
const SHOTS = process.env['PW_SHOTS'];

test.skip(!planner, 'Set PW_LIVE_PLANNER (and PW_LIVE_EMAIL, PW_LIVE_PASSWORD) to run.');

/** How long a real model may take for one command, tool calls included. */
const COMMAND_MS = 150_000;

const stat = (page: Page, label: string) =>
  page
    .locator('dl.stats dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

class Person {
  readonly transcript: string[] = [];
  /** Chat lines when the person last spoke; what comes after is the assistant's. */
  private mark = 0;
  constructor(
    private readonly page: Page,
    private readonly chat: Locator,
  ) {}

  /** Types a message, a key at a time, and sends it. */
  async say(words: string): Promise<void> {
    this.transcript.push(`PERSON: ${words}`);
    this.mark = (await this.lines()).length;
    const box = this.page.getByRole('textbox', { name: 'Your question or command' });
    await box.click();
    await box.pressSequentially(words, { delay: 25 });
    await this.page.keyboard.press('Enter');
  }

  /**
   * Waits until the assistant is done, or opens Plan hall; returns what it said meanwhile and
   * whether Plan hall is open.
   */
  async waitForAssistant(): Promise<{ said: string; planHall: boolean }> {
    const dialog = this.page.locator('app-plan-hall-dialog');
    const stop = this.chat.getByRole('button', { name: 'Stop', exact: true });
    await expect
      .poll(
        async () =>
          (await dialog.isVisible()) ||
          ((await stop.count()) === 0 && (await this.lines()).length > this.mark + 1),
        { timeout: COMMAND_MS, intervals: [500] },
      )
      .toBe(true);
    const lines = await this.lines();
    // Past the person's own message, and past what was already reported.
    const said = lines.slice(this.mark + 1).join('\n');
    this.mark = lines.length - 1;
    if (said) this.transcript.push(`ASSISTANT: ${said}`);
    const error = this.chat.getByRole('alert');
    if (await error.isVisible()) this.transcript.push(`ERROR: ${await error.innerText()}`);
    return { said, planHall: await dialog.isVisible() };
  }

  /** Everything in the chat log, a line per message or action. */
  private async lines(): Promise<string[]> {
    return (
      await this.chat.locator('.log > p:not(.typing), .log > div:not(.empty)').allInnerTexts()
    )
      .map((t) => t.trim())
      .filter(Boolean);
  }
}

test('a person has a real AI assistant cut the hall into stalls', async ({ page }, info) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1600, height: 960 });

  // Signs in.
  const slug = planner.split('/')[1];
  await page.goto(`/${slug}/login`);
  await page.getByLabel('Email').fill(process.env['PW_LIVE_EMAIL'] ?? '');
  await page.getByLabel('Password', { exact: true }).fill(process.env['PW_LIVE_PASSWORD'] ?? '');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto(planner);
  await expect(page.locator('app-planner-canvas canvas')).toBeVisible();
  // The tour may greet a first visit; this person knows the planner.
  const tour = page.getByRole('dialog').filter({ hasText: /Step 1 of/ });
  if (await tour.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  const before = Number(await stat(page, 'Total Booths').innerText());

  await page.getByRole('button', { name: 'AI Assistant' }).click();
  const chat = page.getByRole('region', { name: 'AI Assistant' });
  const person = new Person(page, chat);

  try {
    // 1. Asks for the hall to be cut, in Hinglish, as people do.
    await person.say(
      'Poore hall mein 3x3 ke stall kaat do, numbering line wise H6- se, sab Premium category',
    );
    let turn = await person.waitForAssistant();
    // A real model may ask back first; the person answers, at most twice.
    for (let i = 0; i < 2 && !turn.planHall; i++) {
      await person.say('Haan, poora hall, 3x3 ke booth, jitne fit ho jaayein. Plan hall khol do.');
      turn = await person.waitForAssistant();
    }
    expect(turn.planHall, 'the assistant opens Plan hall').toBe(true);

    // 2. Looks at what the assistant filled in and the layouts, and takes the best.
    const dialog = page.locator('app-plan-hall-dialog');
    await expect(dialog.getByRole('button', { name: '3 × 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    person.transcript.push(
      `PLAN HALL: prefix "${await dialog.getByPlaceholder('e.g. H6-').inputValue()}", categories "${(await dialog.locator('p-multiselect').innerText()).trim()}"`,
    );
    const layouts = dialog.getByRole('radio');
    await expect(layouts.first()).not.toContainText('Checking the hall', { timeout: 60_000 });
    for (const text of await layouts.allInnerTexts()) {
      person.transcript.push(`  LAYOUT: ${text.replace(/\s+/g, ' ').trim()}`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-1-plan-hall.png` });
    await dialog.getByRole('button', { name: /^Use layout A/ }).click();
    await expect(dialog).toHaveCount(0);
    await person.waitForAssistant();
    const made = Number(await stat(page, 'Total Booths').innerText()) - before;
    person.transcript.push(`BOOTHS MADE: ${made}`);
    expect(made).toBeGreaterThan(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-2-made.png` });

    // 3. Asks how many there are; the answer should carry the count.
    await person.say('Ab hall mein kitne stall hain?');
    const { said } = await person.waitForAssistant();
    expect(said).toContain(String(before + made));

    // 4. Blocks one line, and checks the plan.
    await person.say('H6-A line ke saare stall block kar do');
    await person.waitForAssistant();
    const blocked = Number(await stat(page, 'Blocked').innerText());
    person.transcript.push(`BLOCKED: ${blocked}`);
    expect(blocked).toBeGreaterThan(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-3-blocked.png` });
  } finally {
    const text = person.transcript.join('\n');
    console.log(`\n--- transcript ---\n${text}\n------------------`);
    await info.attach('transcript', { body: text, contentType: 'text/plain' });
  }
});
