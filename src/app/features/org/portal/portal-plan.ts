import { MINE_COLOR, STALL_STATE_COLORS } from '../../../core/bookings/booking-rules';
import type {
  MapStallView,
  PublishedStallView,
  StallMapView,
} from '../../../core/bookings/bookings.models';
import type { PlanContent, PlanStall } from '../../../core/plans/plans.models';

/** The key `portalColors` colours a stall by: `mine` for the exhibitor's own, else its state. */
export const MINE = 'mine';

function colourKey(s: MapStallView): string {
  return s.booking ? MINE : s.state;
}

/** A published stall as the planner draws it, coloured by key (see portalColors). */
export function toPlanStall(s: PublishedStallView, key: string): PlanStall {
  return {
    id: s.id,
    zoneId: null,
    islandNumber: s.islandNumber,
    stallNumber: s.stallNumber,
    x: s.x,
    y: s.y,
    width: s.width,
    depth: s.depth,
    openSides: s.openSides,
    cutCells: s.cutCells,
    labelArea: null,
    scheme: s.scheme,
    // The canvas colours a stall by the first category's colour, so availability rides on it.
    categoryIds: [key],
    isPremium: s.isPremium,
    isBlocked: s.isBlocked,
    isFnb: false,
    isBranding: false,
    isHorseshoe: false,
    isMarqueeAvailable: false,
    isRestrictedForOverseas: false,
    isActive: s.isActive,
    location: null,
    description: null,
  };
}

/**
 * The published stalls as a plan the planner canvas can draw read-only. The server already
 * names an exhibitor's own booking (`booking` is set only for it), everyone else's is just
 * held or booked.
 */
export function portalPlan(map: StallMapView): PlanContent {
  return {
    zones: [],
    seats: [],
    objects: [],
    stalls: map.stalls.map((s) => toPlanStall(s, colourKey(s))),
  };
}

export function portalColors(): ReadonlyMap<string, string> {
  return new Map<string, string>([...Object.entries(STALL_STATE_COLORS), [MINE, MINE_COLOR]]);
}
