import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';

import { FieldComponent } from '../../shared/field.component';
import { dialogData, DialogRef } from './app-dialog.service';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  /** The other button; Cancel unless said. */
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  /** Asks for a reason, which becomes the dialog's result. */
  reasonLabel?: string;
  /** With a reason asked for: lets it be left empty, which confirms with `''`. */
  optional?: boolean;
}

/** Closes with `true` (or the reason, when one is asked for), or `undefined` when cancelled. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ReactiveFormsModule, ButtonModule, TextareaModule, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ data.title }}</h2>
    <div class="dialog-content">
      <p class="message">{{ data.message }}</p>
      @if (data.reasonLabel) {
        <app-field [label]="data.reasonLabel" for="confirm-reason" error="At least 3 characters.">
          <textarea
            pTextarea
            id="confirm-reason"
            [formControl]="reason"
            rows="3"
            autofocus
          ></textarea>
        </app-field>
      }
    </div>
    <div class="dialog-actions">
      <button
        pButton
        type="button"
        [label]="data.cancelLabel ?? 'Cancel'"
        [text]="true"
        severity="secondary"
        (click)="ref.close()"
      ></button>
      <button
        pButton
        type="button"
        [label]="data.confirmLabel"
        [severity]="data.destructive ? 'danger' : 'primary'"
        [disabled]="!!data.reasonLabel && reason.invalid"
        (click)="confirm()"
      ></button>
    </div>
  `,
  styles: `
    .message {
      margin: 0 0 12px;
      color: var(--app-on-surface-variant);
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly data = dialogData<ConfirmDialogData>();
  protected readonly ref = inject(DialogRef);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    // An optional reason may be empty, but a few stray characters are still not a reason.
    validators: this.data.optional
      ? [Validators.minLength(3)]
      : [Validators.required, Validators.minLength(3)],
  });

  protected confirm(): void {
    this.ref.close(this.data.reasonLabel ? this.reason.value.trim() : true);
  }
}
