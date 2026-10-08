import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { ExhibitorInput, ExhibitorView, NewExhibitorInput } from './events.models';

/**
 * Exhibitors and their event registrations. Seeing them needs `bookings.view`, changing them
 * `bookings.manage`; event-scoped members see only those registered for their events.
 */
@Injectable({ providedIn: 'root' })
export class ExhibitorsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** By name; only those registered for `eventId` when given. */
  exhibitors(slug: string, eventId?: string): Observable<ExhibitorView[]> {
    const params = eventId ? new HttpParams().set('eventId', eventId) : undefined;
    return this.http.get<ExhibitorView[]>(`${this.org(slug)}/exhibitors`, { params });
  }

  createExhibitor(slug: string, input: NewExhibitorInput): Observable<ExhibitorView> {
    return this.http.post<ExhibitorView>(`${this.org(slug)}/exhibitors`, input);
  }

  updateExhibitor(
    slug: string,
    exhibitorId: string,
    input: ExhibitorInput,
  ): Observable<ExhibitorView> {
    return this.http.patch<ExhibitorView>(`${this.org(slug)}/exhibitors/${exhibitorId}`, input);
  }

  /** Only an exhibitor registered for no event. */
  deleteExhibitor(slug: string, exhibitorId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/exhibitors/${exhibitorId}`);
  }

  register(slug: string, eventId: string, exhibitorId: string): Observable<ExhibitorView> {
    return this.http.put<ExhibitorView>(
      `${this.org(slug)}/events/${eventId}/exhibitors/${exhibitorId}`,
      {},
    );
  }

  /** Not while it has bookings for the event. */
  unregister(slug: string, eventId: string, exhibitorId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/events/${eventId}/exhibitors/${exhibitorId}`);
  }
}
