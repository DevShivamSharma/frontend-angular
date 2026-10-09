import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { PlanContent, PlanFinding, PlannerView, StallPlanView } from './plans.models';

/** The stall plan of a hall of an event. */
@Injectable({ providedIn: 'root' })
export class PlansApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string, eventId: string, hallId: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/events/${eventId}/halls/${hallId}/plan`;
  }

  get(slug: string, eventId: string, hallId: string): Observable<PlannerView> {
    return this.http.get<PlannerView>(this.base(slug, eventId, hallId));
  }

  /** The rules the plan breaks because of `changed`, or as a whole. */
  check(
    slug: string,
    eventId: string,
    hallId: string,
    plan: PlanContent,
    changed: string[],
  ): Observable<PlanFinding[]> {
    return this.http
      .post<{ findings: PlanFinding[] }>(`${this.base(slug, eventId, hallId)}/check`, {
        ...plan,
        changed,
      })
      .pipe(map((r) => r.findings));
  }

  save(
    slug: string,
    eventId: string,
    hallId: string,
    plan: PlanContent,
    revision: number,
  ): Observable<StallPlanView> {
    return this.http.put<StallPlanView>(this.base(slug, eventId, hallId), { ...plan, revision });
  }
}
