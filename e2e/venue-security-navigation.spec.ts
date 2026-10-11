import { expect, test } from '@playwright/test';
import * as T from 'three';
import { planEntranceGuards } from '../src/app/home/venue-security-placement';
import { campusWalkable, createVisitorNavigation, portalCoordinates, slideVisitor, visitorBodyClear,
  visitorGroundHeight, visitorHallWalkable, VisitorNavigation } from '../src/app/home/visitor-navigation';
import { VISITOR_RADIUS } from '../src/app/home/visitor-collision';
import { findVisitorPath, planVisitorRoute, visitorSegmentClear } from '../src/app/home/visitor-routing';
import { measureInteriorHalls } from '../src/app/home/venue-interiors';
import { measureCCLevels } from '../src/app/home/cc-interiors';
import { referenceVenueGeometry } from './venue-reference-fixture';

test('standing guards stop fast manual movement and route a walker around their visible body', () => {
  const nav: VisitorNavigation = { portals: [], buildings: [], hazards: [], spawn: new T.Vector3(-5, .24, 0), heading: 0,
    bounds: new T.Box2(new T.Vector2(-12, -12), new T.Vector2(12, 12)), guards: [{
      id: 'guard', portalId: 'hall1', position: new T.Vector3(0, .24, 0), heading: 0, radius: .42, height: 1.85
    }] };
  const allowed = (p: T.Vector3) => campusWalkable(nav, p);
  expect(allowed(nav.guards![0].position)).toBe(false);
  for (const side of [-1, 1]) {
    const position = new T.Vector3(side * 4, .24, 0);
    slideVisitor(position, -side * 20, 0, allowed);
    expect(position.x * side).toBeGreaterThanOrEqual(VISITOR_RADIUS + .42);
    expect(allowed(position)).toBe(true);
  }
  const start = new T.Vector3(-5, .24, 0), goal = new T.Vector3(5, .24, 0);
  const route = findVisitorPath(start, goal, nav.bounds, allowed, 1)!;
  expect(route.length).toBeGreaterThan(2);
  for (let i = 1; i < route.length; i++) expect(visitorSegmentClear(route[i - 1], route[i], allowed)).toBe(true);
  const upstairs = { center: new T.Vector3(0, 5, 0), elevation: undefined } as any;
  expect(visitorBodyClear(nav, new T.Vector3(0, 5, 0), upstairs), 'An outdoor guard does not block the floor above').toBe(true);
});

test('two guards fit every actual entrance without closing manual or automatic hall access', () => {
  test.setTimeout(180_000);
  const root = referenceVenueGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const obstacles = new Map(), nav = createVisitorNavigation(root, halls, obstacles);
  const placements = planEntranceGuards(nav);
  expect(nav.guards, 'Planning alone must not create invisible collision bodies').toBeUndefined();
  expect(placements.length).toBe(nav.portals.length * 2);
  expect(new Set(placements.map(guard => guard.id)).size).toBe(placements.length);
  for (const portal of nav.portals) {
    const pair = placements.filter(guard => guard.portalId === portal.hall.id);
    expect(pair).toHaveLength(2);
    expect(portalCoordinates(portal, pair[0].position).across).toBeLessThan(0);
    expect(portalCoordinates(portal, pair[1].position).across).toBeGreaterThan(0);
    for (const guard of pair) {
      const coordinates = portalCoordinates(portal, guard.position);
      expect(coordinates.along).toBeGreaterThanOrEqual((portal.hall.level ? portal.approach - 3 : 3) - 1e-6);
      expect(Math.abs(coordinates.across) - guard.radius, 'Keep the complete doorway opening free').toBeGreaterThan(portal.width / 2);
      expect(guard.position.y).toBeCloseTo(visitorGroundHeight(nav, guard.position));
      expect(campusWalkable(nav, guard.position), `${guard.id} stands outside solid scene geometry`).toBe(true);
      for (let i = 0; i < 16; i++) {
        const point = guard.position.clone().add(new T.Vector3(Math.cos(i * Math.PI / 8) * guard.radius, 0, Math.sin(i * Math.PI / 8) * guard.radius));
        expect(campusWalkable(nav, point), `${guard.id} body clears nearby walls, props and water`).toBe(true);
      }
    }
  }
  nav.guards = placements;
  expect(campusWalkable(nav, nav.spawn), 'Arrival remains open').toBe(true);
  for (const guard of placements) expect(visitorBodyClear(nav, guard.position), `${guard.id} is solid`).toBe(false);
  const allowed = (point: T.Vector3) => campusWalkable(nav, point) || nav.portals.some(portal =>
    portalCoordinates(portal, point).along < -2.2 && visitorHallWalkable(nav, portal.hall, [], point));
  const verifyRoute = (route: T.Vector3[] | null, description: string) => {
    expect(route, description).not.toBeNull();
    for (let i = 1; i < route!.length; i++)
      expect(visitorSegmentClear(route![i - 1], route![i], allowed), `${description}: full body sweep ${i}`).toBe(true);
  };
  for (const [index, portal] of nav.portals.entries()) {
    const doorwayClear = (p: T.Vector3) => visitorBodyClear(nav, p,
      portalCoordinates(portal, p).along < -2.2 ? portal.hall : undefined);
    for (const [from, to] of [[portal.approach + 3, -5], [-5, portal.approach + 3]]) {
      const position = portal.position.clone().addScaledVector(portal.outward, from);
      const target = portal.position.clone().addScaledVector(portal.outward, to);
      expect(doorwayClear(position), `${portal.hall.id} sweep starts clear`).toBe(true);
      slideVisitor(position, target.x - position.x, target.z - position.z, doorwayClear);
      expect(Math.hypot(position.x - target.x, position.z - target.z), `${portal.hall.id} fast manual entry/exit`).toBeLessThan(.01);
    }
    verifyRoute(planVisitorRoute(nav, obstacles, undefined, nav.spawn, portal), `Campus to ${portal.hall.id}`);
    const next = nav.portals[(index + 1) % nav.portals.length];
    const inside = portal.position.clone().addScaledVector(portal.outward, -4.5);
    verifyRoute(planVisitorRoute(nav, obstacles, portal.hall, inside, next), `${portal.hall.id} exit to ${next.hall.id}`);
  }
});
