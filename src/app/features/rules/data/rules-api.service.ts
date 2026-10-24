import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import { EventRules, RuleCatalogue, RuleSet, RuleSetChanges } from './rules.models';

/** The rules endpoints of the EMS API. */
@Injectable({ providedIn: 'root' })
export class RulesApiService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(API_CONFIG).ems;

  catalogue(): Observable<RuleCatalogue> {
    return this.http.get<RuleCatalogue>(`${this.url}/rules/catalogue`);
  }

  ruleSet(): Observable<RuleSet> {
    return this.http.get<RuleSet>(`${this.url}/rules`);
  }

  updateRuleSet(changes: RuleSetChanges): Observable<RuleSet> {
    return this.http.patch<RuleSet>(`${this.url}/rules`, changes);
  }

  forEvent(eventId: string): Observable<EventRules> {
    return this.http.get<EventRules>(`${this.url}/events/${eventId}/rules`);
  }

  /** `true`/`false` switches a rule on or off for the event; `null` goes back to the default. */
  setForEvent(eventId: string, switches: Record<string, boolean | null>): Observable<EventRules> {
    return this.http.put<EventRules>(`${this.url}/events/${eventId}/rules`, { switches });
  }
}
