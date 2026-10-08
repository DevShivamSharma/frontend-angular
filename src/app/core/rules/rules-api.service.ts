import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type {
  EventType,
  PlanStall,
  RuleCatalogue,
  RuleCheck,
  RuleOverride,
  RulesInput,
  RulesView,
} from './rules.models';

/** An organisation's rules: its rules and checking stalls against them. */
@Injectable({ providedIn: 'root' })
export class RulesApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/rules`;
  }

  catalogue(slug: string): Observable<RuleCatalogue> {
    return this.http.get<RuleCatalogue>(`${this.base(slug)}/catalogue`);
  }

  /** The organisation's rules; read only without `rules.manage`. */
  rules(slug: string): Observable<RulesView> {
    return this.http.get<RulesView>(this.base(slug));
  }

  update(slug: string, input: RulesInput): Observable<RulesView> {
    return this.http.patch<RulesView>(this.base(slug), input);
  }

  check(
    slug: string,
    body: {
      hallId: string;
      eventType: EventType;
      stalls: PlanStall[];
      overrides?: RuleOverride[];
    },
  ): Observable<RuleCheck> {
    return this.http.post<RuleCheck>(`${this.base(slug)}/check`, body);
  }
}
