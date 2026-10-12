import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { DrawingImportResult } from './drawing-import.models';
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

  /** The stalls of a hall's CAD plan PDF, per hall of the drawing, for review. Nothing is saved. */
  readDrawing(
    slug: string,
    eventId: string,
    hallId: string,
    file: Blob,
    page = 1,
  ): Observable<DrawingImportResult> {
    const body = new FormData();
    body.append('file', file, 'plan.pdf');
    return this.http.post<DrawingImportResult>(
      `${this.base(slug, eventId, hallId)}/drawing?page=${page}`,
      body,
    );
  }

  /** The same CAD plan PDF as a DXF drawing, its layers kept, for a CAD program. */
  drawingDxf(
    slug: string,
    eventId: string,
    hallId: string,
    file: Blob,
    page = 1,
  ): Observable<Blob> {
    const body = new FormData();
    body.append('file', file, 'plan.pdf');
    return this.http.post(`${this.base(slug, eventId, hallId)}/drawing/dxf?page=${page}`, body, {
      responseType: 'blob',
    });
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

  /** Publishes the saved plan; `revision` is the saved one the planner shows. */
  publish(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(`${this.base(slug, eventId, hallId)}/publish`, {
      revision,
    });
  }

  /** External events: sends the saved plan to the venue for approval. */
  submit(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(`${this.base(slug, eventId, hallId)}/submit`, {
      revision,
    });
  }

  /** Takes back a plan that waits for approval. */
  withdraw(slug: string, eventId: string, hallId: string): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(`${this.base(slug, eventId, hallId)}/withdraw`, {});
  }

  /** The venue approves the plan that waits, which publishes it. */
  approve(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
  ): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(`${this.base(slug, eventId, hallId)}/approve`, {
      revision,
    });
  }

  /** The venue sends the plan that waits back, saying what to change. */
  reject(
    slug: string,
    eventId: string,
    hallId: string,
    revision: number,
    note: string,
  ): Observable<StallPlanView> {
    return this.http.post<StallPlanView>(`${this.base(slug, eventId, hallId)}/reject`, {
      revision,
      note,
    });
  }
}
