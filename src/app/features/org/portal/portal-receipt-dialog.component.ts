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
    @if (data.booking.payment; as p) {
      <!-- ── Header ── -->
      <div class="receipt-header">
        <div class="receipt-icon-ring">
          <i class="pi pi-check"></i>
        </div>
        <h2 class="receipt-title">Payment Receipt</h2>
        <span class="receipt-badge">Paid</span>
      </div>

      <div class="dialog-content">
        <!-- ── Amount hero ── -->
        <div class="amount-hero">
          <span class="amount-value">{{ money(p.amountPaise) }}</span>
          <span class="amount-note">excl. GST · {{ data.booking.priceReckoning }}</span>
        </div>

        <!-- ── Booking details ── -->
        <div class="section-label">Booking Details</div>
        <dl class="rows">
          <dt>Event</dt>
          <dd>{{ data.booking.event.name }}</dd>
          <dt>Hall</dt>
          <dd>{{ data.booking.hall.name }}</dd>
          <dt>Stall</dt>
          <dd>{{ data.booking.stall.label }}</dd>
          <dt>Exhibitor</dt>
          <dd>{{ data.booking.exhibitor.name }}</dd>
        </dl>

        <!-- ── Payment details ── -->
        <div class="divider"></div>
        <div class="section-label">Payment Details</div>
        <dl class="rows">
          @if (p.paymentId) {
            <dt>Payment ID</dt>
            <dd><code class="payment-id">{{ p.paymentId }}</code></dd>
          }
          @if (p.method) {
            <dt>Method</dt>
            <dd class="capitalize">{{ p.method }}</dd>
          }
          @if (p.paidAt) {
            <dt>Date</dt>
            <dd>{{ p.paidAt | date: 'd MMM y, HH:mm' }}</dd>
          }
        </dl>

        <!-- ── Refund rows ── -->
        @if (p.refundedPaise > 0 || p.refundPendingPaise > 0) {
          <div class="divider"></div>
          <div class="section-label">Refund Info</div>
          <dl class="rows">
            @if (p.refundedPaise > 0) {
              <dt>Refunded</dt>
              <dd class="refund-value">{{ money(p.refundedPaise) }}</dd>
            }
            @if (p.refundPendingPaise > 0) {
              <dt>Refund on the way</dt>
              <dd class="refund-pending">{{ money(p.refundPendingPaise) }}</dd>
            }
          </dl>
        }
      </div>
    } @else {
      <h2 class="dialog-title">Receipt</h2>
      <div class="dialog-content">
        <p class="muted">There is no payment for this booking.</p>
      </div>
    }

    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Close</button>
      <button pButton type="button" [outlined]="true" icon="pi pi-print" (click)="print()">
        Print
      </button>
    </div>
  `,
  styles: `
    /* ── Header ── */
    .receipt-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 28px 24px 4px;
    }

    .receipt-icon-ring {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: color-mix(in srgb, #16a34a 12%, transparent);
      color: #16a34a;
      font-size: 1.25rem;
    }

    .receipt-title {
      font: var(--app-title-large);
      margin: 0;
    }

    .receipt-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 12px;
      border-radius: 999px;
      font: var(--app-label-medium);
      background: color-mix(in srgb, #16a34a 12%, transparent);
      color: #16a34a;
    }

    /* ── Amount hero ── */
    .amount-hero {
      text-align: center;
      padding: 16px 0 20px;
    }

    .amount-value {
      display: block;
      font: var(--app-headline-medium);
    }

    .amount-note {
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
    }

    /* ── Section labels & dividers ── */
    .section-label {
      font: var(--app-label-large);
      color: var(--app-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }

    .divider {
      height: 1px;
      background: var(--app-outline-variant);
      margin: 16px 0;
    }

    /* ── Key-value rows ── */
    .rows {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 10px 20px;
      min-width: min(400px, 78vw);
      margin: 0;
    }

    dt {
      color: var(--app-on-surface-variant);
      font: var(--app-body-medium);
    }

    dd {
      margin: 0;
      font: var(--app-body-medium);
      text-align: right;
    }

    /* ── Payment ID pill ── */
    .payment-id {
      font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.8125rem;
      background: color-mix(in srgb, var(--app-on-surface) 6%, transparent);
      padding: 2px 8px;
      border-radius: 6px;
      overflow-wrap: anywhere;
      word-break: break-all;
    }

    .capitalize {
      text-transform: capitalize;
    }

    /* ── Refund values ── */
    .refund-value {
      color: #16a34a;
      font-weight: 600;
    }

    .refund-pending {
      color: var(--app-on-surface-variant);
      font-style: italic;
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

