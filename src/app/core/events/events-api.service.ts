import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type {
  EventDetailView,
  EventInput,
  EventPlanSummaryView,
  EventStatus,
  EventView,
  HallOptionView,
} from './events.models';

/** An organisation's events and the halls they book. Event-scoped members get only theirs. */
@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/events`;
  }

  /** Latest first. */
  events(
    slug: string,
    filter: { status?: EventStatus; venueId?: string } = {},
  ): Observable<EventView[]> {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    if (filter.venueId) params = params.set('venueId', filter.venueId);
    return this.http.get<EventView[]>(this.base(slug), { params });
  }

  event(slug: string, eventId: string): Observable<EventDetailView> {
    return this.http.get<EventDetailView>(`${this.base(slug)}/${eventId}`);
  }

  /** A new event starts as a draft. Only members of the whole organisation create events. */
  createEvent(slug: string, input: EventInput): Observable<EventView> {
    return this.http.post<EventView>(this.base(slug), input);
  }

  updateEvent(slug: string, eventId: string, input: EventInput): Observable<EventView> {
    return this.http.patch<EventView>(`${this.base(slug)}/${eventId}`, input);
  }

  /** `reason` is kept with a cancelled event. */
  setStatus(
    slug: string,
    eventId: string,
    status: EventStatus,
    reason?: string | null,
  ): Observable<EventView> {
    return this.http.post<EventView>(`${this.base(slug)}/${eventId}/status`, {
      status,
      ...(reason ? { reason } : {}),
    });
  }

  /** Only a draft without stall plans or bookings. */
  deleteEvent(slug: string, eventId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${eventId}`);
  }

  /** The venue's halls and which other events hold them on the event's days. */
  hallOptions(slug: string, eventId: string): Observable<HallOptionView[]> {
    return this.http.get<HallOptionView[]>(`${this.base(slug)}/${eventId}/hall-options`);
  }

  /** Books the hall on its current floor version. */
  addHall(slug: string, eventId: string, hallId: string): Observable<EventDetailView> {
    return this.http.put<EventDetailView>(`${this.base(slug)}/${eventId}/halls/${hallId}`, {});
  }

  removeHall(slug: string, eventId: string, hallId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${eventId}/halls/${hallId}`);
  }

  /** One entry per hall the event books, with its stall plan when one was saved. */
  plans(slug: string, eventId: string): Observable<EventPlanSummaryView[]> {
    return this.http.get<EventPlanSummaryView[]>(`${this.base(slug)}/${eventId}/plans`);
  }
}
