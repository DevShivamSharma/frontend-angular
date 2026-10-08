import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { httpStatus } from '../../../core/api/http-error';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type {
  BookingView,
  ExhibitorOption,
  MapStallView,
} from '../../../core/bookings/bookings.models';

export interface NewBookingDialogData {
  slug: string;
  eventId: string;
  eventName: string;
  hallName: string;
  stall: MapStallView;
  /** The exhibitors registered for the event. */
  exhibitors: ExhibitorOption[];
}

/**
 * Books a free stall for a registered exhibitor: held, or confirmed at once. Closes with the new
 * booking; with null when the stall was taken meanwhile (the page then shows it as it is now).
 */
@Component({
  selector: 'app-new-booking-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Book stall {{ data.stall.number }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="stack">
        <p class="muted">
          {{ data.hallName }} · {{ data.stall.area | number: '1.0-2' }} m² ·
          {{ data.eventName }}
        </p>
        @if (data.exhibitors.length) {
          <mat-form-field>
            <mat-label>Exhibitor</mat-label>
            <mat-select formControlName="exhibitorId" cdkFocusInitial>
              @for (x of data.exhibitors; track x.id) {
                <mat-option [value]="x.id">{{ x.name }}</mat-option>
              }
            </mat-select>
            <mat-hint>Only exhibitors registered for this event can be booked for.</mat-hint>
            <mat-error>Choose the exhibitor</mat-error>
          </mat-form-field>
        } @else {
          <p class="notice" role="status">
            No exhibitor is registered for this event yet. Register the exhibitor for the event
            first, then book the stall for it.
          </p>
        }
        <mat-form-field>
          <mat-label>Note</mat-label>
          <textarea matInput formControlName="note" rows="2" maxlength="500"></textarea>
          <mat-hint>Optional, kept with the booking</mat-hint>
        </mat-form-field>
        <mat-checkbox formControlName="confirm">Confirm now</mat-checkbox>
        <p class="muted small">
          @if (form.controls.confirm.value) {
            The stall is booked for the exhibitor at once.
          } @else {
            The stall is held for the exhibitor until someone confirms or cancels it.
          }
          No payment is taken or recorded here.
        </p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy() || !data.exhibitors.length">
          {{ form.controls.confirm.value ? 'Book stall' : 'Hold stall' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(440px, 80vw);
    }
    p {
      margin: 0 0 12px;
    }
    .small {
      font: var(--mat-sys-body-small);
      margin-top: 8px;
    }
    .notice {
      padding: 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
    }
  `,
})
export class NewBookingDialogComponent {
  protected readonly data = inject<NewBookingDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(BookingsApi);
  private readonly ref = inject(MatDialogRef<NewBookingDialogComponent, BookingView | null>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    exhibitorId: ['', Validators.required],
    note: ['', Validators.maxLength(500)],
    confirm: [false],
  });
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const value = this.form.getRawValue();
    try {
      const booking = await firstValueFrom(
        this.api.create(this.data.slug, {
          eventId: this.data.eventId,
          stallId: this.data.stall.id,
          exhibitorId: value.exhibitorId,
          note: value.note.trim() || null,
          confirm: value.confirm,
        }),
      );
      this.ref.close(booking);
    } catch (error) {
      // The error interceptor has shown it. A conflict means the stall is no longer free.
      if (httpStatus(error) === 409) this.ref.close(null);
    } finally {
      this.busy.set(false);
    }
  }
}
