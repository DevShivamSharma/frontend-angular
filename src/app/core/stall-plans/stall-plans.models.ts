import type { HallFloor } from '../api/api.models';
import type { EventStatus } from '../events/events.models';
import type { EventType, RuleCheck, RuleOverride, StallSide } from '../rules/rules.models';

/* Mirrors the backend's stall plans: the stalls of one hall of one event (Module D). */

/**
 * `draft`: being drawn. `approved`: passed the rules and approved, no longer edited.
 * `published`: sent to booking; only its stalls can be held or booked.
 */
export type StallPlanStatus = 'draft' | 'approved' | 'published';

/** SelfCare's two stall types: a shell scheme stall or bare space. */
export type StallType = 'shell' | 'bare';
export const STALL_TYPES: readonly StallType[] = ['shell', 'bare'];

/** A stall: a rectangle along the floor's axes, metres, top-left origin. */
export interface StallView {
  id: string;
  /** Unique within its plan, e.g. "A-12". */
  number: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Square metres. */
  area: number;
  openSides: StallSide[];
  stallType: StallType | null;
}

/** The rules check of a plan's saved stalls, on the floor version the event booked. */
export type RuleReport = Omit<RuleCheck, 'hall'>;

/** A rule set aside as the plan stores it: with who set it aside. */
export interface PlanRuleOverride extends RuleOverride {
  by?: string | null;
}

/** A hall's stall plan for an event, its floor and its rules report. */
export interface StallPlanView {
  /** Null while no plan has been saved for the hall. */
  id: string | null;
  event: { id: string; name: string; status: EventStatus; eventType: EventType };
  hall: { id: string; name: string; floorVersion: number; currentVersion: number };
  status: StallPlanStatus;
  /** 0 while no plan has been saved. */
  revision: number;
  stalls: StallView[];
  overrides: PlanRuleOverride[];
  approvedAt: string | null;
  publishedAt: string | null;
  /** Held or confirmed bookings on its stalls. */
  activeBookings: number;
  /** The floor version the event booked, which the stalls stand on. */
  floor: HallFloor;
  report: RuleReport;
}

/** One stall as the editor sends it; `id` is absent for a stall drawn since the plan loaded. */
export interface PlanStallInput {
  id?: string;
  number: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  openSides: StallSide[];
  stallType: StallType | null;
}

/** The whole plan as the editor holds it. `revision` 0 saves a hall's first plan. */
export interface SavePlanInput {
  revision: number;
  stalls: PlanStallInput[];
  /** Omitted keeps the plan's current overrides. */
  overrides?: RuleOverride[];
}
