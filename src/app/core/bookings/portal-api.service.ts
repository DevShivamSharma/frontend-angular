import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type { BookingView, PortalHoldInput, PortalView, StallMapView } from './bookings.models';

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

  /** A hold, always `held` and `external`; 403 with the reason while the portal is closed. */
  hold(slug: string, input: PortalHoldInput): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.base(slug)}/bookings`, input);
  }

  /** Only the exhibitor's own held booking; a confirmed one is cancelled by the organiser. */
  cancel(slug: string, bookingId: string, reason: string | null): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.base(slug)}/bookings/${bookingId}/cancel`, {
      reason,
    });
  }
}
