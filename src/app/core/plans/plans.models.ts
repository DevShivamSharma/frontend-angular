/** Mirrors the backend's stall plans (Module E). Floor metres, origin top-left, y down. */
import type { Point } from '../venues/floor-plan.models';
import type { EventHallDetailView } from '../events/events.models';

export type StallSide = 'top' | 'bottom' | 'left' | 'right';
export const STALL_SIDES: readonly StallSide[] = ['top', 'right', 'bottom', 'left'];
export type StallScheme = 'shell' | 'raw';

export interface PlanZone {
  id: string;
  name: string;
  color: string;
  /** Corners in order; the outline closes by itself. */
  polygon: Point[];
}

export interface PlanStall {
  id: string;
  zoneId: string | null;
  /** ITPO's island, e.g. "12A-27 "; the full number is island + stall number. */
  islandNumber: string | null;
  stallNumber: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  openSides: StallSide[];
  scheme: StallScheme;
  categoryIds: string[];
  isPremium: boolean;
  isBlocked: boolean;
  isFnb: boolean;
  isBranding: boolean;
  isHorseshoe: boolean;
  isMarqueeAvailable: boolean;
  isRestrictedForOverseas: boolean;
  isActive: boolean;
  location: string | null;
  description: string | null;
}

export interface PlanSeat {
  id: string;
  zoneId: string | null;
  rowLabel: string;
  seatNumber: number;
  x: number;
  y: number;
  width: number;
  depth: number;
  categoryId: string | null;
}

export type PlanObjectKind = 'line' | 'rect' | 'circle' | 'polyline' | 'text';

/**
 * A drawing on the plan that is not sold: a line, rectangle, circle, polyline or text. The rules
 * do not check it. Points by kind: line 2, rect 2 opposite corners, circle the centre and a point
 * on the edge, polyline 2 or more, text 1 (where it starts).
 */
export interface PlanObject {
  id: string;
  kind: PlanObjectKind;
  points: Point[];
  text: string | null;
  color: string;
}

export interface PlanContent {
  zones: PlanZone[];
  stalls: PlanStall[];
  seats: PlanSeat[];
  objects: PlanObject[];
}

export interface StallPlanView extends PlanContent {
  revision: number;
  updatedAt: string | null;
}

export interface PlannerView {
  hall: EventHallDetailView;
  plan: StallPlanView;
  canEdit: boolean;
  readOnlyReason: string | null;
}

/** A broken rule, and the zones, stalls or seats it is about (none: the whole plan). */
export interface PlanFinding {
  ruleId: string;
  message: string;
  ids: string[];
}

/** A stall's full number, as ITPO writes it: island and stall. */
export function stallLabel(s: Pick<PlanStall, 'islandNumber' | 'stallNumber'>): string {
  return `${s.islandNumber ?? ''}${s.stallNumber}`;
}
