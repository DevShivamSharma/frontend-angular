import type {
  PublicStallView,
  PublicStallState,
} from '../../../core/public-events/public-events.models';
import type { PlanContent } from '../../../core/plans/plans.models';
import { STALL_STATE_COLORS } from '../../../core/bookings/booking-rules';
import { toPlanStall } from '../portal/portal-plan';

/** What a stall is called on the public map; held and booked look alike. */
export const PUBLIC_STATE_LABELS: Record<PublicStallState, string> = {
  free: 'Free',
  unavailable: 'Booked or held',
  not_for_sale: 'Not for sale',
};

/** The portal's colours, so a stall means the same on both maps. */
export const PUBLIC_STATE_COLORS: Record<PublicStallState, string> = {
  free: STALL_STATE_COLORS.free,
  unavailable: STALL_STATE_COLORS.booked,
  not_for_sale: STALL_STATE_COLORS.not_for_sale,
};

/** The public stalls as a plan the planner canvas can draw read-only. */
export function publicPlan(stalls: PublicStallView[]): PlanContent {
  return { zones: [], seats: [], objects: [], stalls: stalls.map((s) => toPlanStall(s, s.state)) };
}

export function publicColors(): ReadonlyMap<string, string> {
  return new Map<string, string>(Object.entries(PUBLIC_STATE_COLORS));
}
