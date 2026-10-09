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

import { Notifier } from '../../core/ui/notifier.service';
import { TourService } from './tour.service';

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
 * huge spread shadow), a popover beside it, and click blockers: an info step blocks the whole
 * page, an action step everything but the target. Placed fixed over the page that owns it.
 */
@Component({
  selector: 'app-tour-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tour.step(); as step) {
      <div class="root">
        @if (!hole()) {
          <div class="dim"></div>
          <div class="block"></div>
        } @else {
          @let h = hole()!;
          <div
            class="spot"
            [style.top.px]="h.top"
            [style.left.px]="h.left"
            [style.width.px]="h.width"
            [style.height.px]="h.height"
          ></div>
          @if (step.action) {
            <!-- Only the target takes clicks. -->
            <div
              class="block"
              [style.top.px]="0"
              [style.left.px]="0"
              [style.right.px]="0"
              [style.height.px]="h.top"
            ></div>
            <div
              class="block"
              [style.top.px]="h.top + h.height"
              [style.left.px]="0"
              [style.right.px]="0"
              [style.bottom.px]="0"
            ></div>
            <div
              class="block"
              [style.top.px]="h.top"
              [style.left.px]="0"
              [style.width.px]="h.left"
              [style.height.px]="h.height"
            ></div>
            <div
              class="block"
              [style.top.px]="h.top"
              [style.left.px]="h.left + h.width"
              [style.right.px]="0"
              [style.height.px]="h.height"
            ></div>
            <div
              class="pulse"
              [style.top.px]="h.top"
              [style.left.px]="h.left"
              [style.width.px]="h.width"
              [style.height.px]="h.height"
            ></div>
          } @else {
            <div class="block all"></div>
          }
        }

        <div
          #dialog
          class="dialog"
          [class.centred]="!hole()"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="'tour-title-' + step.id"
          tabindex="-1"
          [style.top.px]="hole() ? place().top : null"
          [style.left.px]="hole() ? place().left : null"
        >
          <div class="head">
            <p class="count">Step {{ tour.index() + 1 }} of {{ tour.total() }}</p>
            <button
              type="button"
              class="close"
              (click)="tour.end('close')"
              aria-label="Close the tour"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          <h2 [id]="'tour-title-' + step.id">
            {{ step.title }}
            @if (step.shortcut) {
              <kbd>{{ step.shortcut }}</kbd>
            }
          </h2>
          <div class="body" aria-live="polite">
            @for (p of step.body; track $index) {
              <p>{{ p }}</p>
            }
          </div>
          @if (step.action) {
            @if (tour.status() === 'done') {
              <p class="callout done">
                <i class="pi pi-check-circle" aria-hidden="true"></i>Well done — on to the next
                step…
              </p>
            } @else {
              <p class="callout">
                <i class="pi pi-arrow-circle-right"></i
                ><span><b>Your turn:</b> {{ step.action.prompt }}</span>
              </p>
            }
          }
          <div class="track"><div class="fill" [style.width.%]="progress()"></div></div>
          <div class="foot">
            @if (tour.isLast()) {
              @if (made()) {
                <button type="button" class="link" (click)="removeMade()">
                  Remove what I made →
                </button>
              } @else {
                <span></span>
              }
            } @else {
              <button type="button" class="link" (click)="tour.end('skip')">Skip the tour</button>
            }
            <div class="buttons">
              @if (!tour.isFirst()) {
                <button type="button" class="plain" (click)="tour.back()">
                  <i class="pi pi-arrow-left" aria-hidden="true"></i>Back
                </button>
              }
              @if (step.action && tour.status() === 'pending') {
                <button type="button" class="plain skip" (click)="tour.skipStep()">
                  Next<i class="pi pi-arrow-right" aria-hidden="true"></i>
                </button>
              } @else {
                <button type="button" class="primary" data-primary (click)="tour.next()">
                  @if (tour.isLast()) {
                    <i class="pi pi-check" aria-hidden="true"></i>Finish
                  } @else {
                    {{ tour.isFirst() ? 'Start' : 'Next'
                    }}<i class="pi pi-arrow-right" aria-hidden="true"></i>
                  }
                </button>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .root {
      position: fixed;
      inset: 0;
      z-index: 340;
      pointer-events: none;
      font-family: var(--app-font-family, sans-serif);
    }
    .dim {
      position: fixed;
      inset: 0;
      background: rgb(15 23 42 / 0.6);
    }
    .spot {
      position: fixed;
      border-radius: 12px;
      box-shadow:
        0 0 0 2px rgb(255 255 255 / 0.9),
        0 0 0 9999px rgb(15 23 42 / 0.62);
      transition: all 200ms ease;
    }
    .block {
      position: fixed;
      pointer-events: auto;
    }
    .block.all,
    .dim + .block {
      inset: 0;
    }
    .pulse {
      position: fixed;
      border-radius: 12px;
      box-shadow: 0 0 0 4px #fbbf24;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.35;
      }
    }
    .dialog {
      position: fixed;
      z-index: 1;
      box-sizing: border-box;
      width: 420px;
      max-width: calc(100vw - 32px);
      padding: 16px;
      border-radius: 16px;
      background: #fff;
      color: #111827;
      box-shadow:
        0 25px 50px -12px rgb(0 0 0 / 0.25),
        0 0 0 1px rgb(0 0 0 / 0.1);
      outline: none;
      pointer-events: auto;
      transition:
        top 300ms ease,
        left 300ms ease;
    }
    .dialog.centred {
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    .count {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--app-primary);
    }
    .close {
      margin: -4px;
      padding: 4px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: #9ca3af;
      cursor: pointer;
    }
    .close:hover {
      background: #f3f4f6;
      color: #374151;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 0;
      font-size: 16px;
      font-weight: 700;
      color: #111827;
    }
    kbd {
      padding: 2px 6px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #f9fafb;
      font:
        600 11px/1.2 ui-monospace,
        monospace;
      color: #4b5563;
    }
    .body {
      display: grid;
      gap: 6px;
      margin-top: 6px;
      font-size: 14px;
      line-height: 1.6;
      color: #4b5563;
    }
    .body p {
      margin: 0;
    }
    .callout {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 10px 0 0;
      padding: 8px 12px;
      border-radius: 12px;
      background: #fffbeb;
      color: #78350f;
      box-shadow: inset 0 0 0 1px #fde68a;
      font-size: 14px;
      font-weight: 500;
    }
    .callout i {
      margin-top: 3px;
    }
    .callout.done {
      background: #ecfdf5;
      color: #064e3b;
      box-shadow: inset 0 0 0 1px #a7f3d0;
    }
    .track {
      height: 4px;
      margin-top: 12px;
      overflow: hidden;
      border-radius: 999px;
      background: #f3f4f6;
    }
    .fill {
      height: 100%;
      border-radius: 999px;
      background: var(--app-primary);
      transition: width 300ms ease;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 12px;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .foot button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: inherit;
      cursor: pointer;
    }
    .foot button i {
      font-size: 12px;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      white-space: nowrap;
      font-size: 12px !important;
      font-weight: 500 !important;
      color: #6b7280;
    }
    .link:hover {
      color: #1f2937;
    }
    .plain,
    .primary {
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 14px !important;
    }
    .plain {
      border: 1px solid #d1d5db;
      background: #fff;
      color: #374151;
      font-weight: 500 !important;
    }
    .plain.skip {
      color: #4b5563;
    }
    .plain:hover {
      background: #f9fafb;
    }
    .primary {
      padding: 6px 14px;
      border: 0;
      background: var(--app-primary);
      color: var(--app-on-primary, #fff);
      font-weight: 600 !important;
    }
    .primary:hover {
      filter: brightness(0.92);
    }
    @media (prefers-reduced-motion: reduce) {
      .spot,
      .dialog,
      .fill {
        transition: none;
      }
      .pulse {
        animation: none;
      }
    }
  `,
})
export class TourOverlayComponent {
  protected readonly tour = inject(TourService);
  private readonly notifier = inject(Notifier);
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
      if (primary && !this.tour.step()?.action) {
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
