import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { PayoutInput, SettlementView } from './events.models';

/**
 * An event's settlement. Seeing it needs `reports.view` (organisers see their own events');
 * closing it and recording the payout need `payments.manage` as well. Only events sold on the
 * platform have one.
 */
@Injectable({ providedIn: 'root' })
export class SettlementsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** Live figures while the settlement is open, frozen ones after it is closed. */
  get(slug: string, eventId: string): Observable<SettlementView> {
    return this.http.get<SettlementView>(`${this.org(slug)}/events/${eventId}/settlement`);
  }

  /** Freezes the figures; the event must be completed with no refund on the way. */
  close(slug: string, eventId: string): Observable<SettlementView> {
    return this.http.post<SettlementView>(`${this.org(slug)}/events/${eventId}/settlement/close`, {});
  }

  /** Records the bank transfer made by hand to the payee of a closed settlement. */
  payout(slug: string, eventId: string, input: PayoutInput): Observable<SettlementView> {
    return this.http.post<SettlementView>(
      `${this.org(slug)}/events/${eventId}/settlement/payout`,
      input,
    );
  }
}
