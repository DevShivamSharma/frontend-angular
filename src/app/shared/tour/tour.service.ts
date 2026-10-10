import { computed, DOCUMENT, effect, inject, Injectable, signal, untracked } from '@angular/core';

import { TourEnd, TourOptions, TourStep } from './tour.models';

/** How long the "Well done" shows before the next step. */
const ADVANCE_MS = 800;

/**
 * Runs a guided tour: which step is shown, whether its action is done, and moving between
 * steps. The overlay draws it; the page that provides this service supplies the steps and the
 * context they act on.
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

  back(): void {
    if (!this.isFirst()) void this.go(this.index() - 1, -1);
  }

  /** Moves on without doing the step. */
  skipStep(): void {
    this.next();
  }

  end(reason: TourEnd): void {
    if (!this.active()) return;
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
    if (this.index() !== i || !step.target || this.shown(step.target)) return;
    const next = i + direction;
    if (next < 0) return;
    if (next >= this.total()) this.end('finish');
    else void this.go(next, direction);
  }

  private shown(selector: string): boolean {
    const el = this.document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
}
