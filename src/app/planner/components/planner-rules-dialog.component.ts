import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, viewChild } from '@angular/core';
import { effectiveRules } from '../geometry/placement-rules';
import { PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-planner-rules-dialog',
  imports: [IconComponent],
  templateUrl: './planner-rules-dialog.component.html',
  styleUrl: './planner-rules-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlannerRulesDialogComponent {
  readonly closed = output<void>();
  readonly store = inject(PlannerStore);
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private returnFocus: HTMLElement | null = null;
  readonly rules = computed(() => effectiveRules(this.store.currentHall()?.rules));
  readonly passage = this.store.passageWidth;

  constructor() {
    // Each visit gets the guide, without reopening it on hall/settings changes.
    afterNextRender(() => this.open());
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    const active = this.document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== this.document.body ? active : null;
    dialog.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  keepFocus(event: KeyboardEvent): void {
    // The guide owns keyboard input while modal; Escape must not also cancel a background draw.
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    // Native modal inertness blocks the page; wrap Tab as well so it cannot reach browser chrome.
    const controls = this.dialog().nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), summary, [tabindex="0"]'
    );
    const first = controls[0], last = controls[controls.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || active?.id === 'plotting-rules-title')) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault(); first?.focus();
    }
  }

  restoreFocus(): void {
    const target = this.returnFocus?.isConnected
      ? this.returnFocus : this.document.getElementById('sidebar-tab-stalls');
    target?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.closed.emit();
  }
}
