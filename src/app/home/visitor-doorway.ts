import * as T from 'three';
import type { VisitorPortal } from './visitor-navigation';

export const VISITOR_ENTRANCE_LINING = /Inner perimeter plinth|Interior facade lining/;
export const VISITOR_RAMP_LANDING = 1;

/** One opening shared by rendering and physics, including the approach through
 * the model's raised entrance aprons and the CC podium around its access ramp. */
export function visitorOpening(portal: VisitorPortal) {
  const n = portal.outward, t = new T.Vector3(n.z, 0, -n.x), p = portal.position;
  const bottom = Math.min(.24, p.y) + .03, top = p.y + 3.7;
  const outside = Math.max(19, portal.approach + 1);
  const planes = [
    new T.Plane(t.clone(), -t.dot(p) - portal.width / 2),
    new T.Plane(t.clone().negate(), t.dot(p) - portal.width / 2),
    new T.Plane(n.clone(), -n.dot(p) - outside),
    new T.Plane(n.clone().negate(), n.dot(p) - 9),
    new T.Plane(new T.Vector3(0, 1, 0), -top),
    new T.Plane(new T.Vector3(0, -1, 0), bottom),
  ];
  const corners: T.Vector3[] = [];
  for (const across of [-portal.width / 2, portal.width / 2]) for (const along of [-9, outside])
    for (const y of [bottom, top]) corners.push(new T.Vector3(p.x, y, p.z).addScaledVector(t, across).addScaledVector(n, along));
  return { planes, bounds: new T.Box3().setFromPoints(corners) };
}
