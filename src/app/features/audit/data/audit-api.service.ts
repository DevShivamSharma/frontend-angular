import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';

export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string | null; name: string | null; email: string | null; type: string | null };
  action: string;
  event: { id: string | null; name: string | null };
  hall: { id: string | null; name: string | null };
  detail: string | null;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  size: number;
}

export interface AuditQuery {
  page: number;
  size: number;
  action?: string;
  event?: string;
  user?: string;
  /** Days, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

/** The audit trail of the portal (ITPO staff). */
@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).ems}/audit`;

  actions(): Observable<Array<{ id: string; label: string }>> {
    return this.http.get<Array<{ id: string; label: string }>>(`${this.url}/actions`);
  }

  list(query: AuditQuery): Observable<AuditPage> {
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    for (const key of ['action', 'event', 'user', 'from', 'to'] as const) {
      const value = query[key];
      if (value) params = params.set(key, value);
    }
    return this.http.get<AuditPage>(this.url, { params });
  }
}
