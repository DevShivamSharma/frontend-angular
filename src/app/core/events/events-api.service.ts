import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { CategoryRef } from '../categories/categories.models';
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
import type { ItpoEventDetailView, ItpoEventView, ItpoHallView } from './itpo-events.models';

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

  schedule(slug: string, id: string): Observable<EventView> {
    return this.http.post<EventView>(`${this.base(slug)}/${id}/schedule`, {});
  }

  complete(slug: string, id: string): Observable<EventView> {
    return this.http.post<EventView>(`${this.base(slug)}/${id}/complete`, {});
  }

  cancel(slug: string, id: string, reason: string | null): Observable<EventView> {
    return this.http.post<EventView>(`${this.base(slug)}/${id}/cancel`, { reason });
  }

  /** Scheduled back to draft. */
  reopen(slug: string, id: string): Observable<EventView> {
    return this.http.post<EventView>(`${this.base(slug)}/${id}/reopen`, {});
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

  // ---- ITPO's own events ----------------------------------------------------------------

  private itpo(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/itpo`;
  }

  /** ITPO's events of one kind; an organiser gets only their organisation's. */
  itpoEvents(slug: string, kind: EventKind, q = ''): Observable<ItpoEventView[]> {
    return this.http.get<ItpoEventView[]>(`${this.itpo(slug)}/events`, {
      params: q.trim() ? { kind, q: q.trim() } : { kind },
    });
  }

  itpoEvent(slug: string, id: string): Observable<ItpoEventDetailView> {
    return this.http.get<ItpoEventDetailView>(`${this.itpo(slug)}/events/${id}`);
  }

  /** Brings the ITPO event here for planning; our event's id. */
  openItpoEvent(slug: string, id: string): Observable<{ eventId: string }> {
    return this.http.post<{ eventId: string }>(`${this.itpo(slug)}/events/${id}/open`, {});
  }

  itpoHalls(slug: string): Observable<ItpoHallView[]> {
    return this.http.get<ItpoHallView[]>(`${this.itpo(slug)}/halls`);
  }

  /** Adds an ITPO hall to an internal ITPO event, as SelfCare does. */
  addItpoHall(
    slug: string,
    id: string,
    hallId: string,
    forStallFnb: boolean,
  ): Observable<ItpoEventDetailView> {
    return this.http.post<ItpoEventDetailView>(`${this.itpo(slug)}/events/${id}/halls`, {
      hallId,
      forStallFnb,
    });
  }

  /** The categories an ITPO event's halls may sell (our event's id). */
  itpoCategoryOptions(slug: string, eventId: string): Observable<CategoryRef[]> {
    return this.http.get<CategoryRef[]>(`${this.itpo(slug)}/mirrored/${eventId}/categories`);
  }

  /** What a hall of an internal ITPO event sells, here and in ITPO. */
  setItpoHallCategories(
    slug: string,
    eventId: string,
    hallId: string,
    categoryIds: string[],
  ): Observable<void> {
    return this.http.put<void>(
      `${this.itpo(slug)}/mirrored/${eventId}/halls/${hallId}/categories`,
      { categoryIds },
    );
  }
}
