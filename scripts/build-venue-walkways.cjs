/* Build the route graph src/assets/venue/venue-walkways.json from the traced walkways and roads.
Run: node scripts/build-venue-walkways.cjs. Fails when a named place cannot be reached from Gate 1. No tests. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-site-detail.json'), 'utf8'));
const navigation = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-navigation.json'), 'utf8'));
const routeMap = JSON.parse(fs.readFileSync(path.join(root, '../docs/reference/campus-navigation-rn/route-map.json'), 'utf8'));
const gateStatus = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-gates.json'), 'utf8')).gates;
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
  // `door`: where the place meets the walkways when that is not the walkway nearest its centre. The CC's nearest is
  // its north-west side; the ITPO app uses the south forecourt, and routes to the halls otherwise walk round the building.
  { id: 'cc', rm: 'conventionCentre', label: 'Convention Centre', category: 'amenity', at: [-345.2, 129.0], door: fromGate('conventionCentre', 'gate8') },
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
    const door = place.door ?? place.at;
    let best = nearestStep(door, onSide);
    // Buildings prefer a pedestrian walkway at their frontage when one is nearly as close.
    if ((place.category === 'hall' || place.category === 'amenity') && insideSide) {
      const walk = nearestStep(door, s => onSide(s) && s.kind === 'path');
      if (walk && walk.d <= best.d + 25) best = walk;
    }
    // A gate with no footpath within 90 m on its outer side is reached from inside only.
    if (!best || (place.category === 'gate' && !insideSide && best.d > 90)) continue;
    attach.push({ place: place.id, inside: insideSide, metres: +best.d.toFixed(1) });
    placeNode[place.id + (insideSide ? ':in' : ':out')] = splitStep(best.id, best.q);
  }
}

// Close gaps: the traces often stop, or pass, a few metres short of a neighbouring line, and routes then went
// round a whole block (Amphitheatre 1 to Hall 6 was 1.7 km). A junction inside the venue gets a short path to the
// nearest venue line within JOIN_GAP, unless walking there is already short or the path would cross a traced line.
// Outside, the lines are road centrelines and a gap between two of them is a carriageway, so nothing is joined there.
const JOIN_GAP = 25, SHORT_WALK = 3 * JOIN_GAP;
// Walking metres from `from` to the points within `limit` that `allow` lets in, stopping at the first point `stop`
// accepts (Dijkstra; the radius or corridor holds a few hundred points). `prev` gives the walk back to `from`.
const walkFrom = (from, limit, allow = () => true, stop = () => false) => {
  const done = new Map(), prev = new Map(), open = new Map([[from, 0]]);
  while (open.size) {
    let at, d = Infinity;
    for (const [k, v] of open) if (v < d) { at = k; d = v; }
    open.delete(at); done.set(at, d);
    if (stop(at)) return { done, prev, at };
    for (const l of points[at].links) {
      const s = steps[l], next = s.a === at ? s.b : s.a, nd = d + dist(points[at].p, points[next].p);
      if (nd <= limit && !done.has(next) && allow(next) && nd < (open.get(next) ?? Infinity)) { open.set(next, nd); prev.set(next, at); }
    }
  }
  return { done, prev };
};
const lineTo = (prev, from, to) => { const line = [to]; while (line[0] !== from) line.unshift(prev.get(line[0])); return line.map(i => points[i].p); };
// True when p-q crosses step s away from both ends.
const crossesStep = (p, q, s) => {
  const a = points[s.a].p, u = sub(q, p), v = sub(points[s.b].p, a), d = cross(u, v);
  if (Math.abs(d) < 1e-9) return false;
  const w = sub(a, p), t = cross(w, v) / d, r = cross(w, u) / d;
  return t > 1e-6 && t < 1 - 1e-6 && r > 1e-6 && r < 1 - 1e-6;
};
const joins = [];
const joinFrom = [...new Set(Object.values(placeNode))];
points.forEach((pt, i) => { if (pt.links.length && pt.links.length !== 2) joinFrom.push(i); });
for (const i of new Set(joinFrom)) {
  if (!inVenue(i)) continue;
  const p = points[i].p, near = walkFrom(i, SHORT_WALK).done;
  const candidates = [];
  steps.forEach((s, id) => {
    if (s.dropped || s.join || s.a === i || s.b === i || !inVenue(s.a) || !inVenue(s.b)) return;
    const r = project(p, points[s.a].p, points[s.b].p);
    if (r.d >= .5 && r.d < JOIN_GAP) candidates.push({ id, ...r });
  });
  candidates.sort((x, y) => x.d - y.d);
  const best = candidates.find(c => {
    const s = steps[c.id], walk = Math.min((near.get(s.a) ?? Infinity) + dist(points[s.a].p, c.q), (near.get(s.b) ?? Infinity) + dist(points[s.b].p, c.q));
    return walk > SHORT_WALK && !steps.some(o => !o.dropped && crossesStep(p, c.q, o));
  });
  if (!best) continue;
  const n = splitStep(best.id, best.q);
  if (n === i) continue;
  const id = steps.length; steps.push({ a: i, b: n, kind: 'path', join: true }); points[i].links.push(id); points[n].links.push(id);
  joins.push({ from: p.map(v => +v.toFixed(1)), to: best.q.map(v => +v.toFixed(1)), metres: +best.d.toFixed(1) });
}

// 3b. Inside the fence a route may only take the ITPO app's connections (route-map.json, its ids mapped to ours),
// plus hall doors and gates. An app junction sits where its spot on the app's map lands on the walkways; app edges
// that touch an outside node are left out, since outside a route keeps to the traced road footpaths.
const RM_TO_OURS = { conventionCentre: 'cc', hall12a: 'hall12A', musicalFountain: 'fountain' };
const ourPlace = Object.fromEntries(PLACES.map(p => [p.rm, p]));
// Affine fit of the app's map % to world metres over the inside places both graphs have (least squares).
const anchors = routeMap.nodes.filter(n => n.category !== 'junction' && !n.outside && ourPlace[n.id]);
const fitAxis = k => {
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const n of anchors) {
    const r = [n.x, n.y, 1], v = ourPlace[n.id].at[k];
    for (let i = 0; i < 3; i++) { M[i][3] += r[i]*v; for (let j = 0; j < 3; j++) M[i][j] += r[i]*r[j]; }
  }
  for (let i = 0; i < 3; i++) {
    const p = M[i][i]; for (let j = i; j < 4; j++) M[i][j] /= p;
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i]; for (let j = i; j < 4; j++) M[r][j] -= f*M[i][j]; }
  }
  return M.map(row => row[3]);
};
const FX = fitAxis(0), FZ = fitAxis(1), fromMap = n => [FX[0]*n.x + FX[1]*n.y + FX[2], FZ[0]*n.x + FZ[1]*n.y + FZ[2]];
const appPoint = {};
for (const n of routeMap.nodes) {
  if (n.outside) continue;
  if (n.category !== 'junction') { const at = placeNode[ourPlace[n.id]?.id + ':in']; if (at !== undefined) appPoint[n.id] = at; continue; }
  const best = nearestStep(fromMap(n), s => inVenue(s.a) && inVenue(s.b));
  if (best) appPoint[n.id] = splitStep(best.id, best.q);
}
// Each app edge is drawn as the shortest walk between its ends that keeps within CORRIDOR metres of the app's straight
// edge, then within twice that; when none fits it is a straight link, logged.
const CORRIDOR = 40;
const insideLines = [], straight = [];
for (const e of routeMap.edges) {
  const a = appPoint[e.from], b = appPoint[e.to];
  if (a === undefined || b === undefined || a === b) continue;
  let walk;
  for (const width of [CORRIDOR, 2 * CORRIDOR]) {
    walk = walkFrom(a, Infinity, i => inVenue(i) && project(points[i].p, points[a].p, points[b].p).d <= width, i => i === b);
    if (walk.at !== undefined) break;
  }
  if (walk.at === undefined) straight.push(`${e.from}-${e.to} ${dist(points[a].p, points[b].p).toFixed(0)} m`);
  insideLines.push({ a, b, line: walk.at === undefined ? [points[a].p, points[b].p] : lineTo(walk.prev, a, b) });
}
// A gate the app gives no edge at all (7, 8) keeps its nearest traced walk onto the app's network. One whose only app
// edge is outside (5C) is reached from outside, as in the app. Closed gates (venue-gates.json, Gate 11) stay unjoined,
// so the graph needs rebuilding if one reopens.
const onApp = new Set(insideLines.flatMap(l => [l.a, l.b]));
const appLinked = new Set(routeMap.edges.flatMap(e => [e.from, e.to]));
const closedGate = new Set(gateStatus.filter(g => !g.entry && !g.exit).map(g => g.id));
const tracedLinks = [];
for (const place of PLACES) {
  const at = placeNode[place.id + ':in'];
  if (place.category !== 'gate' || at === undefined || appLinked.has(place.rm) || closedGate.has(place.id)) continue;
  const walk = walkFrom(at, Infinity, inVenue, i => onApp.has(i));
  if (walk.at === undefined) continue;
  insideLines.push({ a: at, b: walk.at, line: lineTo(walk.prev, at, walk.at) });
  tracedLinks.push({ gate: place.id, metres: +walk.done.get(walk.at).toFixed(1) });
}

// 4. Collapse chains of plain points outside into edges that keep their polyline; inside, the app's edges above.
const keep = new Set([...Object.values(placeNode), ...Object.values(appPoint)]);
points.forEach((pt, i) => { if (pt.links.length !== 2 && !inVenue(i)) keep.add(i); });
const junctionId = new Map();
for (const i of keep) {
  const id = `j${junctionId.size + 1}`; junctionId.set(i, id);
  nodes.push({ id, label: id, category: 'junction', x: +points[i].p[0].toFixed(1), z: +points[i].p[1].toFixed(1), ...(inVenue(i) ? {} : { outside: true }) });
}
const usedStep = new Set();
for (const start of keep) for (const first of points[start].links) {
  if (usedStep.has(first) || inVenue(steps[first].a)) continue;
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
const insideEdge = new Set();
for (const { a, b, line } of insideLines) {
  const from = junctionId.get(a), to = junctionId.get(b);
  if (insideEdge.has(`${from}-${to}`) || insideEdge.has(`${to}-${from}`)) continue;
  insideEdge.add(`${from}-${to}`);
  edges.push({ id: `${from}-${to}`, from, to, active: true, direction: 'two-way', kind: 'path', points: line.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) });
}
// Places link to the junction they were attached at; a gate also links its two sides through itself.
for (const [key, point] of Object.entries(placeNode)) {
  const [id] = key.split(':'), place = nodes.find(n => n.id === id), j = junctionId.get(point), jn = nodes.find(n => n.id === j);
  // A closed gate has no way in or out; its attachment point may be another place's (Gate 11 shares Hangar 7A's).
  if (closedGate.has(id)) continue;
  edges.push({ id: `${id}-${j}`, from: id, to: j, active: true, direction: 'two-way', kind: 'link', points: [[place.x, place.z], [jn.x, jn.z]] });
}

// 5. Check: every named place but a closed gate reachable from Gate 1 when every gate is open both ways.
const adjacency = {};
for (const e of edges) { (adjacency[e.from] ??= []).push(e.to); (adjacency[e.to] ??= []).push(e.from); }
const seen = new Set(['gate1']), queue = ['gate1'];
while (queue.length) for (const n of adjacency[queue.pop()] ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
const unreachable = PLACES.filter(p => !seen.has(p.id) && !closedGate.has(p.id)).map(p => p.id);
// Satellite image pixels of a z18 tile point: the image is tiles x 187310-187325, y 109300-109315 at 256 px
// (geography/satellite/venue-map.json), and satelliteReference.fit takes those pixels to world X/Z.
const { x: fitX, z: fitZ } = site.satelliteReference.fit;
const result = {
  source: 'Built by scripts/build-venue-walkways.cjs from venue-site-detail.json walkways.paths (inside the property) and mapMask.roads (footpaths outside it). Steps across the property line are only possible through a gate. Inside, edges are the ITPO app\'s route-map.json connections drawn along the walkways.',
  coordinateFrame: 'Venue world X/Z metres (the three.js scene x/z)',
  placeSources: 'Gates and halls: venue-navigation.json. Hangars, amphitheatres, CC, ITPO Admin Block: architectural model. The CC is attached at its route-map.json forecourt. Metro: traced station. Bus stop and parkings: route-map.json position relative to the nearest gate (the ITPO map is not to scale, so these are approximate). Gate access and outside flags: route-map.json.',
  attachments: attach,
  joins,
  appEdges: { corridorMetres: CORRIDOR, straight, tracedLinks },
  // The property line (venue-site-detail.json propertyBoundary in world X/Z), for telling inside from outside.
  fence: boundary.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]),
  satellite: { zoom: 18, tileOrigin: [187310, 109300], tileSize: 256, fit: { x: fitX, z: fitZ } },
  nodes, edges,
};
fs.writeFileSync(path.join(root, 'src/assets/venue/venue-walkways.json'), JSON.stringify(result));
const far = attach.filter(a => a.metres > 40).map(a => `${a.place}${a.inside ? '' : ' (outside)'} ${a.metres} m`);
console.log(JSON.stringify({ nodes: nodes.length, junctions: junctionId.size, edges: edges.length, joins: joins.length, longAttachments: far, appStraight: straight, tracedLinks }));
if (unreachable.length) { console.error('Unreachable from Gate 1: ' + unreachable.join(', ')); process.exit(1); }
