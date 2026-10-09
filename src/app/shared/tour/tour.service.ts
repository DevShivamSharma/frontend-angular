import { computed, effect, Injectable, signal, untracked } from '@angular/core';

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
    else void this.go(this.index() + 1);
  }

  back(): void {
    if (!this.isFirst()) void this.go(this.index() - 1);
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

  private async go(i: number): Promise<void> {
    clearTimeout(this.timer);
    this.index.set(i);
    this.status.set('pending');
    const step = this.steps()[i];
    if (!step?.before) return;
    this.preparing.set(true);
    try {
      await step.before(this.ctx);
    } finally {
      if (this.index() === i) this.preparing.set(false);
    }
  }
}
