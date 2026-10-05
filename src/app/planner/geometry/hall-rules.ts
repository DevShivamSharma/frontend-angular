import { EventType, Hall } from '../models/hall.model';
import { Stall } from '../models/stall.model';
import { hallFloor, floorOutlines, planSize } from './hall-plan';
import { effectiveRules, footprintRect, PlacementContext, PlacementStall, Rect } from './placement-rules';

/**
 * Bridges planner state (Hall, Stall) to the pure placement rules.
 *
 * Every hall uses the same preview rules, including custom and offline halls.
 */
export function isRuleDriven(hall: Hall | null | undefined): hall is Hall {
  return !!hall;
}

export function toPlacementStall(stall: Stall): PlacementStall {
  return {
    id: String(stall.id),
    stallNumber: stall.stallNumber,
    status: stall.status,
    posX: stall.posX,
    posZ: stall.posZ,
    width: stall.width,
    length: stall.length,
    openSides: stall.openSides,
    gateSide: stall.gateSide,
    rotation: stall.rotation ?? 0,
    ...(stall.footprint?.length ? { footprint: stall.footprint, openEdges: stall.openEdges ?? [] } : {})
  };
}

export function placementContextFor(
  hall: Hall,
  stalls: ReadonlyArray<Stall>,
  eventType: EventType
): PlacementContext {
  const floor = hallFloor(hall);
  const outlines = floorOutlines(hall);
  const { width, length } = planSize(hall);
  const circle = !outlines.length && hall.shape === 'CIRCLE';
  const rectangle = rectanglePolygon({ minX: -width / 2, maxX: width / 2, minZ: -length / 2, maxZ: length / 2 });
  return {
    boundary: outlines[0] ?? (circle ? null : rectangle),
    regions: outlines.slice(1),
    ...(circle ? { circleRadius: hall.radius } : {}),
    obstacles: [
      ...floor.flatMap(r => r.holes),
      ...(hall.blockedAreas ?? []).filter(a => a.kind === 'wall' || a.kind === 'outside')
        .map(a => rectanglePolygon(footprintRect(a)))
    ],
    planningZones: hall.planningZones ?? [],
    zones: hall.zones ?? [],
    openings: hall.openings ?? [],
    rules: effectiveRules(hall.rules),
    eventType,
    stalls: stalls.map(toPlacementStall)
  };
}

function rectanglePolygon(r: Rect) {
  return [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ },
    { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
}
