import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type { BookingStatus, BookingView, NewBookingInput, StallMapView } from './bookings.models';

/** Bookings as staff work them: an event's bookings and stall maps, and changes to bookings. */
@Injectable({ providedIn: 'root' })
export class BookingsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** Newest first. The page shows a failure itself, with a way to try again. */
  bookings(
    slug: string,
    filter: { eventId?: string; status?: BookingStatus } = {},
  ): Observable<BookingView[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<BookingView[]>(`${this.org(slug)}/bookings`, { params, ...quiet() });
  }

  create(slug: string, input: NewBookingInput): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings`, input);
  }

  confirm(slug: string, id: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${id}/confirm`, {});
  }

  cancel(slug: string, id: string, reason: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${id}/cancel`, { reason });
  }

  /** Refunds all that is left of the payment, or `amountPaise` of it; a full refund cancels. */
  refund(
    slug: string,
    id: string,
    input: { amountPaise?: number; reason: string },
  ): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${id}/refund`, input);
  }

  move(slug: string, id: string, hallId: string, stallId: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${id}/move`, {
      hallId,
      stallId,
    });
  }

  /** A hall's published stalls and which are free; the page shows a failure itself. */
  stallMap(slug: string, eventId: string, hallId: string): Observable<StallMapView> {
    return this.http.get<StallMapView>(
      `${this.org(slug)}/events/${eventId}/halls/${hallId}/stalls`,
      quiet(),
    );
  }
}
