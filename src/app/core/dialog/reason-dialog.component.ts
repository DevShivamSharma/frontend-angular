import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';

import { dialogData, DialogRef } from './app-dialog.service';

export interface ReasonDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  reasonLabel: string;
  /** Lets the reason be left empty, which confirms with `''`. */
  optional?: boolean;
}

/** Asks for a reason. Closes with it, or with `undefined` when cancelled. */
@Component({
  selector: 'app-reason-dialog',
  imports: [ReactiveFormsModule, ButtonModule, TextareaModule],
  templateUrl: './reason-dialog.component.html',
  styleUrl: './reason-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReasonDialogComponent {
  protected readonly data = dialogData<ReasonDialogData>();
  protected readonly ref = inject(DialogRef);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    // An optional reason may be empty, but a few stray characters are still not a reason.
    validators: this.data.optional
      ? [Validators.minLength(3)]
      : [Validators.required, Validators.minLength(3)],
  });

  protected confirm(): void {
    this.ref.close(this.reason.value.trim());
  }
}
