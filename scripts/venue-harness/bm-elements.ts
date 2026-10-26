import * as fs from 'node:fs';
import * as T from 'three';
// @ts-ignore plain ES module
import { loadGlb, renderPlan, writePng } from '../render-venue-plan.mjs';
import { applyBmElements, BmElementManifest, VENUE_BM_ELEMENTS } from '../../src/app/home/venue-bm-elements';
import { measureInteriorHalls } from '../../src/app/home/venue-interiors';
import { createVisitorNavigation, campusWalkable } from '../../src/app/home/visitor-navigation';
import { batchVenue } from '../../src/app/home/venue-batching';
import { createVenueClassifier, venueBatchSemantics } from '../../src/app/home/venue-classify';
import type { Destination } from '../../src/app/home/venue.models';

// The earlier model with and without the Bharat Mandapam elements, in Node: what is added and cut, interior halls,
// visitor collision, and draw calls after batching. With a PNG path it also writes a plan of the element area.
// Usage: node scripts/venue-harness/run.mjs scripts/venue-harness/bm-elements.ts [plan.png] [all]
//   all: every element on, including those VENUE_BM_ELEMENTS has off.
const [png, mode] = process.argv.slice(2);
const destinations = JSON.parse(fs.readFileSync('src/assets/venue/venue-navigation.json', 'utf8')) as Destination[];
const manifest = JSON.parse(fs.readFileSync('src/assets/venue/venue-bm-elements.json', 'utf8')) as BmElementManifest;
const flags = mode === 'all' ? Object.fromEntries(manifest.elements.map(e => [e.id, true])) : VENUE_BM_ELEMENTS;
async function run(withElements: boolean) {
  const root = await loadGlb('src/assets/venue/IITF_2026_ARCHITECTURAL.glb') as T.Group;
  const applied = withElements ? applyBmElements(root, await loadGlb('src/assets/venue/venue-bm-elements.glb'), manifest, flags) : undefined;
  if (withElements && png) writePng(png, renderPlan(root, { x0: -260, z0: -140, x1: 240, z1: 260, step: .4 }));
  const halls = measureInteriorHalls(root);
  const nav = createVisitorNavigation(root, halls, new Map());
  // Walkability along the covered walk's axis (old spine centre line), every 5 m.
  const a = new T.Vector3(-160, .24, 20), b = new T.Vector3(100, .24, 185);
  let walkable = 0, samples = 0;
  for (let k = 0; k <= 1; k += 5 / a.distanceTo(b), samples++) if (campusWalkable(nav, a.clone().lerp(b, k))) walkable++;
  let before = 0; root.traverse(o => { if (o instanceof T.Mesh && o.visible) before++; });
  const classify = createVenueClassifier(destinations);
  batchVenue(root, classify, venueBatchSemantics);
  let draws = 0, vertices = 0;
  root.traverse(o => { if (o instanceof T.Mesh) { for (let n: T.Object3D | null = o; n; n = n.parent) if (!n.visible) return; draws++; vertices += o.geometry.getAttribute('position').count; } });
  return { applied, interiorHalls: halls.map(h => h.id), portals: nav.portals.length, collisionFaces: nav.geometry?.faceCount,
    walkableAlongCoveredWalk: `${walkable}/${samples}`, meshesBefore: before, drawCallsAfterBatching: draws, vertices };
}
console.log(JSON.stringify({ flags, before: await run(false), after: await run(true) }, null, 1));
