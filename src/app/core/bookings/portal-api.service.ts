import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type {
  BookingView,
  CheckoutView,
  PaymentResultView,
  PortalHoldInput,
  PortalHoldView,
  PortalView,
  StallMapView,
} from './bookings.models';

/**
 * The exhibitor portal: an exhibitor's own user sees its events, holds free stalls for its own
 * company and lets go of its own holds. The exhibitor comes from the membership, never the call.
 */
@Injectable({ providedIn: 'root' })
export class PortalApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/portal`;
  }

  /** The page shows a failure itself, with a way to retry. */
  portal(slug: string): Observable<PortalView> {
    return this.http.get<PortalView>(this.base(slug), quiet());
  }

  /** Other exhibitors' stalls come as held or booked, without a name. */
  stallMap(slug: string, eventId: string, hallId: string): Observable<StallMapView> {
    return this.http.get<StallMapView>(
      `${this.base(slug)}/events/${eventId}/halls/${hallId}/stalls`,
      quiet(),
    );
  }

  bookings(slug: string): Observable<BookingView[]> {
    return this.http.get<BookingView[]>(`${this.base(slug)}/bookings`, quiet());
  }

  /** A hold; 403 with the reason while the portal is closed. `checkout` is for paying (M6). */
  hold(slug: string, input: PortalHoldInput): Observable<PortalHoldView> {
    return this.http.post<PortalHoldView>(`${this.base(slug)}/bookings`, input);
  }

  /** Only the exhibitor's own held booking; a confirmed one is cancelled by the organiser. */
  cancel(slug: string, id: string, reason: string | null): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.base(slug)}/bookings/${id}/cancel`, { reason });
  }

  /**
   * A fresh order to pay for an own held booking; null when there is nothing to pay (a free
   * stall). Checkout's success handler gives `verify` its body.
   */
  pay(slug: string, id: string): Observable<CheckoutView | null> {
    return this.http.post<CheckoutView | null>(`${this.base(slug)}/bookings/${id}/payment`, {});
  }

  /** Checks what Checkout returned; the server confirms the booking when the money is in. */
  verify(
    slug: string,
    id: string,
    body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
  ): Observable<PaymentResultView> {
    return this.http.post<PaymentResultView>(
      `${this.base(slug)}/bookings/${id}/payment/verify`,
      body,
    );
  }

  /** The log transport's stand-in for Checkout; the server answers 404 under any other. */
  devPay(orderId: string): Observable<{ outcome: string }> {
    return this.http.post<{ outcome: string }>(
      `${this.api}/dev/payments/${encodeURIComponent(orderId)}/pay`,
      {},
    );
  }
}
