import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type { PublicEventView, PublicStallMapView } from './public-events.models';

/** The read-only view of an event for anyone with the link; no sign-in, nothing personal. */
@Injectable({ providedIn: 'root' })
export class PublicEventsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string, eventId: string): string {
    return `${this.api}/public/orgs/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`;
  }

  /** The page shows a failure itself, with a way to retry. */
  event(slug: string, eventId: string): Observable<PublicEventView> {
    return this.http.get<PublicEventView>(this.base(slug, eventId), quiet());
  }

  stallMap(slug: string, eventId: string, hallId: string): Observable<PublicStallMapView> {
    return this.http.get<PublicStallMapView>(
      `${this.base(slug, eventId)}/halls/${encodeURIComponent(hallId)}/stalls`,
      quiet(),
    );
  }
}
