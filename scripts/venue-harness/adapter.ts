import * as fs from 'node:fs';
import * as T from 'three';
import { loadVenueGlb, heapMB } from './load';
import { prepareBharatMandapam } from '../../src/app/home/venue-bharat-mandapam';
import type { Destination } from '../../src/app/home/venue.models';

// Bharat Mandapam adapter, run on the real model: tags, roles and the split of combined hall blocks.
// Usage: node scripts/venue-harness/run.mjs scripts/venue-harness/adapter.ts src/assets/venue/bharat-mandapam.meshopt.glb
const destinations = JSON.parse(fs.readFileSync('src/assets/venue/venue-navigation.json', 'utf8')) as Destination[];
const root = await loadVenueGlb(process.argv[2]);
const t0 = performance.now();
const result = prepareBharatMandapam(root, destinations);
const ms = Math.round(performance.now() - t0);
const count = (key: string) => { const m = new Map<string, number>(); root.traverse(o => { const v = o.userData[key]; if (v !== undefined && o instanceof T.Mesh) m.set(String(v), (m.get(String(v)) ?? 0) + 1); }); return Object.fromEntries([...m].sort()); };
const roofs: Record<string, string> = {};
root.traverse(o => { if (o.userData['venueRole'] === 'hallRoof') { const b = new T.Box3().setFromObject(o); roofs[o.name] = `x ${b.min.x.toFixed(0)}..${b.max.x.toFixed(0)} z ${b.min.z.toFixed(0)}..${b.max.z.toFixed(0)}`; } });
const hidden: string[] = []; root.traverse(o => { if (o.userData['supersededBySiteReference']) hidden.push(o.name); });
console.log(JSON.stringify({ ms, heapMB: heapMB(), split: result.split, uncategorised: result.uncategorised, lights: result.lights.length,
  hall: count('hall'), gate_id: count('gate_id'), destinationId: count('destinationId'), venueRole: count('venueRole'), venueCollider: count('venueCollider'),
  roofs, hiddenAsSiteDetailDuplicates: hidden.length, hiddenSample: hidden.slice(0, 5) }, null, 1));

// Site detail duplicates (new layout inside the campus, site detail outside).
const { hideSiteDetailDuplicates } = await import('../../src/app/home/venue-bharat-mandapam');
const site = await loadVenueGlb('src/assets/venue/venue-site-detail.glb');
root.add(site);
console.log(JSON.stringify({ campusVertices: result.campus.length, siteDetail: hideSiteDetailDuplicates(root, site, result.campus) }));
