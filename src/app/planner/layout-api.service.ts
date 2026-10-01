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
  StallBookedResponse,
  StallPayload
} from './models/layout.model';
import { Stall } from './models/stall.model';
import { num, normalizeOpenSides } from './geometry/planner-geometry';
import { effectiveRules } from './geometry/placement-rules';
import type { PdfImportResult } from './pdf-import/pdf-import.model';
import type { PlannerRule } from './models/rule.model';

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
  eventType?: EventType,
  /** Plotting rules chosen for the layout. */
  ruleIds?: ReadonlyArray<number>
): LayoutSaveRequest {
  if (!currentHall) throw new Error('No hall selected.');

  const hall = buildHallPayload(currentHall);

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
      ...(s.stallTypeId ? { stallTypeId: s.stallTypeId } : {}),
      // Custom (e.g. L-shaped) stall: its outline and open edges; rectangles send neither.
      ...(s.footprint?.length ? { footprint: s.footprint, openEdges: s.openEdges ?? [] } : {}),
      rotation: s.rotation ?? 0,
      ...(s.parentStallNumber ? { parentStallNumber: s.parentStallNumber } : {})
    };
  });

  return {
    layoutName: layoutName.trim() || currentHall.name,
    ...(eventType ? { eventType } : {}),
    ...(ruleIds?.length ? { ruleIds: [...ruleIds] } : {}),
    hall,
    stalls
  };
}

/**
 * The hall part of every write: the layout save/update body and PUT /api/halls/{id}. Everything
 * the plan carries travels with it, so a saved hall keeps its shape, rules, labels, icons, north
 * arrow and legend.
 */
export function buildHallPayload(currentHall: Hall): HallPayload {
  return {
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
    ...(currentHall.amenities?.length ? { amenities: currentHall.amenities } : {}),
    ...(currentHall.compass ? { compass: currentHall.compass as unknown as Record<string, unknown> } : {}),
    ...(currentHall.legends?.length ? { legends: currentHall.legends } : {}),
    rules: effectiveRules(currentHall.rules) as unknown as Record<string, unknown>
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

  /**
   * `PUT /api/halls/{id}` — store a hall's plan (outline rectangles, zones, labels, icons, north
   * arrow, legend) on the master hall, e.g. after importing its SelfCare layout.
   */
  updateHall(hall: Hall): Promise<Hall> {
    return firstValueFrom(this.http.put<Hall>(`${this.api}/halls/${hall.id}`, buildHallPayload(hall)));
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

  /** Atomic server split, addressed by the persisted parent number (not database row id). */
  split(layoutId: string | number, parentNumber: string, children: StallPayload[],
    idempotencyKey: string): Promise<LayoutSaveResponse> {
    return firstValueFrom(this.http.post<LayoutSaveResponse>(
      `${this.api}/layout/${encodeURIComponent(layoutId)}/stalls/${encodeURIComponent(parentNumber)}/split`,
      { children, idempotencyKey }
    ));
  }

  /**
   * `POST /api/layout/{id}/stalls/{stallNumber}/book` — books an AVAILABLE stall. The server
   * answers 409 when someone else booked it first.
   */
  book(layoutId: string | number, stallNumber: string): Promise<StallBookedResponse> {
    return firstValueFrom(this.http.post<StallBookedResponse>(
      `${this.api}/layout/${encodeURIComponent(layoutId)}/stalls/${encodeURIComponent(stallNumber)}/book`,
      {}
    ));
  }

  /** `GET /api/planner-rules` — the shared library of plotting rules, oldest first. */
  listPlannerRules(): Promise<PlannerRule[]> {
    return firstValueFrom(this.http.get<PlannerRule[]>(`${this.api}/planner-rules`));
  }

  /** `POST /api/planner-rules` — adds a written rule to the shared library. */
  createPlannerRule(description: string): Promise<PlannerRule> {
    return firstValueFrom(this.http.post<PlannerRule>(`${this.api}/planner-rules`, { description }));
  }

  /** `GET /api/stall-types` — the stall sizes offered in draw mode (backend configuration). */
  listStallTypes(): Promise<StallType[]> {
    return firstValueFrom(this.http.get<StallType[]>(`${this.api}/stall-types`));
  }

  /**
   * `POST /api/layout/pdf-import` — the stalls the server finds in a CAD hall plan (PDF), for
   * review. Read-only on the server: nothing is stored.
   */
  importPdf(file: Blob, fileName: string): Promise<PdfImportResult> {
    const form = new FormData();
    form.append('file', file, fileName);
    return firstValueFrom(this.http.post<PdfImportResult>(`${this.api}/layout/pdf-import`, form));
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
