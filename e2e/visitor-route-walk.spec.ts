import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import * as T from 'three';
import { measureInteriorHalls } from '../src/app/home/venue-interiors';
import { measureCCLevels } from '../src/app/home/cc-interiors';
import { createVisitorNavigation, campusWalkable, inFootprint } from '../src/app/home/visitor-navigation';
import { VISITOR_RADIUS } from '../src/app/home/visitor-collision';
import { visitorSegmentClear, walkableRoute } from '../src/app/home/visitor-routing';
import { parseMapGraph, parseVenueGates, resolveGateAccess, visitorGateOverrides } from '../src/app/home/venue-route-graph';
import { buildAdjacency } from '../src/app/home/venue-route-pathfinding';
import { planJourney } from '../src/app/home/venue-route-journey';
import { journeyPolyline } from '../src/app/home/venue-route-geometry';
import { NAVIGATION_LOCATIONS, availableLocations, selectionForNode } from '../src/app/home/venue-route-locations';
import { referenceVenueGeometry } from './venue-reference-fixture';

// The drawn Directions routes follow walkways traced from the air, which cut through the model's halls.
// The visitor must walk round them and arrive through the destination's doorway, on the real campus geometry.
test('walked Directions routes keep out of the halls and end at the destination doorway', () => {
  test.setTimeout(600_000);
  const root = referenceVenueGeometry(), halls = [...measureInteriorHalls(root), ...measureCCLevels(root)];
  const nav = createVisitorNavigation(root, halls, new Map());
  const graph = parseMapGraph(JSON.parse(fs.readFileSync('src/assets/venue/venue-walkways.json', 'utf8')));
  const gates = parseVenueGates(JSON.parse(fs.readFileSync('src/assets/venue/venue-gates.json', 'utf8')));
  const gateAccess = resolveGateAccess(visitorGateOverrides(gates), graph.nodes);
  const adjacency = buildAdjacency(graph.edges, gateAccess, graph.nodeMap);
  const insideAdjacency = buildAdjacency(graph.edges.filter(e => !graph.nodeMap[e.from].outside && !graph.nodeMap[e.to].outside), gateAccess, graph.nodeMap);
  const locations = availableLocations(graph.nodeMap, NAVIGATION_LOCATIONS);
  const portalFor = (id: string) => nav.portals.find(p => (p.hall.level ? 'cc' : p.hall.id) === id);
  const inBounds = (p: T.Vector3) => nav.bounds.containsPoint(new T.Vector2(p.x, p.z));
  const inHall = (p: T.Vector3, except?: string) => nav.buildings.find(b => b.id !== except && inFootprint(b.polygon, p.x, p.z, -VISITOR_RADIUS))?.id;
  const sources = ['hall2', 'hall5', 'hall14', 'gate6', 'gate10'], destinations = graph.nodes.filter(n => n.category === 'hall').map(n => n.id);
  let drawnThroughHalls = 0, routes = 0, slowest = 0;
  for (const from of sources) for (const to of destinations) {
    if (from === to) continue;
    const result = planJourney(selectionForNode(from, locations)!, selectionForNode(to, locations)!, { locations, adjacency, insideAdjacency, nodeMap: graph.nodeMap, gateAccess });
    if (!('journey' in result)) continue;
    const drawn = journeyPolyline(result.journey.path, adjacency, graph.nodeMap).map(p => new T.Vector3(p.x, 0, p.z));
    if (drawn.some(p => inBounds(p) && inHall(p))) drawnThroughHalls++;
    const door = portalFor(to), building = door && (door.hall.level ? 'cc' : door.hall.id);
    const started = performance.now();
    const route = walkableRoute(nav, new Map(), drawn, door);
    slowest = Math.max(slowest, performance.now() - started);
    expect(route, `${from} → ${to}`).not.toBeNull();
    routes++;
    for (const p of route!) if (inBounds(p)) expect(inHall(p, building), `${from} → ${to} walks through a hall at ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeUndefined();
    for (let i = 1; i < route!.length; i++) if (inBounds(route![i - 1]) && inBounds(route![i]))
      expect(visitorSegmentClear(route![i - 1], route![i], p => campusWalkable(nav, p)), `${from} → ${to} crosses a wall between points ${i - 1} and ${i}`).toBe(true);
    if (door) expect(route![route!.length - 1].distanceTo(door.position), `${from} → ${to} does not end at the doorway`).toBeLessThan(6);
  }
  console.log(`routes ${routes}, drawn through halls ${drawnThroughHalls}, slowest correction ${slowest.toFixed(0)} ms`);
  expect(routes).toBeGreaterThan(40);
  // Some drawn lines still cut through halls; that is why the walk is corrected. It runs on the click, so stay quick.
  expect(drawnThroughHalls).toBeGreaterThan(3);
  expect(slowest).toBeLessThan(2500);
});
