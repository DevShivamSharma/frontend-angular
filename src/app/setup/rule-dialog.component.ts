import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';

import { extractErrorMessage } from '../core/http-error.util';
import { SetupApiService } from './setup-api.service';
import type { PlannerRule } from './setup.models';

export const MAX_RULE_LENGTH = 2000;

/** Add or edit a plotting rule of the shared library. */
@Component({
  selector: 'app-rule-dialog',
  templateUrl: './rule-dialog.component.html',
  styleUrl: './rule-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RuleDialogComponent {
  private readonly api = inject(SetupApiService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly text = viewChild.required<ElementRef<HTMLTextAreaElement>>('text');

  readonly saved = output<PlannerRule>();

  readonly editing = signal<PlannerRule | null>(null);
  readonly description = signal('');
  readonly busy = signal(false);
  readonly submitted = signal(false);
  readonly serverError = signal('');

  readonly max = MAX_RULE_LENGTH;
  readonly length = computed(() => this.description().trim().length);
  readonly textError = computed(() => {
    if (!this.length()) return 'Describe the rule.';
    if (this.length() > MAX_RULE_LENGTH) return `Keep the rule under ${MAX_RULE_LENGTH} characters.`;
    return '';
  });

  /** Opens for a new rule, or to edit `rule`. */
  open(rule: PlannerRule | null): void {
    this.editing.set(rule);
    this.description.set(rule?.description ?? '');
    this.submitted.set(false);
    this.serverError.set('');
    this.dialog().nativeElement.showModal();
    queueMicrotask(() => this.text().nativeElement.focus());
  }

  close(): void {
    if (!this.busy()) this.dialog().nativeElement.close();
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.submit();
    }
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    this.serverError.set('');
    if (this.textError() || this.busy()) return;
    this.busy.set(true);
    const input = { description: this.description().trim() };
    try {
      const rule = this.editing();
      const saved = rule ? await this.api.updateRule(rule.id, input) : await this.api.createRule(input);
      this.busy.set(false);
      this.dialog().nativeElement.close();
      this.saved.emit(saved);
    } catch (e) {
      this.busy.set(false);
      this.serverError.set(extractErrorMessage(e));
    }
  }
}
