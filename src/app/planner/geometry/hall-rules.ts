import { EventType, Hall } from '../models/hall.model';
import { Stall } from '../models/stall.model';
import { effectiveRules, PlacementContext, PlacementStall } from './placement-rules';

/**
 * Bridges planner state (Hall, Stall) to the pure placement rules.
 *
 * A hall is rule-driven when it carries `rules`. Every other hall keeps the legacy
 * withinHall / overlaps / overlapsBlockedArea checks exactly as before.
 */
export function isRuleDriven(hall: Hall | null | undefined): hall is Hall {
  return !!hall && hall.rules != null;
}

export function toPlacementStall(stall: Stall): PlacementStall {
  return {
    id: String(stall.id),
    stallNumber: stall.stallNumber,
    status: stall.status,
    posX: stall.posX,
    posZ: stall.posZ,
    width: stall.width,
    length: stall.length
  };
}

export function placementContextFor(
  hall: Hall,
  stalls: ReadonlyArray<Stall>,
  eventType: EventType
): PlacementContext {
  return {
    boundary: hall.boundary ?? null,
    zones: hall.zones ?? [],
    openings: hall.openings ?? [],
    rules: effectiveRules(hall.rules),
    eventType,
    stalls: stalls.map(toPlacementStall)
  };
}
