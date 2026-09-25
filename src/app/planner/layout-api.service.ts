import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../core/api-base.token';
import { EventType, Hall, StallType } from './models/hall.model';
import {
  HallPayload,
  LayoutAuditResponse,
  LayoutDetail,
  LayoutSaveRequest,
  LayoutSaveResponse,
  LayoutSummary,
  StallPayload
} from './models/layout.model';
import { Stall } from './models/stall.model';
import { num, normalizeOpenSides } from './geometry/planner-geometry';

/**
 * Build the save/update request body. Ported from `buildApiPayload()`
 * (`App.js:548-568`).
 *
 * Two behaviours matter and are covered by unit tests:
 *  - Local ids (`local-…`, `hall-…`, `excel-hall-…`) are NOT sent, because the
 *    Java side deserializes `id` into a `Long`.
 *  - Positions are sent as `posX`/`posZ` (Java property names), not as the
 *    database column names.
 */
export function buildApiPayload(
  currentHall: Hall | null | undefined,
  currentStalls: ReadonlyArray<Stall>,
  layoutName: string,
  eventType?: EventType
): LayoutSaveRequest {
  if (!currentHall) throw new Error('No hall selected.');

  const hall: HallPayload = {
    ...(isBackendId(currentHall.id) ? { id: Number(currentHall.id) } : {}),
    name: currentHall.name,
    shape: currentHall.shape,
    width: num(currentHall.width, 0),
    length: num(currentHall.length, 0),
    radius: num(currentHall.radius, 0),
    ...(currentHall.blockedAreas?.length ? { blockedAreas: currentHall.blockedAreas } : {}),
    // Rule-driven geometry travels with the hall so a saved layout keeps its shape and rules.
    ...(currentHall.boundary?.length ? { boundary: currentHall.boundary } : {}),
    ...(currentHall.zones?.length ? { zones: currentHall.zones } : {}),
    ...(currentHall.openings?.length ? { openings: currentHall.openings } : {}),
    ...(currentHall.markers?.length ? { markers: currentHall.markers } : {}),
    ...(currentHall.rules ? { rules: currentHall.rules as Record<string, unknown> } : {})
  };

  const stalls: StallPayload[] = currentStalls.map(s => {
    const openSides = normalizeOpenSides(s.openSides, s.gateSide);

    return {
      ...(isBackendId(s.id) ? { id: Number(s.id) } : {}),
      name: String(s.name || 'Shop').trim() || 'Shop',
      width: num(s.width, 5),
      length: num(s.length, 5),
      height: num(s.height, 4),
      posX: num(s.posX, 0),
      posZ: num(s.posZ, 0),
      color: s.color || '#3498db',
      gateSide: openSides[0],
      openSides,
      // The backend keeps a number only if this layout issued it (BR-25).
      ...(s.stallNumber ? { stallNumber: s.stallNumber } : {}),
      ...(s.status && s.status !== 'AVAILABLE' ? { status: s.status } : {}),
      ...(s.stallTypeId ? { stallTypeId: s.stallTypeId } : {})
    };
  });

  return {
    layoutName: layoutName.trim() || currentHall.name,
    ...(eventType ? { eventType } : {}),
    hall,
    stalls
  };
}

/** `Number.isFinite(Number(id)) && String(id).trim() !== ''` from `App.js:553`. */
function isBackendId(id: string | number): boolean {
  return Number.isFinite(Number(id)) && String(id).trim() !== '';
}

/**
 * All saved-layout HTTP calls. Replaces the inline axios calls in the React
 * component (decision FD-004). The five paths match `App.js:499` and
 * `App.js:570-577` exactly (decision FD-005).
 */
@Injectable({ providedIn: 'root' })
export class LayoutApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  /**
   * `GET /api/halls` — the halls the planner starts from.
   *
   * These are real ITPO halls seeded from the production database
   * (`backend-nest/scripts/seed-demo-halls.ts`), replacing the two invented halls the React
   * app hardcoded. The endpoint is marked deprecated server-side because it had no consumer
   * (ADR-002); this is now its consumer.
   */
  listHalls(): Promise<Hall[]> {
    // `standalone=true` excludes the private hall copy every saved layout creates (BR-18),
    // so the picker keeps showing the master halls and does not grow with each save.
    return firstValueFrom(this.http.get<Hall[]>(`${this.api}/halls?standalone=true`));
  }

  /** `GET /api/layouts` — tolerates both a bare array and `{ layouts: [] }`. */
  async list(): Promise<LayoutSummary[]> {
    const data = await firstValueFrom(
      this.http.get<LayoutSummary[] | { layouts?: LayoutSummary[] }>(`${this.api}/layouts`)
    );

    return Array.isArray(data) ? data : data?.layouts || [];
  }

  /** `POST /api/layout/save` */
  save(payload: LayoutSaveRequest): Promise<LayoutSaveResponse> {
    return firstValueFrom(
      this.http.post<LayoutSaveResponse>(`${this.api}/layout/save`, payload)
    );
  }

  /** `GET /api/layout/{id}` */
  open(id: string | number): Promise<LayoutDetail> {
    return firstValueFrom(this.http.get<LayoutDetail>(`${this.api}/layout/${id}`));
  }

  /** `PUT /api/layout/{id}` — returns the persisted stalls, with their stall numbers. */
  update(id: string | number, payload: LayoutSaveRequest): Promise<LayoutSaveResponse> {
    return firstValueFrom(this.http.put<LayoutSaveResponse>(`${this.api}/layout/${id}`, payload));
  }

  /** `GET /api/stall-types` — the stall sizes offered in draw mode (backend configuration). */
  listStallTypes(): Promise<StallType[]> {
    return firstValueFrom(this.http.get<StallType[]>(`${this.api}/stall-types`));
  }

  /** `POST /api/layout/{id}/validate` — the server's rule audit of the saved layout. */
  audit(id: string | number): Promise<LayoutAuditResponse> {
    return firstValueFrom(this.http.post<LayoutAuditResponse>(`${this.api}/layout/${id}/validate`, {}));
  }

  /** `DELETE /api/layout/{id}` — response body is ignored, as in React. */
  delete(id: string | number): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.api}/layout/${id}`));
  }
}
