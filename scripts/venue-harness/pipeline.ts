import * as fs from 'node:fs';
import * as T from 'three';
import { loadVenueGlb, heapMB } from './load';
import { prepareBharatMandapam, hideSiteDetailDuplicates } from '../../src/app/home/venue-bharat-mandapam';
import { measureInteriorHalls } from '../../src/app/home/venue-interiors';
import { createVisitorNavigation, visitorGroundHeight, campusWalkable } from '../../src/app/home/visitor-navigation';
import { collectVenueLightSources } from '../../src/app/home/venue-light-sources';
import { batchVenue } from '../../src/app/home/venue-batching';
import { createVenueClassifier, venueBatchSemantics } from '../../src/app/home/venue-classify';
import type { Destination } from '../../src/app/home/venue.models';
import { capturePedestrianPaths, planPedestrianRoutes } from '../../src/app/home/venue-pedestrians';

// The viewer's model pipeline without WebGL: preparation, site-detail duplicates, interior hall fit, visitor
// navigation and collision, light sources and batching. Prints what each step found and the draw calls left.
// Usage: node --expose-gc scripts/venue-harness/run.mjs scripts/venue-harness/pipeline.ts <model.glb> [cad|legacy]
const [file, kind = 'cad'] = process.argv.slice(2);
const destinations = JSON.parse(fs.readFileSync('src/assets/venue/venue-navigation.json', 'utf8')) as Destination[];
const time = <R>(f: () => R): [R, number] => { const t = performance.now(); const r = f(); return [r, Math.round(performance.now() - t)]; };
const report: Record<string, unknown> = { file, kind };
const root = await loadVenueGlb(file);
report['loadHeapMB'] = heapMB();
const [cad, prepMs] = time(() => kind === 'cad' ? prepareBharatMandapam(root, destinations) : undefined);
report['prepareMs'] = prepMs;
const site = await loadVenueGlb('src/assets/venue/venue-site-detail.glb');
site.name = 'SITE_REFERENCE surroundings and property planting'; root.add(site);
if (cad) report['siteDetail'] = hideSiteDetailDuplicates(root, site, cad.campus);
const [halls, hallMs] = time(() => measureInteriorHalls(root));
report['interiorHalls'] = halls.map(h => ({ id: h.id, centre: [+h.center.x.toFixed(1), +h.center.z.toFixed(1)], width: +h.width.toFixed(1), depth: +h.depth.toFixed(1), height: +h.height.toFixed(1), roofs: h.roofs.length }));
report['interiorMs'] = hallMs;
const [nav, navMs] = time(() => createVisitorNavigation(root, halls, new Map()));
report['navigation'] = { ms: navMs, portals: nav.portals.map(p => p.hall.id), buildings: nav.buildings.length, hazards: nav.hazards.length,
  collisionFaces: nav.geometry?.faceCount, spawn: nav.spawn.toArray().map(v => +v.toFixed(1)), groundGrid: !!nav.groundAt, heapMB: heapMB() };
// Sample the visitor: ground height and walkability at the hall entrances and along a line through the plaza.
report['visitorSamples'] = nav.portals.map(p => {
  const out = p.position.clone().addScaledVector(p.outward, 6);
  return { hall: p.hall.id, ground: +visitorGroundHeight(nav, out).toFixed(2), walkableOutside: campusWalkable(nav, out) };
});
const [lights, lightMs] = time(() => collectVenueLightSources(root, cad?.lights ?? [], nav.portals, nav.groundAt));
report['lights'] = { ms: lightMs, count: lights.length, kinds: root.userData['nightLighting']?.kinds };
const [routes, crowdMs] = time(() => planPedestrianRoutes(nav, capturePedestrianPaths(root)));
report['pedestrians'] = { ms: crowdMs, routes: routes.length, zones: [...new Set(routes.map(r => r.zone))] };
const classify = createVenueClassifier(destinations);
const destinationsFound = new Map<string, number>();
root.traverse(o => { if (o instanceof T.Mesh) { const d = classify(o); if (d) destinationsFound.set(d, (destinationsFound.get(d) ?? 0) + 1); } });
report['destinationsWithMeshes'] = Object.fromEntries([...destinationsFound].sort());
report['destinationsMissing'] = destinations.map(d => d.id).filter(id => !destinationsFound.has(id));
let before = 0; root.traverse(o => { if (o instanceof T.Mesh && o.visible) before++; });
const [, batchMs] = time(() => batchVenue(root, classify, venueBatchSemantics));
let draws = 0, siteDraws = 0, vertices = 0, bytes = 0;
root.traverse(o => {
  if (!(o instanceof T.Mesh)) return;
  for (let n: T.Object3D | null = o; n; n = n.parent) if (!n.visible) return;
  if (o.userData['contextGround'] || /^(OUTER_GROUND|CONTEXT_GROUND)$/.test(o.name)) return;
  let inSite = false; for (let n: T.Object3D | null = o; n; n = n.parent) if (n === site) inSite = true;
  if (inSite) { siteDraws++; return; }
  draws++; vertices += o.geometry.getAttribute('position').count;
  for (const a of [...Object.values(o.geometry.attributes), o.geometry.index].filter(Boolean) as T.BufferAttribute[]) bytes += a.array.byteLength;
});
report['batching'] = { ms: batchMs, visibleMeshesBefore: before, modelDrawCallsAfter: draws, siteDetailDrawCalls: siteDraws, modelVertices: vertices, modelGeometryMB: Math.round(bytes / 1048576), heapMB: heapMB() };
console.log(JSON.stringify(report, null, 1));
