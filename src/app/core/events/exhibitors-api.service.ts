import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { CreatedInvitation } from '../api/api.models';
import { API_BASE_URL } from '../api/api-base.token';
import type {
  ExhibitorInput,
  ExhibitorPeople,
  ExhibitorView,
  NewExhibitorInput,
} from './events.models';

/**
 * Exhibitors, their event registrations and their people. Seeing them needs `bookings.view`,
 * changing them `bookings.manage`; organisers see only those registered for their events.
 */
@Injectable({ providedIn: 'root' })
export class ExhibitorsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** By name; only those registered for `eventId` when given. */
  list(slug: string, eventId?: string): Observable<ExhibitorView[]> {
    const params = eventId ? new HttpParams().set('eventId', eventId) : undefined;
    return this.http.get<ExhibitorView[]>(`${this.org(slug)}/exhibitors`, { params });
  }

  create(slug: string, input: NewExhibitorInput): Observable<ExhibitorView> {
    return this.http.post<ExhibitorView>(`${this.org(slug)}/exhibitors`, input);
  }

  update(slug: string, id: string, input: ExhibitorInput): Observable<ExhibitorView> {
    return this.http.patch<ExhibitorView>(`${this.org(slug)}/exhibitors/${id}`, input);
  }

  /** Only an exhibitor registered for no event and with no people. */
  delete(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/exhibitors/${id}`);
  }

  register(slug: string, eventId: string, id: string): Observable<ExhibitorView> {
    return this.http.put<ExhibitorView>(`${this.org(slug)}/events/${eventId}/exhibitors/${id}`, {});
  }

  /** Not while it has bookings at the event. */
  unregister(slug: string, eventId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/events/${eventId}/exhibitors/${id}`);
  }

  people(slug: string, id: string): Observable<ExhibitorPeople> {
    return this.http.get<ExhibitorPeople>(`${this.org(slug)}/exhibitors/${id}/people`);
  }

  /** Invites a person who books stalls for the exhibitor. */
  invitePerson(slug: string, id: string, email: string): Observable<CreatedInvitation> {
    return this.http.post<CreatedInvitation>(`${this.org(slug)}/exhibitors/${id}/people`, {
      email,
    });
  }
}
