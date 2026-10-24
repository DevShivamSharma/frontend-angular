import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { NotifierService } from '../../../core/notification/notifier.service';
import { TourService } from '../tour.service';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Room around the lit-up target, and kept clear of the screen's edges, pixels. */
const PAD = 6;
const EDGE = 16;
const GAP = 12;
/** How long a step waits for its target to appear before it shows centred. */
const TARGET_WAIT_MS = 3000;

/**
 * Draws the guided tour: a dimmed page with a rounded hole over the target (one element with a
 * huge spread shadow), a popover beside it, and a click blocker over the whole page, since the
 * tour does its steps itself. Placed fixed over the page that owns it.
 */
@Component({
  selector: 'app-tour-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tour-overlay.component.html',
  styleUrl: './tour-overlay.component.scss',
})
export class TourOverlayComponent {
  protected readonly tour = inject(TourService);
  private readonly notifier = inject(NotifierService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  /** The lit-up hole, viewport pixels; null for a centred step. */
  protected readonly hole = signal<Box | null>(null);
  /** The dialog's top-left, viewport pixels. */
  protected readonly place = signal({ top: EDGE, left: EDGE });
  protected readonly made = signal<string | null>(null);
  protected readonly progress = computed(() =>
    this.tour.total() ? ((this.tour.index() + 1) / this.tour.total()) * 100 : 0,
  );

  private frame = 0;
  private stepShownAt = 0;
  private lastFocusedStep = '';

  constructor() {
    // Measures every frame while the tour runs: the target may scroll, resize or move (the
    // ribbon scrolls sideways, panels open), and the hole follows it.
    effect(() => {
      const active = this.tour.active();
      untracked(() => {
        cancelAnimationFrame(this.frame);
        if (active) this.frame = requestAnimationFrame(this.measure);
      });
    });
    effect(() => {
      const step = this.tour.step();
      untracked(() => {
        this.stepShownAt = performance.now();
        this.made.set(this.tour.isLast() ? this.tour.made() : null);
        if (!step?.target) this.hole.set(null);
        // The target is brought into view once per step, ribbon scrolled sideways if need be.
        if (step?.target) {
          setTimeout(() =>
            document
              .querySelector(step.target!)
              ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }),
          );
        }
      });
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  /** Esc leaves the tour, Enter presses the main button, Tab stays in the dialog. */
  @HostListener('document:keydown', ['$event'])
  protected key(e: KeyboardEvent): void {
    if (!this.tour.active()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.tour.end('skip');
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      const primary =
        this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('[data-primary]');
      if (primary) {
        e.preventDefault();
        primary.click();
      }
    } else if (e.key === 'Tab') {
      const el = this.dialog()?.nativeElement;
      if (!el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  protected removeMade(): void {
    const made = this.made();
    this.tour.removeMade();
    this.made.set(null);
    if (made) this.notifier.success(`Removed what you made in the tour (${made}).`);
  }

  private readonly measure = () => {
    const step = this.tour.step();
    if (!this.tour.active()) return;
    const dialog = this.dialog()?.nativeElement;
    if (step && dialog && this.lastFocusedStep !== step.id) {
      // Focus goes to the dialog once a step shows, for keyboard and screen-reader users.
      this.lastFocusedStep = step.id;
      dialog.focus({ preventScroll: true });
    }
    if (step?.target && !this.tour.preparing()) {
      const el = document.querySelector<HTMLElement>(step.target);
      const r = el?.getBoundingClientRect();
      if (r && r.width + r.height > 0) {
        const hole = {
          top: Math.round(r.top - PAD),
          left: Math.round(r.left - PAD),
          width: Math.round(r.width + PAD * 2),
          height: Math.round(r.height + PAD * 2),
        };
        if (!same(hole, this.hole())) this.hole.set(hole);
        if (dialog) this.position(hole, dialog);
      } else if (performance.now() - this.stepShownAt > TARGET_WAIT_MS) {
        // Not there: the step shows centred, and can be skipped.
        if (this.hole()) this.hole.set(null);
      }
    }
    this.frame = requestAnimationFrame(this.measure);
  };

  /** Below the target if it fits, else above, else beside it; always inside the screen. */
  private position(hole: Box, dialog: HTMLElement): void {
    const [vw, vh] = [window.innerWidth, window.innerHeight];
    const [w, h] = [dialog.offsetWidth, dialog.offsetHeight];
    const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE));
    const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - h - EDGE));
    const centreX = hole.left + hole.width / 2 - w / 2;
    const centreY = hole.top + hole.height / 2 - h / 2;
    let top: number;
    let left: number;
    if (hole.top + hole.height + GAP + h <= vh - EDGE) {
      [top, left] = [hole.top + hole.height + GAP, clampX(centreX)];
    } else if (hole.top - GAP - h >= EDGE) {
      [top, left] = [hole.top - GAP - h, clampX(centreX)];
    } else if (hole.left + hole.width + GAP + w <= vw - EDGE) {
      [top, left] = [clampY(centreY), hole.left + hole.width + GAP];
    } else if (hole.left - GAP - w >= EDGE) {
      [top, left] = [clampY(centreY), hole.left - GAP - w];
    } else {
      // A target as big as the screen (the canvas): over its lower part.
      [top, left] = [vh - h - EDGE * 2, clampX(centreX)];
    }
    const now = this.place();
    if (Math.abs(now.top - top) > 0.5 || Math.abs(now.left - left) > 0.5) {
      this.place.set({ top: Math.round(top), left: Math.round(left) });
    }
  }
}

function same(a: Box, b: Box | null): boolean {
  return (
    !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
  );
}
