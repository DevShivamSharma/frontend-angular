import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { RuleId } from '../rules/rules.models';
import type {
  EventDetailView,
  EventHallDetailView,
  EventInput,
  EventInviteResult,
  EventKind,
  EventPeople,
  EventView,
} from './events.models';

/** An organisation's events, their halls with each hall's rules, and their organisers. */
@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/events`;
  }

  /** An organiser gets only their own events, whatever the kind asked for. */
  events(slug: string, kind?: EventKind): Observable<EventView[]> {
    return this.http.get<EventView[]>(this.base(slug), { params: kind ? { kind } : {} });
  }

  event(slug: string, id: string): Observable<EventDetailView> {
    return this.http.get<EventDetailView>(`${this.base(slug)}/${id}`);
  }

  create(slug: string, input: EventInput): Observable<EventView> {
    return this.http.post<EventView>(this.base(slug), input);
  }

  update(slug: string, id: string, input: EventInput): Observable<EventView> {
    return this.http.patch<EventView>(`${this.base(slug)}/${id}`, input);
  }

  delete(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${id}`);
  }

  addHalls(slug: string, id: string, hallIds: string[]): Observable<EventDetailView> {
    return this.http.post<EventDetailView>(`${this.base(slug)}/${id}/halls`, { hallIds });
  }

  hall(slug: string, id: string, hallId: string): Observable<EventHallDetailView> {
    return this.http.get<EventHallDetailView>(`${this.base(slug)}/${id}/halls/${hallId}`);
  }

  removeHall(slug: string, id: string, hallId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${id}/halls/${hallId}`);
  }

  setHallRules(
    slug: string,
    id: string,
    hallId: string,
    switches: Record<RuleId, boolean>,
  ): Observable<EventHallDetailView> {
    return this.http.patch<EventHallDetailView>(`${this.base(slug)}/${id}/halls/${hallId}/rules`, {
      switches,
    });
  }

  resetHallRules(slug: string, id: string, hallId: string): Observable<EventHallDetailView> {
    return this.http.post<EventHallDetailView>(
      `${this.base(slug)}/${id}/halls/${hallId}/rules/reset`,
      {},
    );
  }

  setHallCategories(
    slug: string,
    id: string,
    hallId: string,
    categoryIds: string[],
  ): Observable<EventHallDetailView> {
    return this.http.put<EventHallDetailView>(
      `${this.base(slug)}/${id}/halls/${hallId}/categories`,
      { categoryIds },
    );
  }

  people(slug: string, id: string): Observable<EventPeople> {
    return this.http.get<EventPeople>(`${this.base(slug)}/${id}/people`);
  }

  invite(slug: string, id: string, email: string, roleId: string): Observable<EventInviteResult> {
    return this.http.post<EventInviteResult>(`${this.base(slug)}/${id}/people`, {
      email,
      roleId,
    });
  }

  removePerson(slug: string, id: string, membershipId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${id}/people/${membershipId}`);
  }

  revokeInvitation(slug: string, id: string, invitationId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${id}/invitations/${invitationId}`);
  }
}
