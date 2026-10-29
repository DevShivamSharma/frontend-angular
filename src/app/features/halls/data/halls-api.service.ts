import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import { CreateHallPayload } from '../domain/hall-payload';
import { HallImageKind, CreatedHall, SavedHallImage } from './halls.models';

/** The hall endpoints of the EMS API. */
@Injectable({ providedIn: 'root' })
export class HallsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(API_CONFIG).ems;

  create(payload: CreateHallPayload): Observable<CreatedHall> {
    return this.http.post<CreatedHall>(`${this.url}/halls`, payload);
  }

  /** Changes a hall's details: only the fields sent change. */
  update(hallId: number, changes: Record<string, unknown>): Observable<unknown> {
    return this.http.patch(`${this.url}/halls/${hallId}`, changes);
  }

  /** Adds a picture to a hall, by the URL it is kept at. */
  addImage(
    hallId: number,
    image: { url: string; kind: HallImageKind },
  ): Observable<SavedHallImage> {
    return this.http.post<SavedHallImage>(`${this.url}/halls/${hallId}/images`, image);
  }

  removeImage(hallId: number, documentId: number): Observable<null> {
    return this.http.delete<null>(`${this.url}/halls/${hallId}/images/${documentId}`);
  }
}
