import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { firstValueFrom } from 'rxjs';

import { httpStatus } from '../../../core/api/http-error';
import { paise } from '../../../core/bookings/booking-rules';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type { BookingView, MapStallView } from '../../../core/bookings/bookings.models';
import type { ExhibitorView } from '../../../core/events/events.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

export interface NewBookingDialogData {
  slug: string;
  eventId: string;
  eventName: string;
  hallId: string;
  hallName: string;
  stall: MapStallView;
  /** The exhibitors registered for the event. */
  exhibitors: ExhibitorView[];
}

/**
 * Books a free stall for a registered exhibitor: held, or confirmed at once. Closes with the new
 * booking, or with null when the stall was taken meanwhile (the page then shows it as it is now).
 */
@Component({
  selector: 'app-new-booking-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    SelectModule,
    TextareaModule,
    FieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Book stall {{ data.stall.label }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content stack">
        <p class="muted">
          {{ data.eventName }}, {{ data.hallName }}
          @if (data.stall.price; as p) {
            · {{ money(p.amountPaise) }} excl. GST
          }
        </p>
        @if (data.exhibitors.length) {
          <app-field
            label="Exhibitor"
            for="new-booking-exhibitor"
            hint="Only exhibitors registered for this event"
            error="Choose the exhibitor"
          >
            <p-select
              inputId="new-booking-exhibitor"
              ariaLabel="Exhibitor"
              formControlName="exhibitorId"
              [options]="data.exhibitors"
              optionLabel="name"
              optionValue="id"
              placeholder="Choose an exhibitor"
            />
          </app-field>
        } @else {
          <p class="notice" role="status">
            No exhibitor is registered for this event yet. Register one on the event's page, then
            book the stall.
          </p>
        }
        <app-field label="Note" for="new-booking-note" hint="Optional, kept with the booking">
          <textarea
            pTextarea
            id="new-booking-note"
            formControlName="note"
            rows="2"
            maxlength="500"
          ></textarea>
        </app-field>
        <span class="check">
          <p-checkbox inputId="new-booking-confirm" formControlName="confirm" [binary]="true" />
          <label for="new-booking-confirm">Confirm now</label>
        </span>
        <p class="muted small">
          @if (form.controls.confirm.value) {
            The stall is booked for the exhibitor straight away.
          } @else {
            The stall is held for the exhibitor until it is confirmed, or until the hold runs out.
          }
          No payment is taken here yet.
        </p>
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy() || !data.exhibitors.length">
          {{ form.controls.confirm.value ? 'Book stall' : 'Hold stall' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 8px;
      min-width: min(440px, 80vw);
    }
    p {
      margin: 0;
    }
    .small {
      font: var(--app-body-small);
    }
    .check {
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
    .notice {
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
  `,
})
export class NewBookingDialogComponent {
  protected readonly data = dialogData<NewBookingDialogData>();
  private readonly api = inject(BookingsApi);
  protected readonly ref = inject(DialogRef);
  protected readonly money = paise;

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
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      const booking: BookingView = await firstValueFrom(
        this.api.create(this.data.slug, {
          eventId: this.data.eventId,
          hallId: this.data.hallId,
          stallId: this.data.stall.id,
          exhibitorId: v.exhibitorId,
          note: v.note.trim() || null,
          confirm: v.confirm,
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
