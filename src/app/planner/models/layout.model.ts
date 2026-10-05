import type { PricingSnapshot } from '../pricing/pricing.model';
import type { PublishIssue } from '../geometry/publish-check';
export interface Publication { status?: 'DRAFT' | 'PUBLISHED'; publishedAt?: string | null; publishOverrides?: { reason: string; issues: PublishIssue[] } | null; }
import type { Violation } from '../geometry/placement-rules';
import { EventType, Hall, HallShape } from './hall.model';
import { GateSide, StallInput, StallStatus } from './stall.model';

/** Row shape rendered in the "Saved Layouts" list (`App.js:593`). */
export interface LayoutSummary extends Publication {
  id: number | string;
  name: string;
  stallCount?: number;
  stalls?: unknown[];
}

/** Response of `GET /api/layout/{id}` as consumed by `openLayout` (`App.js:575`). */
export interface LayoutDetail {
  layout?: Publication & { pricingPolicy?: PricingSnapshot; id?: number | string; name?: string; eventType?: EventType; ruleIds?: number[] };
  name?: string;
  hall?: Hall;
  stalls?: StallInput[];
}

/** Response of `POST /api/layout/{id}/stalls/{stallNumber}/book`: the stall, now BOOKED. */
export interface StallBookedResponse {
  message?: string;
  layoutId?: number | string;
  stall: StallInput;
  /** The same booking as SelfCare table rows (backend-nest/docs/selfcare-booking-payload.md). */
  selfcare?: Record<string, unknown>;
}

/** Response of `POST /api/layout/save` as consumed by `saveLayout` (`App.js:572`). */
export interface LayoutSaveResponse {
  id?: number | string;
  layout?: Publication & { id?: number | string };
  /** The stalls as persisted, with their assigned stall numbers. */
  stalls?: StallInput[];
}

/** Hall part of the save/update payload built by `buildApiPayload()` (`App.js:548-568`). */
export interface HallPayload {
  id?: number;
  name: string;
  shape: HallShape;
  width: number;
  length: number;
  radius: number;
  blockedAreas?: unknown[];
  boundary?: unknown[];
  zones?: unknown[];
  planningZones?: unknown[];
  openings?: unknown[];
  markers?: unknown[];
  amenities?: unknown[];
  compass?: Record<string, unknown>;
  legends?: unknown[];
  rules?: Record<string, unknown>;
}

/** Stall part of the save/update payload built by `buildApiPayload()`. */
export interface StallPayload {
  id?: number;
  name: string;
  width: number;
  length: number;
  height: number;
  posX: number;
  posZ: number;
  color: string;
  gateSide: GateSide;
  openSides?: GateSide[];
  stallNumber?: string;
  status?: StallStatus;
  stallTypeId?: string;
  rotation?: number;
  parentStallNumber?: string;
  /** Custom (e.g. L-shaped) stall outline, local metres; omitted for rectangles. */
  footprint?: Array<{ x: number; z: number }>;
  openEdges?: number[];
}

/** Body sent to `POST /api/layout/save` and `PUT /api/layout/{id}`. */
export interface LayoutSaveRequest {
  layoutName: string;
  eventType?: EventType;
  /** Plotting rules chosen for this layout; omitted when none. */
  ruleIds?: number[];
  hall: HallPayload;
  stalls: StallPayload[];
}

/**
 * One rejected stall from a 400 on save/update (backend PlacementRejectedError). `stallIndex`
 * is the stall's position in the request's `stalls` array.
 */
export interface ServerViolation extends Violation {
  stallIndex: number;
  stallNumber: string | null;
}

/** Response of `POST /api/layout/{id}/validate`. */
export interface LayoutAuditResponse {
  layoutId: number;
  ruleDriven: boolean;
  valid: boolean;
  entries: Array<{ stallId: string; stallNumber: string | null; violations: Violation[] }>;
}
