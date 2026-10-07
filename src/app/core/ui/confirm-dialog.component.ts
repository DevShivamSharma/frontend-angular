import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  /** Asks for a reason, which becomes the dialog's result. */
  reasonLabel?: string;
}

/** Closes with `true` (or the reason, when one is asked for), or `undefined` when cancelled. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
      @if (data.reasonLabel) {
        <mat-form-field class="full-width">
          <mat-label>{{ data.reasonLabel }}</mat-label>
          <textarea matInput [formControl]="reason" rows="3" cdkFocusInitial></textarea>
          @if (reason.hasError('minlength') || reason.hasError('required')) {
            <mat-error>At least 3 characters.</mat-error>
          }
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        [class.danger]="data.destructive"
        [disabled]="data.reasonLabel && reason.invalid"
        (click)="confirm()"
      >
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ConfirmDialogComponent, true | string>);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3)],
  });

  protected confirm(): void {
    this.ref.close(this.data.reasonLabel ? this.reason.value.trim() : true);
  }
}
