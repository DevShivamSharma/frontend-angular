/* Build the route graph src/assets/venue/venue-walkways.json from the traced walkways and roads.
Run: node scripts/build-venue-walkways.cjs. Fails when a named place cannot be reached from Gate 1. No tests. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-site-detail.json'), 'utf8'));
const navigation = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-navigation.json'), 'utf8'));
const routeMap = JSON.parse(fs.readFileSync(path.join(root, '../docs/reference/campus-navigation-rn/route-map.json'), 'utf8'));
const { x: AX, z: AZ } = site.affine;
const world = p => [AX[0]*p[0] + AX[1]*p[1] + AX[2], AZ[0]*p[0] + AZ[1]*p[1] + AZ[2]];
// venue-navigation.json centres are authored s/t coordinates; this is the viewer's W().
const authored = (s, t) => [.5*s + .8660254038*t, -.8660254038*s + .5*t];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1]], cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const lerp = (a, b, t) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t], dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const project = (p, a, b) => {
  const d = sub(b, a), L = d[0]**2 + d[1]**2, t = L ? Math.max(0, Math.min(1, ((p[0]-a[0])*d[0] + (p[1]-a[1])*d[1]) / L)) : 0;
  const q = lerp(a, b, t); return { q, t, d: dist(p, q) };
};
const boundary = site.propertyBoundary.map(world);
const inside = p => {
  let hit = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i], b = boundary[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0]) * (p[1]-a[1]) / (b[1]-a[1]) + a[0]) hit = !hit;
  }
  return hit;
};

// 1. Lines: walkways (service roads and paths) inside the venue, road footpaths outside it.
const lines = [
  ...site.walkways.paths.map(w => ({ kind: w.type, points: w.points.map(world) })),
  ...site.mapMask.roads.map(r => ({ kind: 'road', points: r.points.map(world) })),
];
// Walkway ends within 6 m of another line join it, as in prepare-venue-roads.cjs.
for (const line of lines) {
  if (line.kind === 'road') continue;
  for (const end of [0, line.points.length - 1]) {
    let best = { d: 6 };
    for (const other of lines) if (other !== line)
      for (let k = 1; k < other.points.length; k++) { const p = project(line.points[end], other.points[k-1], other.points[k]); if (p.d < best.d) best = p; }
    if (best.q) line.points[end] = best.q;
  }
}
// 2. Split every crossing and keep the polyline between junctions on the edge.
const segments = lines.flatMap((line, li) => line.points.slice(1).map((b, k) => ({ li, a: line.points[k], b, cuts: [0, 1] })));
for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
  const s = segments[i], o = segments[j], u = sub(s.b, s.a), v = sub(o.b, o.a), d = cross(u, v);
  if (Math.abs(d) < 1e-9) continue;
  const q = sub(o.a, s.a), t = cross(q, v) / d, w = cross(q, u) / d;
  if (t >= -1e-7 && t <= 1 + 1e-7 && w >= -1e-7 && w <= 1 + 1e-7) { s.cuts.push(Math.max(0, Math.min(1, t))); o.cuts.push(Math.max(0, Math.min(1, w))); }
}
const points = [], pointIndex = new Map();
const pointAt = (p, road = false) => {
  const key = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;   // half-metre grid merge
  if (!pointIndex.has(key)) { pointIndex.set(key, points.length); points.push({ p, links: [], road }); }
  const pt = points[pointIndex.get(key)]; pt.road ||= road;
  return pointIndex.get(key);
};
// Road footpaths are outside the property even where a centreline grazes the traced boundary.
const inVenue = i => !points[i].road && inside(points[i].p);
const steps = [];
for (const s of segments) {
  s.cuts.sort((a, b) => a - b);
  for (let k = 1; k < s.cuts.length; k++) {
    const road = lines[s.li].kind === 'road';
    const a = pointAt(lerp(s.a, s.b, s.cuts[k-1]), road), b = pointAt(lerp(s.a, s.b, s.cuts[k]), road);
    if (a === b) continue;
    const id = steps.length; steps.push({ a, b, kind: lines[s.li].kind }); points[a].links.push(id); points[b].links.push(id);
  }
}

// No walking through the fence: a step between a venue point and an outside point is only possible through a gate.
steps.forEach(s => { if (inVenue(s.a) !== inVenue(s.b)) s.dropped = true; });
for (const pt of points) pt.links = pt.links.filter(l => !steps[l].dropped);

// 3. Named places. Gates and halls from venue-navigation.json; other places from the model or,
// where the model has nothing, from route-map.json relative to the nearest gate.
const rmNodes = Object.fromEntries(routeMap.nodes.map(n => [n.id, n]));
const navById = Object.fromEntries(navigation.map(d => [d.id, d]));
// Linear part of a least-squares fit of route-map.json gate positions (% of the ITPO map) to world metres.
const MAP_TO_WORLD = [[23.0467, 0.6721], [0.3736, 16.2886]];
const fromGate = (rmId, gateId) => {
  const n = rmNodes[rmId], g = rmNodes[gateId], c = authored(...navById[gateId].center);
  const dx = n.x - g.x, dy = n.y - g.y;
  return [c[0] + MAP_TO_WORLD[0][0]*dx + MAP_TO_WORLD[0][1]*dy, c[1] + MAP_TO_WORLD[1][0]*dx + MAP_TO_WORLD[1][1]*dy];
};
const navPlace = id => authored(...navById[id].center);
const PLACES = [
  ...navigation.filter(d => d.gate).map(d => ({ id: d.id, rm: d.id, label: d.label, category: 'gate', at: navPlace(d.id) })),
  ...navigation.filter(d => d.hall).map(d => ({ id: d.id, rm: d.id === 'hall12A' ? 'hall12a' : d.id, label: d.label, category: 'hall', at: navPlace(d.id) })),
  // Hangar and amphitheatre centres: IITF_2026_ARCHITECTURAL.glb roof/seating bounds.
  { id: 'hangar7a', rm: 'hangar7a', label: 'Hangar 7A', category: 'hall', at: [90.9, -223.0] },
  { id: 'hangar7b', rm: 'hangar7b', label: 'Hangar 7B', category: 'hall', at: [67.7, -147.5] },
  { id: 'cc', rm: 'conventionCentre', label: 'Convention Centre', category: 'amenity', at: [-345.2, 129.0] },
  { id: 'fountain', rm: 'musicalFountain', label: 'Musical Fountain & Amphitheatre', category: 'amenity', at: navPlace('fountain') },
  { id: 'amphitheatre1', rm: 'amphitheatre1', label: 'Amphitheatre 1', category: 'amenity', at: [181.8, -67.8] },
  { id: 'amphitheatre2', rm: 'amphitheatre2', label: 'Amphitheatre 2', category: 'amenity', at: [112.3, 52.6] },
  { id: 'itpoAdminBlock', rm: 'itpoAdminBlock', label: 'ITPO Admin Block', category: 'amenity', at: [-536.4, 197.6] },
  // Supreme Court station: the traced metro station centre (reference.json metro.center through the site affine).
  { id: 'metro', rm: 'metro', label: 'Supreme Court Metro Station', category: 'amenity', at: [-783.5, 175.2] },
  { id: 'busStop', rm: 'busStop', label: 'Bus Stop (Gate 9)', category: 'amenity', at: fromGate('busStop', 'gate9') },
  { id: 'basementParking1', rm: 'basementParking1', label: 'Basement Parking 1 (Bhairon Road)', category: 'amenity', at: fromGate('basementParking1', 'gate3') },
  { id: 'bhaironRoadParking', rm: 'bhaironRoadParking', label: 'Bhairon Road Parking', category: 'amenity', at: fromGate('bhaironRoadParking', 'gate1') },
  { id: 'mathuraRoadParking1', rm: 'mathuraRoadParking1', label: 'Basement Parking 1 (Mathura Road)', category: 'amenity', at: fromGate('mathuraRoadParking1', 'gate6') },
  { id: 'mathuraRoadParking2', rm: 'mathuraRoadParking2', label: 'Basement Parking 2 (Mathura Road)', category: 'amenity', at: fromGate('mathuraRoadParking2', 'gate6') },
];

// Attach a place where it meets the network: halls and amenities on the nearest pedestrian walkway
// (their frontage), outside places on the nearest road footpath, gates on both sides of the fence.
const splitStep = (stepId, q) => {
  const s = steps[stepId], n = pointAt(q);
  if (n === s.a || n === s.b) return n;
  const b = s.b; s.b = n; points[b].links = points[b].links.filter(l => l !== stepId);
  points[n].links.push(stepId);
  const id = steps.length; steps.push({ a: n, b, kind: s.kind }); points[n].links.push(id); points[b].links.push(id);
  return n;
};
const nearestStep = (p, test) => {
  let best = null;
  steps.forEach((s, id) => {
    if (s.dropped || !test(s)) return;
    const r = project(p, points[s.a].p, points[s.b].p);
    if (!best || r.d < best.d) best = { id, ...r };
  });
  return best;
};
const nodes = [], edges = [], placeNode = {}, attach = [];
for (const place of PLACES) {
  const rm = rmNodes[place.rm] ?? {};
  const outsidePlace = !!rm.outside;
  const node = { id: place.id, label: place.label, category: place.category, x: +place.at[0].toFixed(1), z: +place.at[1].toFixed(1) };
  if (place.category === 'gate') node.access = rm.access ?? 'both';
  if (outsidePlace) node.outside = true;
  nodes.push(node);
  const sides = place.category === 'gate' ? [true, false] : [!outsidePlace];
  for (const insideSide of sides) {
    // Outside, only road footpaths count: traced walkway stubs past the fence lead nowhere.
    const onSide = s => inVenue(s.a) === insideSide && (insideSide || s.kind === 'road');
    let best = nearestStep(place.at, onSide);
    // Buildings prefer a pedestrian walkway at their frontage when one is nearly as close.
    if ((place.category === 'hall' || place.category === 'amenity') && insideSide) {
      const walk = nearestStep(place.at, s => onSide(s) && s.kind === 'path');
      if (walk && walk.d <= best.d + 25) best = walk;
    }
    // A gate with no footpath within 90 m on its outer side is reached from inside only.
    if (!best || (place.category === 'gate' && !insideSide && best.d > 90)) continue;
    attach.push({ place: place.id, inside: insideSide, metres: +best.d.toFixed(1) });
    placeNode[place.id + (insideSide ? ':in' : ':out')] = splitStep(best.id, best.q);
  }
}

// 4. Collapse chains of plain points into edges that keep their polyline.
const keep = new Set(Object.values(placeNode));
points.forEach((pt, i) => { if (pt.links.length !== 2) keep.add(i); });
const junctionId = new Map();
for (const i of keep) {
  const id = `j${junctionId.size + 1}`; junctionId.set(i, id);
  nodes.push({ id, label: id, category: 'junction', x: +points[i].p[0].toFixed(1), z: +points[i].p[1].toFixed(1), ...(inVenue(i) ? {} : { outside: true }) });
}
const usedStep = new Set();
for (const start of keep) for (const first of points[start].links) {
  if (usedStep.has(first)) continue;
  const line = [points[start].p]; let at = start, step = first, kind = steps[first].kind;
  for (;;) {
    usedStep.add(step); const s = steps[step]; at = s.a === at ? s.b : s.a; line.push(points[at].p);
    if (keep.has(at)) break;
    step = points[at].links.find(l => !usedStep.has(l)); if (step === undefined) break;
  }
  const from = junctionId.get(start), to = junctionId.get(at);
  if (!to || from === to) continue;
  edges.push({ id: `${from}-${to}`, from, to, active: true, direction: 'two-way', kind, points: line.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) });
}
// Places link to the junction they were attached at; a gate also links its two sides through itself.
for (const [key, point] of Object.entries(placeNode)) {
  const [id] = key.split(':'), place = nodes.find(n => n.id === id), j = junctionId.get(point), jn = nodes.find(n => n.id === j);
  edges.push({ id: `${id}-${j}`, from: id, to: j, active: true, direction: 'two-way', kind: 'link', points: [[place.x, place.z], [jn.x, jn.z]] });
}

// 5. Check: every named place reachable from Gate 1 when every gate is open both ways.
const adjacency = {};
for (const e of edges) { (adjacency[e.from] ??= []).push(e.to); (adjacency[e.to] ??= []).push(e.from); }
const seen = new Set(['gate1']), queue = ['gate1'];
while (queue.length) for (const n of adjacency[queue.pop()] ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
const unreachable = PLACES.filter(p => !seen.has(p.id)).map(p => p.id);
const result = {
  source: 'Built by scripts/build-venue-walkways.cjs from venue-site-detail.json walkways.paths (inside the property) and mapMask.roads (footpaths outside it). Steps across the property line are only possible through a gate.',
  coordinateFrame: 'Venue world X/Z metres (the three.js scene x/z)',
  placeSources: 'Gates and halls: venue-navigation.json. Hangars, amphitheatres, CC, ITPO Admin Block: architectural model. Metro: traced station. Bus stop and parkings: route-map.json position relative to the nearest gate (the ITPO map is not to scale, so these are approximate). Gate access and outside flags: route-map.json.',
  attachments: attach,
  nodes, edges,
};
fs.writeFileSync(path.join(root, 'src/assets/venue/venue-walkways.json'), JSON.stringify(result));
const far = attach.filter(a => a.metres > 40).map(a => `${a.place}${a.inside ? '' : ' (outside)'} ${a.metres} m`);
console.log(JSON.stringify({ nodes: nodes.length, junctions: junctionId.size, edges: edges.length, longAttachments: far }));
if (unreachable.length) { console.error('Unreachable from Gate 1: ' + unreachable.join(', ')); process.exit(1); }
