import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, throwError, from, of } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';

import { API_CONFIG } from '../../../core/config/api-config';
import type { DrawingImportResult } from '../domain/drawing-import.models';
import type { HallFloor } from '../domain/floor.models';
import type { EventHallRules, EventKind, EventType } from '../domain/planner-hall.models';
import type {
  PlanContent,
  PlanFinding,
  PlannerView,
  PlanReview,
  StallPlanView,
} from '../domain/plan.models';

/** What the EMS API answers a plan with: the plan itself, and the review as it keeps it. */
interface RawPlan extends PlanContent {
  revision: number;
  updatedAt: string | null;
  imported?: boolean;
  published: { revision: number; at: string } | null;
  review: Omit<PlanReview, 'submittedBy' | 'reviewedBy'> | null;
}

/** What the EMS API opens the planner with. */
interface RawPlannerView {
  canEdit: boolean;
  readOnlyReason: string | null;
  canPublish: boolean;
  needsApproval: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canApprove: boolean;
  event: {
    id: string;
    name: string;
    kind: EventKind;
    approvalStatus: string | null;
    audience: EventType;
    organiserName: string | null;
  };
  hall: { id: string; hallId: number; name: string; code: string | null };
  floor: HallFloor;
  rules: EventHallRules;
  categories: Array<{ id: string; name: string }>;
  plan: RawPlan;
  findings: PlanFinding[] | null;
}

/** The stall plan of an event hall: the EMS API's planner endpoints. */
@Injectable({ providedIn: 'root' })
export class PlansApiService {
  private readonly http = inject(HttpClient);
  private readonly ems = inject(API_CONFIG).ems;

  private base(eventId: string, hallId: string): string {
    return `${this.ems}/events/${eventId}/halls/${hallId}/plan`;
  }

  get(eventId: string, hallId: string): Observable<PlannerView> {
    return this.http.get<RawPlannerView>(this.base(eventId, hallId)).pipe(map(toPlannerView));
  }

  /** The stalls of a hall's CAD plan (PDF or DXF), per hall of the drawing, for review. Nothing is saved. */
  readDrawing(
    eventId: string,
    hallId: string,
    file: Blob,
    page = 1,
  ): Observable<DrawingImportResult> {
    return this.http.post<DrawingImportResult>(
      `${this.base(eventId, hallId)}/drawing?page=${page}`,
      this.upload(file),
    );
  }

  /** The same CAD plan as a DXF drawing, its layers kept, for a CAD program. */
  drawingDxf(eventId: string, hallId: string, file: Blob, page = 1): Observable<Blob> {
    return this.http
      .post(`${this.base(eventId, hallId)}/drawing/dxf?page=${page}`, this.upload(file), {
        responseType: 'blob',
      })
      .pipe(switchMap((blob) => this.fileOrError(blob)));
  }

  private upload(file: Blob): FormData {
    const body = new FormData();
    body.append('file', file, file instanceof File ? file.name : 'plan.pdf');
    return body;
  }

  /** ITPO answers a failure with HTTP 200 and a JSON envelope, which a file download would hide. */
  private fileOrError(blob: Blob): Observable<Blob> {
    if (!blob.type.includes('json')) return of(blob);
    return from(blob.text()).pipe(
      switchMap((text) => {
        const body = JSON.parse(text) as {
          header?: { msg?: string; code?: number; error?: boolean };
        };
        return body.header?.error
          ? throwError(
              () =>
                new ApiError(
                  body.header?.msg ?? 'The drawing could not be read.',
                  body.header?.code ?? 500,
                ),
            )
          : of(blob);
      }),
    );
  }

  /** The rules the plan breaks because of `changed`, or as a whole. */
  check(
    eventId: string,
    hallId: string,
    plan: PlanContent,
    changed: string[],
  ): Observable<PlanFinding[]> {
    return this.http
      .post<{ findings: PlanFinding[] }>(`${this.base(eventId, hallId)}/check`, {
        ...plan,
        changed,
      })
      .pipe(map((r) => r.findings));
  }

  save(
    eventId: string,
    hallId: string,
    plan: PlanContent,
    revision: number,
  ): Observable<StallPlanView> {
    return this.http
      .put<RawPlan>(this.base(eventId, hallId), { ...plan, revision })
      .pipe(map(toStallPlan));
  }

  /** Publishes the saved plan; `revision` is the saved one the planner shows. */
  publish(eventId: string, hallId: string, revision: number): Observable<StallPlanView> {
    return this.http
      .post<RawPlan>(`${this.base(eventId, hallId)}/publish`, { revision })
      .pipe(map(toStallPlan));
  }

  submit(eventId: string, hallId: string, revision: number): Observable<StallPlanView> {
    return this.http
      .post<RawPlan>(`${this.base(eventId, hallId)}/submit`, { revision })
      .pipe(map(toStallPlan));
  }

  withdraw(eventId: string, hallId: string): Observable<StallPlanView> {
    return this.http
      .post<RawPlan>(`${this.base(eventId, hallId)}/withdraw`, {})
      .pipe(map(toStallPlan));
  }

  approve(eventId: string, hallId: string, revision: number): Observable<StallPlanView> {
    return this.http
      .post<RawPlan>(`${this.base(eventId, hallId)}/approve`, { revision })
      .pipe(map(toStallPlan));
  }

  reject(
    eventId: string,
    hallId: string,
    revision: number,
    note: string,
  ): Observable<StallPlanView> {
    return this.http
      .post<RawPlan>(`${this.base(eventId, hallId)}/reject`, { revision, note })
      .pipe(map(toStallPlan));
  }
}

function toStallPlan(raw: RawPlan): StallPlanView {
  return {
    ...raw,
    objects: raw.objects ?? [],
    review: raw.review ? { ...raw.review, submittedBy: null, reviewedBy: null } : null,
  };
}

/** The shape the planner was built on: the event hall as one view, and the plan beside it. */
function toPlannerView(raw: RawPlannerView): PlannerView {
  const plan = toStallPlan(raw.plan);
  const { floor } = raw;
  return {
    hall: {
      event: {
        id: raw.event.id,
        name: raw.event.name,
        kind: raw.event.kind,
        status: raw.event.approvalStatus ?? '',
        audience: raw.event.audience,
        organiserName: raw.event.organiserName,
      },
      hall: {
        hallId: raw.hall.id,
        name: raw.hall.name,
        code: raw.hall.code,
        level: null,
        venue: { id: 'itpo', name: 'ITPO' },
        width: floor.width,
        depth: floor.depth,
        floorArea: Math.round(floor.width * floor.depth * 100) / 100,
        floorVersion: 1,
        latestFloorVersion: 1,
        rulesOn: Object.values(raw.rules.switches).filter(Boolean).length,
        drawingProfile: raw.rules.drawingProfile,
        overlaps: [],
      },
      floor,
      rules: raw.rules,
      categories: raw.categories.map((c) => ({ ...c, status: 'active' as const })),
      plan: { stalls: plan.stalls.length, seats: plan.seats.length, revision: plan.revision },
    },
    plan,
    findings: raw.findings,
    // Prices come with the pricing phase.
    pricing: null,
    canEdit: raw.canEdit,
    readOnlyReason: raw.readOnlyReason,
    canPublish: raw.canPublish,
    needsApproval: raw.needsApproval,
    canSubmit: raw.canSubmit,
    canWithdraw: raw.canWithdraw,
    canApprove: raw.canApprove,
  };
}
