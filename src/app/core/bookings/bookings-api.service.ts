import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type { EventPlanSummaryView } from '../events/events.models';
import type {
  BookingEventView,
  BookingStatus,
  BookingView,
  ExhibitorOption,
  NewBookingInput,
  SelfcareBookingPayload,
  SelfcareRowInput,
  StallMapView,
} from './bookings.models';

/**
 * Bookings as staff see them: an event's bookings and stall maps, and booking a stall for a
 * registered exhibitor. Also the event, plan and exhibitor reads the bookings page needs.
 */
@Injectable({ providedIn: 'root' })
export class BookingsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** Newest first. The page shows a failure itself, with a way to retry. */
  bookings(
    slug: string,
    filter: { eventId?: string; exhibitorId?: string; status?: BookingStatus } = {},
  ): Observable<BookingView[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<BookingView[]>(`${this.org(slug)}/bookings`, { params, ...quiet() });
  }

  booking(slug: string, bookingId: string): Observable<BookingView> {
    return this.http.get<BookingView>(`${this.org(slug)}/bookings/${bookingId}`);
  }

  create(slug: string, input: NewBookingInput): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings`, input);
  }

  confirm(slug: string, bookingId: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${bookingId}/confirm`, {});
  }

  cancel(slug: string, bookingId: string, reason: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${bookingId}/cancel`, {
      reason,
    });
  }

  move(slug: string, bookingId: string, stallId: string): Observable<BookingView> {
    return this.http.post<BookingView>(`${this.org(slug)}/bookings/${bookingId}/move`, {
      stallId,
    });
  }

  /** The held booking as SelfCare rows; nothing is stored or sent anywhere by the server. */
  selfcareRow(
    slug: string,
    bookingId: string,
    input: SelfcareRowInput,
  ): Observable<SelfcareBookingPayload> {
    return this.http.post<SelfcareBookingPayload>(
      `${this.org(slug)}/bookings/${bookingId}/selfcare-row`,
      input,
    );
  }

  /** 404 while the hall has no published plan; the caller shows that itself. */
  stallMap(slug: string, eventId: string, hallId: string): Observable<StallMapView> {
    return this.http.get<StallMapView>(
      `${this.org(slug)}/events/${eventId}/halls/${hallId}/stalls`,
      quiet(),
    );
  }

  /** The event and the halls it books. */
  event(slug: string, eventId: string): Observable<BookingEventView> {
    return this.http.get<BookingEventView>(`${this.org(slug)}/events/${eventId}`, quiet());
  }

  /** Each hall's plan status; needs `layouts.view`, so a 403 is handled by the caller. */
  plans(slug: string, eventId: string): Observable<EventPlanSummaryView[]> {
    return this.http.get<EventPlanSummaryView[]>(
      `${this.org(slug)}/events/${eventId}/plans`,
      quiet(),
    );
  }

  /** The exhibitors registered for the event. */
  exhibitors(slug: string, eventId: string): Observable<ExhibitorOption[]> {
    return this.http.get<ExhibitorOption[]>(`${this.org(slug)}/exhibitors`, {
      params: new HttpParams().set('eventId', eventId),
    });
  }
}
