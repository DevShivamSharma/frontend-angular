import { DOCUMENT } from '@angular/common';
import {
  afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect,
  ElementRef, inject, Injector, input, output, signal, viewChild
} from '@angular/core';

export interface PlannerTourStep {
  id: 'hall' | 'stall' | 'position' | 'details' | 'save';
  title: string;
  message: string;
  targets: readonly string[];
}

interface Box { left: number; top: number; width: number; height: number }

@Component({
  selector: 'app-planner-tour',
  templateUrl: './planner-tour.component.html',
  styleUrl: './planner-tour.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlannerTourComponent {
  readonly step = input.required<PlannerTourStep>();
  readonly index = input.required<number>();
  readonly total = input.required<number>();
  readonly next = output<void>();
  readonly back = output<void>();
  readonly skip = output<void>();
  readonly finish = output<void>();
  readonly cardHeight = output<number>();
  readonly highlight = signal<Box | null>(null);
  readonly position = signal({ left: 12, top: 12 });
  readonly ready = signal(false);

  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly win = this.document.defaultView!;
  private observer?: ResizeObserver;
  private mutations?: MutationObserver;
  private target: HTMLElement | null = null;
  private frame = 0;
  private focusPending = true;
  private lastHeight = 0;

  constructor() {
    effect(() => {
      this.step();
      this.focusPending = true;
      if (this.target) this.observer?.unobserve(this.target);
      this.target = null;
      this.ready.set(false);
      afterNextRender(() => this.queue(), { injector: this.injector });
    });
    afterNextRender(() => {
      this.observer = new ResizeObserver(() => this.queue());
      this.observer.observe(this.card().nativeElement);
      const root = this.host.nativeElement.parentElement!;
      this.mutations = new MutationObserver(() => this.queue());
      // The card lives outside .planner, so its own measurements cannot retrigger this.
      const planner = root.querySelector('.planner');
      if (planner) this.mutations.observe(planner, { childList: true, subtree: true });
      this.document.addEventListener('scroll', this.queue, true);
      this.document.addEventListener('keydown', this.onKey, true);
      this.win.addEventListener('resize', this.queue);
      this.win.visualViewport?.addEventListener('resize', this.queue);
      this.win.visualViewport?.addEventListener('scroll', this.queue);
      this.queue();
    });
    inject(DestroyRef).onDestroy(() => {
      this.win.cancelAnimationFrame(this.frame);
      this.observer?.disconnect();
      this.mutations?.disconnect();
      this.document.removeEventListener('scroll', this.queue, true);
      this.document.removeEventListener('keydown', this.onKey, true);
      this.win.removeEventListener('resize', this.queue);
      this.win.visualViewport?.removeEventListener('resize', this.queue);
      this.win.visualViewport?.removeEventListener('scroll', this.queue);
    });
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    // Let an open hall picker or modal handle its own Escape first.
    if (event.key !== 'Escape' || this.document.querySelector(':popover-open, dialog[open]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.skip.emit();
  };

  private readonly queue = (): void => {
    if (this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  };

  private measure(): void {
    const card = this.card().nativeElement;
    const viewport = this.win.visualViewport;
    const width = viewport?.width ?? this.win.innerWidth;
    const height = viewport?.height ?? this.win.innerHeight;
    const ox = viewport?.offsetLeft ?? 0, oy = viewport?.offsetTop ?? 0;
    const compact = this.win.matchMedia('(max-width: 900px)').matches;
    const cardBox = card.getBoundingClientRect();
    const reserve = Math.ceil(cardBox.height + 24);
    if (reserve !== this.lastHeight) {
      this.lastHeight = reserve;
      this.cardHeight.emit(reserve);
      // Apply the reserved mobile space before scrolling the target into view.
      afterNextRender(() => {
        this.target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        this.queue();
      }, { injector: this.injector });
      return;
    }
    const root = this.host.nativeElement.parentElement!;
    const target = this.step().targets.flatMap(selector =>
      Array.from(root.querySelectorAll<HTMLElement>(selector))
    ).find(el => el.getClientRects().length > 0 && !el.closest('[inert], [hidden]')) ?? null;

    if (target !== this.target) {
      if (this.target) this.observer?.unobserve(this.target);
      this.target = target;
      if (target) {
        this.observer?.observe(target);
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    }
    const usableBottom = oy + height - (compact ? reserve : 8);
    const box = target ? this.visibleBox(target, ox + 6, oy + 6, ox + width - 6, usableBottom) : null;
    this.highlight.set(box);
    let left = ox + 12, top = oy + height - cardBox.height - 12;
    if (!compact && box) {
      const gap = 16;
      const fitsRight = box.left + box.width + gap + cardBox.width <= ox + width - 12;
      const fitsLeft = box.left - gap - cardBox.width >= ox + 12;
      if (fitsRight || fitsLeft) {
        left = fitsRight ? box.left + box.width + gap : box.left - gap - cardBox.width;
        top = box.top;
      } else {
        left = box.left;
        top = box.top + box.height + gap + cardBox.height <= oy + height - 12
          ? box.top + box.height + gap : box.top - gap - cardBox.height;
      }
    }
    this.position.set({
      left: Math.max(ox + 12, Math.min(left, ox + width - cardBox.width - 12)),
      top: Math.max(oy + 12, Math.min(top, oy + height - cardBox.height - 12))
    });
    this.ready.set(true);
    if (this.focusPending) {
      this.focusPending = false;
      // A visibility:hidden element cannot take focus until Angular renders is-ready.
      afterNextRender(() => this.heading().nativeElement.focus({ preventScroll: true }),
        { injector: this.injector });
    }
  }

  /** Clip the spotlight to scrolling panels, so it never highlights hidden content. */
  private visibleBox(el: HTMLElement, left: number, top: number, right: number, bottom: number): Box | null {
    const rect = el.getBoundingClientRect();
    left = Math.max(left, rect.left - 4);
    top = Math.max(top, rect.top - 4);
    right = Math.min(right, rect.right + 4);
    bottom = Math.min(bottom, rect.bottom + 4);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = this.win.getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
  }
}
