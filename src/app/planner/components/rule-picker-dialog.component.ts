import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

/**
 * "Which rules apply to this layout?" Shows the shared library of plotting rules when a design
 * starts (and from the Rules tab), and records the chosen ones on the layout: they are saved
 * with it and restored when it is opened again.
 */
@Component({
  selector: 'app-rule-picker-dialog',
  imports: [IconComponent, RouterLink],
  templateUrl: './rule-picker-dialog.component.html',
  styleUrl: './rule-picker-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RulePickerDialogComponent {
  readonly closed = output<void>();
  readonly store = inject(PlannerStore);
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private returnFocus: HTMLElement | null = null;

  /** Ticked while the dialog is open; applied only on confirm. */
  readonly picked = signal<Set<number>>(new Set());
  readonly query = signal('');

  readonly rules = this.store.plannerRules;
  readonly shown = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? this.rules().filter(r => words.every(w => r.description.toLowerCase().includes(w))) : this.rules();
  });
  readonly allPicked = computed(() => this.rules().length > 0 && this.rules().every(r => this.picked().has(r.id)));

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.picked.set(new Set(this.store.appliedRuleIds()));
    this.query.set('');
    const active = this.document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== this.document.body ? active : null;
    dialog.showModal();
  }

  toggle(id: number, on: boolean): void {
    this.picked.update(set => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  toggleAll(): void {
    this.picked.set(this.allPicked() ? new Set() : new Set(this.rules().map(r => r.id)));
  }

  /** Library order, so the rules read the same everywhere. */
  apply(): void {
    this.store.applyRules(this.rules().filter(r => this.picked().has(r.id)).map(r => r.id));
    this.dialog().nativeElement.close();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  keydown(event: KeyboardEvent): void {
    // The dialog owns keyboard input while modal; keys must not also drive the 3D editor.
    event.stopPropagation();
  }

  restoreFocus(): void {
    const target = this.returnFocus?.isConnected ? this.returnFocus : this.document.getElementById('sidebar-tab-rules');
    target?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.closed.emit();
  }
}
