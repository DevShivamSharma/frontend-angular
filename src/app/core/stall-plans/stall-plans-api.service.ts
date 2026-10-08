import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type { SavePlanInput, StallPlanView } from './stall-plans.models';

/**
 * Stall plans of an event's halls. A 409 (the plan changed meanwhile, or its state refuses the
 * step) is shown by the plan page itself, next to a way to reload, so it raises no toast.
 */
@Injectable({ providedIn: 'root' })
export class StallPlansApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private plan(slug: string, eventId: string, hallId: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/events/${eventId}/halls/${hallId}/plan`;
  }

  /** 404 (shown by the page) while a member who only views plans has none published to see. */
  get(slug: string, eventId: string, hallId: string): Observable<StallPlanView> {
    return this.http.get<StallPlanView>(this.plan(slug, eventId, hallId), quiet(404));
  }

  save(
    slug: string,
    eventId: string,
    hallId: string,
    input: SavePlanInput,
  ): Observable<StallPlanView> {
    return this.http.put<StallPlanView>(this.plan(slug, eventId, hallId), input, quiet(409));
  }

  approve(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.step(slug, eventId, hallId, 'approve', revision);
  }

  publish(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.step(slug, eventId, hallId, 'publish', revision);
  }

  reopen(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.step(slug, eventId, hallId, 'reopen', revision);
  }

  /** Deletes a draft plan whose stalls were never booked. */
  remove(slug: string, eventId: string, hallId: string): Observable<void> {
    return this.http.delete<void>(this.plan(slug, eventId, hallId), quiet(409));
  }

  private step(
    slug: string,
    eventId: string,
    hallId: string,
    step: 'approve' | 'publish' | 'reopen',
    revision: number,
  ): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(
      `${this.plan(slug, eventId, hallId)}/${step}`,
      { revision },
      quiet(409),
    );
  }
}
