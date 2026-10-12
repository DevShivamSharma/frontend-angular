import { computed, DOCUMENT, effect, inject, Injectable, signal, untracked } from '@angular/core';

import { TourEnd, TourOptions, TourStep } from './tour.models';

/** How long "Done" shows before the next step. */
const ADVANCE_MS = 600;
/** Time to read a step: per word, within these bounds. */
const READ_MS_PER_WORD = 150;
const READ_MIN_MS = 2500;
const READ_MAX_MS = 6500;
/** An action step is done this long after it shows: time to read what it does. */
const ACT_AFTER_MS = 1500;
/** An action step that did not get done in this time moves on anyway. */
const PLAY_TIMEOUT_MS = 4000;

/** How long a step shows before it moves on (info) or acts (action). */
export function readingTime(step: Pick<TourStep<unknown>, 'title' | 'body'>): number {
  const words = [step.title, ...step.body].join(' ').split(/\s+/).length;
  return Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, words * READ_MS_PER_WORD));
}

/**
 * Runs a guided tour that plays itself: which step is shown, its action done by the tour, and
 * moving on when the step has been read. The overlay draws it; the page that provides this
 * service supplies the steps and the context they act on.
 */
@Injectable()
export class TourService<C = unknown> {
  private readonly document = inject(DOCUMENT);
  readonly active = signal(false);
  readonly index = signal(0);
  readonly status = signal<'pending' | 'done'>('pending');
  /** A step is getting ready (its `before` runs): nothing is lit up meanwhile. */
  readonly preparing = signal(false);
  private readonly steps = signal<TourStep<C>[]>([]);
  private ctx!: C;
  private options: TourOptions = {};
  private timer?: ReturnType<typeof setTimeout>;
  /** Goes up with every step shown, so what an earlier step scheduled does nothing. */
  private shown = 0;

  readonly total = computed(() => this.steps().length);
  readonly step = computed<TourStep<C> | null>(() =>
    this.active() ? (this.steps()[this.index()] ?? null) : null,
  );
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() === this.total() - 1);

  constructor() {
    // An action step finishes the moment its action is done, however it was done.
    effect(() => {
      const step = this.step();
      if (!step?.action || this.status() !== 'pending' || this.preparing()) return;
      if (!step.action.done(this.ctx)) return;
      untracked(() => {
        this.status.set('done');
        const at = this.index();
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.active() && this.index() === at) this.next();
        }, ADVANCE_MS);
      });
    });
  }

  start(steps: TourStep<C>[], ctx: C, options: TourOptions = {}): void {
    this.steps.set(steps);
    this.ctx = ctx;
    this.options = options;
    this.active.set(true);
    void this.go(0);
  }

  next(): void {
    if (this.isLast()) this.end('finish');
    else void this.go(this.index() + 1, 1);
  }

  end(reason: TourEnd): void {
    if (!this.active()) return;
    this.shown++;
    clearTimeout(this.timer);
    this.active.set(false);
    this.options.onEnd?.(reason);
  }

  made(): string | null {
    return this.options.made?.() ?? null;
  }

  removeMade(): void {
    this.options.removeMade?.();
  }

  /**
   * Shows step `i`. A step whose target is not on screen after it got ready (a panel a narrow
   * screen hides) is passed over, the way the person was going.
   */
  private async go(i: number, direction: 1 | -1 = 1): Promise<void> {
    const shown = ++this.shown;
    clearTimeout(this.timer);
    this.index.set(i);
    this.status.set('pending');
    const step = this.steps()[i];
    if (!step) return;
    // A dropdown left open by the last step (a category list) would cover this one: a click
    // outside closes it, as it would for the person.
    this.document.body.click();
    this.preparing.set(true);
    try {
      await step.before?.(this.ctx);
      if (step.target) {
        // Lets what `before` opened render before looking for it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    } finally {
      if (this.index() === i) this.preparing.set(false);
    }
    if (this.index() !== i) return;
    if (!step.target || this.visible(step.target)) {
      void this.play(step, shown);
      return;
    }
    const next = i + direction;
    if (next < 0) return;
    if (next >= this.total()) this.end('finish');
    else void this.go(next, direction);
  }

  /**
   * After the step has been read, an action step does its action and the effect above moves on
   * once it is done; an info step moves on. The last step waits for Finish.
   */
  private async play(step: TourStep<C>, shown: number): Promise<void> {
    const current = () => this.active() && this.shown === shown;
    if (this.isLast()) return;
    const read = readingTime(step);
    if (!step.action) {
      this.timer = setTimeout(() => current() && this.next(), read);
      return;
    }
    await wait(ACT_AFTER_MS);
    if (!current() || this.status() === 'done') return;
    try {
      await step.action.play(this.ctx);
    } catch {
      // It could not be done here (a full hall, a rule): the tour goes on.
    }
    // Done or not, it does not wait for the person.
    await wait(PLAY_TIMEOUT_MS);
    if (current() && this.status() === 'pending') this.next();
  }

  private visible(selector: string): boolean {
    const el = this.document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
