import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { paise } from '../../../core/bookings/booking-rules';
import type { BookingView } from '../../../core/bookings/bookings.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';

export interface PortalReceiptDialogData {
  /** A booking with a settled payment. */
  booking: BookingView;
}

/**
 * The receipt for a paid stall. The amount is the stall's price before GST; GST invoices are
 * not issued here.
 */
@Component({
  selector: 'app-portal-receipt-dialog',
  imports: [DatePipe, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Receipt</h2>
    <div class="dialog-content">
      @if (data.booking.payment; as p) {
        <dl class="rows">
          <dt>Event</dt>
          <dd>{{ data.booking.event.name }}</dd>
          <dt>Hall</dt>
          <dd>{{ data.booking.hall.name }}</dd>
          <dt>Stall</dt>
          <dd>{{ data.booking.stall.label }}</dd>
          <dt>Exhibitor</dt>
          <dd>{{ data.booking.exhibitor.name }}</dd>
          <dt>Amount</dt>
          <dd>
            <b>{{ money(p.amountPaise) }}</b> <span class="muted">excl. GST</span> <br /><span
              class="muted small"
              >{{ data.booking.priceReckoning }}</span
            >
          </dd>
          @if (p.paymentId) {
            <dt>Payment id</dt>
            <dd class="mono">{{ p.paymentId }}</dd>
          }
          @if (p.method) {
            <dt>Method</dt>
            <dd>{{ p.method }}</dd>
          }
          @if (p.paidAt) {
            <dt>Paid</dt>
            <dd>{{ p.paidAt | date: 'd MMM y, HH:mm' }}</dd>
          }
          @if (p.refundedPaise > 0) {
            <dt>Refunded</dt>
            <dd>{{ money(p.refundedPaise) }}</dd>
          }
          @if (p.refundPendingPaise > 0) {
            <dt>Refund on the way</dt>
            <dd>{{ money(p.refundPendingPaise) }}</dd>
          }
        </dl>
      } @else {
        <p class="muted">There is no payment for this booking.</p>
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Close</button>
      <button pButton type="button" [outlined]="true" (click)="print()">Print</button>
    </div>
  `,
  styles: `
    .rows {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 16px;
      min-width: min(420px, 80vw);
      margin: 0;
    }
    dt {
      color: var(--app-on-surface-variant);
    }
    dd {
      margin: 0;
    }
    .small {
      font: var(--app-body-small);
    }
    .mono {
      font-family: ui-monospace, monospace;
      overflow-wrap: anywhere;
    }
  `,
})
export class PortalReceiptDialogComponent {
  protected readonly data = dialogData<PortalReceiptDialogData>();
  protected readonly ref = inject(DialogRef);
  protected readonly money = paise;

  protected print(): void {
    window.print();
  }
}
