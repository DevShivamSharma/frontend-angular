import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import {
  AddedHalls,
  AddHallPayload,
  CreateEventPayload,
  EventHall,
  InternalEvent,
  UpdateEventPayload,
} from './events.models';

/** The internal-event endpoints of the EMS API. */
@Injectable({ providedIn: 'root' })
export class EventsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).ems}/events`;

  create(payload: CreateEventPayload): Observable<InternalEvent> {
    return this.http.post<InternalEvent>(`${this.url}/internal`, payload);
  }

  update(eventId: string, changes: UpdateEventPayload): Observable<InternalEvent> {
    return this.http.patch<InternalEvent>(`${this.url}/${eventId}`, changes);
  }

  addHalls(eventId: string, halls: AddHallPayload[]): Observable<AddedHalls> {
    return this.http.post<AddedHalls>(`${this.url}/${eventId}/halls`, { halls });
  }

  removeHall(eventId: string, eventHallId: string): Observable<null> {
    return this.http.delete<null>(`${this.url}/${eventId}/halls/${eventHallId}`);
  }
}
