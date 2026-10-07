import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type {
  DrawingChoices,
  DrawingFloorResult,
  DrawingJobView,
  HallDetailView,
  HallFloor,
  HallUses,
  HallView,
  ItpoImportPreview,
  ItpoImportResult,
  VenueView,
} from '../api/api.models';

export interface VenueInput {
  name: string;
  code: string | null;
  address: string | null;
}

export interface HallDetailsInput {
  name: string;
  code: string | null;
  level: string | null;
  uses: HallUses;
}

/** A hall drawn from nothing: an empty floor of the given size, in metres. */
export interface NewHallInput extends HallDetailsInput {
  width: number;
  depth: number;
}

export interface ItpoFile {
  format: 'csv' | 'json';
  content: string;
}

export interface ItpoImportHall {
  externalId: string;
  name: string;
  code: string | null;
  level: string | null;
}

/** Venues and their halls, within one organisation. */
@Injectable({ providedIn: 'root' })
export class VenuesApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  venues(slug: string): Observable<VenueView[]> {
    return this.http.get<VenueView[]>(`${this.org(slug)}/venues`);
  }

  venue(slug: string, venueId: string): Observable<VenueView> {
    return this.http.get<VenueView>(`${this.org(slug)}/venues/${venueId}`);
  }

  createVenue(slug: string, input: VenueInput): Observable<VenueView> {
    return this.http.post<VenueView>(`${this.org(slug)}/venues`, input);
  }

  updateVenue(slug: string, venueId: string, input: VenueInput): Observable<VenueView> {
    return this.http.patch<VenueView>(`${this.org(slug)}/venues/${venueId}`, input);
  }

  deleteVenue(slug: string, venueId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/venues/${venueId}`);
  }

  halls(slug: string, venueId: string): Observable<HallView[]> {
    return this.http.get<HallView[]>(`${this.org(slug)}/venues/${venueId}/halls`);
  }

  createHall(slug: string, venueId: string, input: NewHallInput): Observable<HallView> {
    return this.http.post<HallView>(`${this.org(slug)}/venues/${venueId}/halls`, input);
  }

  deleteHalls(slug: string, venueId: string, hallIds: string[]): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(`${this.org(slug)}/venues/${venueId}/halls/delete`, {
      hallIds,
    });
  }

  hall(slug: string, hallId: string): Observable<HallDetailView> {
    return this.http.get<HallDetailView>(`${this.org(slug)}/halls/${hallId}`);
  }

  updateHall(slug: string, hallId: string, input: HallDetailsInput): Observable<HallView> {
    return this.http.patch<HallView>(`${this.org(slug)}/halls/${hallId}`, input);
  }

  deleteHall(slug: string, hallId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/halls/${hallId}`);
  }

  floorVersion(
    slug: string,
    hallId: string,
    version: number,
  ): Observable<{ version: number; floor: HallFloor }> {
    return this.http.get<{ version: number; floor: HallFloor }>(
      `${this.org(slug)}/halls/${hallId}/versions/${version}`,
    );
  }

  restoreVersion(slug: string, hallId: string, version: number): Observable<HallDetailView> {
    return this.http.post<HallDetailView>(
      `${this.org(slug)}/halls/${hallId}/versions/${version}/restore`,
      {},
    );
  }

  previewItpo(slug: string, venueId: string, file: ItpoFile): Observable<ItpoImportPreview> {
    return this.http.post<ItpoImportPreview>(
      `${this.org(slug)}/venues/${venueId}/halls/import/itpo/preview`,
      file,
    );
  }

  importItpo(
    slug: string,
    venueId: string,
    file: ItpoFile,
    halls: ItpoImportHall[],
  ): Observable<ItpoImportResult> {
    return this.http.post<ItpoImportResult>(
      `${this.org(slug)}/venues/${venueId}/halls/import/itpo`,
      { ...file, halls },
    );
  }

  /** Uploads a plan (PDF, DXF or image) to be read; poll `drawingJob` for the result. */
  startDrawing(
    slug: string,
    venueId: string,
    file: File,
    options: { instructions: string; gridMetres: number; readText: boolean },
  ): Observable<DrawingJobView> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (options.instructions.trim()) form.append('instructions', options.instructions.trim());
    form.append('gridMetres', String(options.gridMetres));
    form.append('readText', String(options.readText));
    return this.http.post<DrawingJobView>(
      `${this.org(slug)}/venues/${venueId}/halls/import/drawing`,
      form,
    );
  }

  drawingJob(slug: string, venueId: string, jobId: string): Observable<DrawingJobView> {
    return this.http.get<DrawingJobView>(
      `${this.org(slug)}/venues/${venueId}/halls/import/drawing/${jobId}`,
    );
  }

  drawingFloor(
    slug: string,
    venueId: string,
    jobId: string,
    choices: DrawingChoices,
  ): Observable<DrawingFloorResult> {
    return this.http.post<DrawingFloorResult>(
      `${this.org(slug)}/venues/${venueId}/halls/import/drawing/${jobId}/floor`,
      choices,
    );
  }

  commitDrawing(
    slug: string,
    venueId: string,
    jobId: string,
    body: DrawingChoices & {
      name: string;
      code: string | null;
      level: string | null;
      hallId?: string;
    },
  ): Observable<HallView> {
    return this.http.post<HallView>(
      `${this.org(slug)}/venues/${venueId}/halls/import/drawing/${jobId}/commit`,
      body,
    );
  }
}
