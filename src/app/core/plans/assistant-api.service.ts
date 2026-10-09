import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** The planner's AI assistant: questions about one hall of an event, answered on the server. */
@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  ask(slug: string, eventId: string, hallId: string, turns: AssistantTurn[]): Observable<string> {
    return this.http
      .post<{ reply: string }>(
        `${this.api}/orgs/${encodeURIComponent(slug)}/events/${eventId}/halls/${hallId}/assistant`,
        { turns },
      )
      .pipe(map((r) => r.reply));
  }
}
