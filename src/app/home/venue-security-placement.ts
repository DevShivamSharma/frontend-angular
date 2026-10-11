import * as T from 'three';
import { campusWalkable, VisitorGuardPlacement, VisitorNavigation, visitorGroundHeight } from './visitor-navigation';
import { VISITOR_HEIGHT } from './visitor-collision';

export type { VisitorGuardPlacement } from './visitor-navigation';

/** Two staff members beside each working public entrance. The placement remains
 * independent of loading/rendering: callers register the returned bodies only
 * after their corresponding supplied-model instances are visible. */
export function planEntranceGuards(nav: VisitorNavigation,
  body: { radius?: number; height?: number } = {}): VisitorGuardPlacement[] {
  const radius = body.radius ?? .42, height = body.height ?? 1.85;
  if (!(radius > 0 && height > 0 && Number.isFinite(radius) && Number.isFinite(height)))
    throw new Error('Guard body dimensions must be finite and positive');
  const placements: VisitorGuardPlacement[] = [];
  // Never mutate the caller's collision map while assets are still loading.
  const working: VisitorNavigation = { ...nav, guards: [...(nav.guards ?? [])] };
  for (const portal of nav.portals) {
    const tangent = new T.Vector3(portal.outward.z, 0, -portal.outward.x);
    const across = portal.width / 2 + radius + .65;
    // CC's entrance is elevated. Stand beside the foot of its long ramp at
    // campus grade, rather than floating beside the top landing.
    const along = portal.hall.level ? portal.approach - 3 : 3.25;
    for (const [index, side] of [-1, 1].entries()) {
      let position: T.Vector3 | undefined;
      for (const forward of [0, 1.5, 3, 5, 7, 10]) {
        for (const lateral of [0, .8, 1.6, 2.4, 3.2, 4.8, 6.4, 8, 10, 12]) {
          const candidate = portal.position.clone().addScaledVector(portal.outward, along + forward)
            .addScaledVector(tangent, side * (across + lateral));
          candidate.y = visitorGroundHeight(nav, candidate);
          if (!campusWalkable(working, candidate)) continue;
          // The pedestrian collider conservatively validates the guard's body
          // and additional perimeter probes reject nearby water, walls and props.
          let clear = true;
          for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4, sample = candidate.clone();
            sample.x += Math.cos(angle) * radius; sample.z += Math.sin(angle) * radius;
            if (!campusWalkable(working, sample)) { clear = false; break; }
          }
          if (!clear) continue;
          if (height > VISITOR_HEIGHT && nav.geometry?.blocked(candidate.clone().add(new T.Vector3(0, height - VISITOR_HEIGHT, 0)))) continue;
          position = candidate;
          break;
        }
        if (position) break;
      }
      if (!position) throw new Error(`No clear security position beside ${portal.hall.label}`);
      const placement: VisitorGuardPlacement = { id: `${portal.hall.id}-guard-${index + 1}`,
        portalId: portal.hall.id, position, heading: Math.atan2(portal.outward.x, portal.outward.z) - side * .12,
        radius, height };
      placements.push(placement); working.guards!.push(placement);
    }
  }
  return placements;
}
