import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { firstValueFrom } from 'rxjs';

import { paise, refundable } from '../../../core/bookings/booking-rules';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type { BookingView } from '../../../core/bookings/bookings.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

export interface RefundDialogData {
  slug: string;
  booking: BookingView;
}

/**
 * Refunds a paid booking, all that is left of it or part of it, back to the exhibitor's payment
 * method. Closes with the updated booking.
 */
@Component({
  selector: 'app-refund-dialog',
  imports: [FormsModule, ButtonModule, InputNumberModule, TextareaModule, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Refund stall {{ data.booking.stall.label }}</h2>
    <div class="dialog-content stack">
      <p class="muted">
        {{ data.booking.exhibitor.name }} paid
        {{ money(data.booking.payment?.amountPaise ?? 0) }} (excl. GST). Up to {{ money(left) }} can
        still be refunded. A full refund cancels the booking.
      </p>
      <app-field label="Amount (₹)" for="refund-amount">
        <p-inputnumber
          inputId="refund-amount"
          [ngModel]="rupees()"
          (ngModelChange)="rupees.set($event)"
          [min]="0.01"
          [max]="leftRupees"
          [minFractionDigits]="0"
          [maxFractionDigits]="2"
          [showButtons]="false"
        />
      </app-field>
      <app-field label="Reason (kept with the booking)" for="refund-reason">
        <textarea
          pTextarea
          id="refund-reason"
          rows="3"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
        ></textarea>
      </app-field>
      @if (!reasonOk()) {
        <small class="muted">At least 3 characters.</small>
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" severity="secondary" (click)="ref.close()">
        Cancel
      </button>
      <button pButton type="button" (click)="submit()" [disabled]="busy() || !valid()">
        Refund {{ amountPaise() > 0 ? money(amountPaise()) : '' }}
      </button>
    </div>
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
  `,
})
export class RefundDialogComponent {
  protected readonly data = dialogData<RefundDialogData>();
  private readonly api = inject(BookingsApi);
  protected readonly ref = inject(DialogRef);
  protected readonly money = paise;

  /** What can still be refunded, in paise and in rupees. */
  protected readonly left = refundable(this.data.booking);
  protected readonly leftRupees = this.left / 100;

  /** Starts as all that is left. */
  protected readonly rupees = signal<number | null>(this.leftRupees);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);

  protected readonly amountPaise = computed(() => Math.round((this.rupees() ?? 0) * 100));
  protected readonly reasonOk = computed(() => this.reason().trim().length >= 3);
  protected readonly valid = computed(
    () => this.amountPaise() >= 1 && this.amountPaise() <= this.left && this.reasonOk(),
  );

  protected async submit(): Promise<void> {
    if (!this.valid()) return;
    this.busy.set(true);
    try {
      this.ref.close(
        await firstValueFrom(
          this.api.refund(this.data.slug, this.data.booking.id, {
            amountPaise: this.amountPaise(),
            reason: this.reason().trim(),
          }),
        ),
      );
    } catch {
      // The error interceptor has shown it; the dialog stays open to correct or cancel.
    } finally {
      this.busy.set(false);
    }
  }
}
