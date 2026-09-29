import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, filter, map } from 'rxjs';

import { API_BASE_URL } from '../core/api-base.token';
import { HALL_APIS, normalizeHalls } from '../home/venue-data.service';
import type { Hall as ItpoHall } from '../home/venue.models';
import { buildHallPayload } from '../planner/layout-api.service';
import { Hall } from '../planner/models/hall.model';
import { HallImportResult, PlannerRule, PlannerRuleInput } from './setup.models';

/** Progress of a plan upload: bytes first, then the server's analysis. */
export type ImportProgress =
  | { stage: 'uploading'; percent: number }
  | { stage: 'analysing' }
  | { stage: 'done'; result: HallImportResult };

/** Every HTTP call of the hall-setup steps. No component builds a URL. */
@Injectable({ providedIn: 'root' })
export class SetupApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private itpoHalls?: Promise<ItpoHall[]>;

  /** The master halls (a saved layout's private hall copies are left out). */
  listHalls(): Promise<Hall[]> {
    return firstValueFrom(this.http.get<Hall[]>(`${this.api}/halls?standalone=true`));
  }

  /** Stores a reviewed hall as a new master hall. */
  createHall(hall: Hall): Promise<Hall> {
    return firstValueFrom(this.http.post<Hall>(`${this.api}/halls`, buildHallPayload(hall)));
  }

  /** Deletes a master hall; its links to plotting rules go with it. Saved layouts keep their own copies. */
  deleteHall(id: string | number): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.api}/halls/${encodeURIComponent(id)}`));
  }

  /** Uploads a floor plan (DXF / PDF) for analysis; emits upload progress, then the result. */
  importPlan(file: File): Observable<ImportProgress> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http
      .post<HallImportResult>(`${this.api}/halls/import`, form, { reportProgress: true, observe: 'events' })
      .pipe(
        map((event: HttpEvent<HallImportResult>): ImportProgress | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const percent = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
            return percent >= 100 ? { stage: 'analysing' } : { stage: 'uploading', percent };
          }
          if (event.type === HttpEventType.Response && event.body) return { stage: 'done', result: event.body };
          return null;
        }),
        filter((p): p is ImportProgress => p !== null)
      );
  }

  /**
   * ITPO's published hall records (the ones the venue page shows), for their floor areas.
   * Cached for the session; a failure is not cached, so a later call retries.
   */
  listItpoHalls(): Promise<ItpoHall[]> {
    this.itpoHalls ??= Promise.all(
      HALL_APIS.map(url =>
        fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) }).then(r => {
          if (!r.ok) throw new Error('ITPO hall records unavailable');
          return r.json();
        })
      )
    ).then(normalizeHalls, e => {
      this.itpoHalls = undefined;
      throw e;
    });
    return this.itpoHalls;
  }

  /** The shared library of plotting rules, oldest first. */
  listRules(): Promise<PlannerRule[]> {
    return firstValueFrom(this.http.get<PlannerRule[]>(`${this.api}/planner-rules`));
  }

  createRule(input: PlannerRuleInput): Promise<PlannerRule> {
    return firstValueFrom(this.http.post<PlannerRule>(`${this.api}/planner-rules`, input));
  }

  updateRule(id: number, input: PlannerRuleInput): Promise<PlannerRule> {
    return firstValueFrom(this.http.put<PlannerRule>(`${this.api}/planner-rules/${id}`, input));
  }

  deleteRule(id: number): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.api}/planner-rules/${id}`));
  }
}
