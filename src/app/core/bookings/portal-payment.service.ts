import { DOCUMENT, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  PortalReceiptDialogComponent,
  PortalReceiptDialogData,
} from '../../features/org/portal/portal-receipt-dialog.component';
import { PublicOrgStore } from '../org/org.stores';
import { PLATFORM_PRIMARY } from '../theme/app-preset';
import { HEX_COLOR } from '../theme/brand-colors';
import { AppDialog } from '../ui/app-dialog.service';
import { ConfirmService } from '../ui/confirm.service';
import { Notifier } from '../ui/notifier.service';
import { holdUntil, paise } from './booking-rules';
import type { BookingView, CheckoutView, PaymentResultView } from './bookings.models';
import { PortalApi } from './portal-api.service';
import { loadCheckout, openCheckout } from './razorpay-checkout';

const OUTCOMES: readonly string[] = [
  'confirmed',
  'revived',
  'already_paid',
  'refunding',
  'pending',
];

/**
 * Pays for a held stall: Razorpay Checkout, then the server checks what it returned. The
 * server decides whether the booking is confirmed; this only shows what happened. Under the
 * server's log transport there is no Checkout, and a test payment stands in.
 */
@Injectable({ providedIn: 'root' })
export class PortalPayment {
  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly dialog = inject(AppDialog);
  private readonly org = inject(PublicOrgStore);
  private readonly document = inject(DOCUMENT);

  /**
   * Takes payment for a held booking, with the checkout the hold came with or a fresh one.
   * Resolves with the server's verdict, or null when nothing was paid (free stall, closed
   * Checkout, a failure already shown).
   */
  async pay(
    slug: string,
    booking: BookingView,
    checkout: CheckoutView | null,
  ): Promise<PaymentResultView | null> {
    try {
      const order = checkout ?? (await firstValueFrom(this.api.pay(slug, booking.id)));
      if (!order) {
        this.notifier.warn('This stall is free of charge; the organiser confirms it.');
        return null;
      }
      const result =
        order.keyId === null
          ? await this.payInTestMode(slug, booking, order)
          : await this.payWithCheckout(slug, booking, order);
      if (result) this.show(result);
      return result;
    } catch (error) {
      // An HTTP failure was shown by the error interceptor; Checkout failing to load is not.
      if (error instanceof Error) this.notifier.error(error);
      return null;
    }
  }

  /** Under the log transport: no Checkout, so a confirmed "payment" marks the order paid. */
  private async payInTestMode(
    slug: string,
    booking: BookingView,
    order: CheckoutView,
  ): Promise<PaymentResultView | null> {
    const ok = await this.confirm.confirm({
      title: `Pay for stall ${booking.stall.label}?`,
      message: `Payments are in test mode on this server. Mark ${paise(order.amount)} as paid?`,
      confirmLabel: 'Mark as paid',
    });
    if (!ok) return null;
    const { outcome } = await firstValueFrom(this.api.devPay(order.orderId));
    const mine = await firstValueFrom(this.api.bookings(slug));
    const reloaded = mine.find((b) => b.id === booking.id);
    if (!reloaded || !OUTCOMES.includes(outcome)) {
      this.notifier.warn('The test payment was not accepted.');
      return null;
    }
    return { booking: reloaded, outcome: outcome as PaymentResultView['outcome'] };
  }

  private async payWithCheckout(
    slug: string,
    booking: BookingView,
    order: CheckoutView,
  ): Promise<PaymentResultView | null> {
    const Razorpay = await loadCheckout(this.document);
    const outcome = await openCheckout(Razorpay, order, this.color());
    if (outcome.kind === 'closed') {
      this.notifier.warn(
        `${outcome.failure ?? 'Payment not completed.'} Your hold lasts until ${holdUntil(booking)}, try again.`,
      );
      return null;
    }
    return firstValueFrom(this.api.verify(slug, booking.id, outcome.response));
  }

  /** The organisation's accent colour for Checkout's theme, else its primary. */
  private color(): string {
    const branding = this.org.config()?.branding;
    for (const c of [branding?.accentColor, branding?.primaryColor]) {
      if (c && HEX_COLOR.test(c)) return c;
    }
    return PLATFORM_PRIMARY;
  }

  /**
   * What happened, in a toast. Only a booking the server shows confirmed is a success with a
   * receipt: a payment that was settled earlier may since have gone back.
   */
  private show(result: PaymentResultView): void {
    const label = result.booking.stall.label;
    switch (result.outcome) {
      case 'pending':
        this.notifier.success(
          'Payment received; we are confirming it with Razorpay. This page updates in a moment.',
        );
        return;
      case 'refunding':
        this.notifier.error(
          null,
          'Your payment is being refunded: the stall was no longer available.',
        );
        return;
      case 'confirmed':
      case 'revived':
      case 'already_paid': {
        if (result.booking.status !== 'confirmed') {
          this.notifier.warn(
            `Payment received, but stall ${label} is not confirmed yet. Check your bookings in a moment, or contact the organiser.`,
          );
          return;
        }
        this.notifier.success(`Paid. Stall ${label} is yours.`);
        const data: PortalReceiptDialogData = { booking: result.booking };
        this.dialog.open(PortalReceiptDialogComponent, { data });
        return;
      }
    }
  }
}
