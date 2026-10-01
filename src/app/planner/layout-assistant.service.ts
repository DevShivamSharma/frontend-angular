import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../core/api-base.token';
import type { BasicRuleId } from './geometry/basic-rules';
import { Hall } from './models/hall.model';
import { Stall } from './models/stall.model';
import { PlannedStall } from './planner-store.service';

/** What the backend is asked for: a requirement in the user's words, plus the hall it applies to. */
export interface AssistantRequest {
  requirement: string;
  hall: {
    id: string | number;
    name: string;
    shape: string;
    width: number;
    length: number;
    radius: number;
    gridCell: number;
    boundary?: unknown;
    blockedAreas?: unknown;
    zones?: unknown;
    rules?: unknown;
    markers?: unknown;
    openings?: unknown;
    eventType?: 'B2B' | 'B2C';
  };
  existingStalls: Array<{
    id?: string | number;
    rotation?: number;
    openSides?: string[];
    gateSide?: string;
    name: string;
    width: number;
    length: number;
    posX: number;
    posZ: number;
    status: string;
  }>;
}

/**
 * Rule changes the assistant proposes (action "rules"): hall-rule switches, the passage width for
 * the layout's event type, the wall clearance, and written planner rules to add. Applied only on
 * review, like stall proposals.
 */
export interface RuleChanges {
  enable: BasicRuleId[];
  disable: BasicRuleId[];
  passageWidth: number | null;
  wallClearance: number | null;
  notes: string[];
}

/** What comes back. `stalls` are proposals in hall metres; nothing is applied until reviewed. */
export interface AssistantResponse {
  action?: 'place' | 'clear' | 'none' | 'rules';
  rules?: RuleChanges | null;
  requestedCount?: number | null;
  placedCount?: number;
  clarification?: string | null;
  removals?: { id: string; name: string }[];
  source?: string;
  summary?: string;
  notes?: string[];
  stalls: PlannedStall[];
}

/**
 * The layout assistant.
 *
 * The model call belongs on the server: an Angular bundle is public, so a provider key in it
 * would be readable by anyone who opens the page. The browser only posts the requirement and
 * the hall context to `POST /api/layout/assist` and gets a plan back; `PlannerStore.reviewPlan`
 * then checks every proposed position locally before any of it can be applied.
 */
@Injectable({ providedIn: 'root' })
export class LayoutAssistantService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  plan(
    requirement: string,
    hall: Hall,
    stalls: ReadonlyArray<Stall>,
    gridCell: number
  ): Promise<AssistantResponse> {
    const body: AssistantRequest = {
      requirement,
      hall: {
        id: hall.id,
        name: hall.name,
        shape: hall.shape,
        width: hall.width,
        length: hall.length,
        radius: hall.radius,
        gridCell,
        markers: hall.markers ?? [],
        openings: hall.openings ?? [],
        eventType: (hall as Hall & { eventType?: 'B2B' | 'B2C' }).eventType,
        ...(hall.boundary?.length ? { boundary: hall.boundary } : {}),
        ...(hall.blockedAreas?.length ? { blockedAreas: hall.blockedAreas } : {}),
        ...(hall.zones?.length ? { zones: hall.zones } : {}),
        ...(hall.rules ? { rules: hall.rules } : {})
      },
      existingStalls: stalls.map(s => ({
        id: s.id,
        rotation: s.rotation ?? 0,
        openSides: s.openSides,
        gateSide: s.gateSide,
        name: s.name,
        width: s.width,
        length: s.length,
        posX: s.posX,
        posZ: s.posZ,
        status: s.status
      }))
    };

    return firstValueFrom(this.http.post<AssistantResponse>(`${this.api}/layout/assist`, body));
  }
}
