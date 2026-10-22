/* Offline only: the OSM context of the Color → Map scenery, in the venue's own X/Z metres.
 * delhi-context.json stays in the geographic frame (east +X, south +Z) that Natural and the globe use.
 * The venue model is turned about 91° from that frame, so this copy goes through the z18 satellite fit
 * (satellite-reference.json) instead, and gains road classes from the OSM highway tags.
 * node --preserve-symlinks scripts/build-venue-map-context.cjs tmp/delhi-nearby-osm.json   (read-osm-map.py output)
 */
const fs = require('node:fs');
const path = require('node:path');
const clip = require('polygon-clipping');
const { kind, roadWidth, nearSquare } = require('./restore-nearby-map.cjs');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const context = read('src/assets/venue/geography/delhi-context.json');
const satellite = read('work/venue-surroundings/satellite-reference.json'), fit = satellite.fit;
const site = read('src/assets/venue/venue-site-detail.json');
const output = path.join(root, 'src/assets/venue/geography/venue-map-context.json');
const round = n => Math.round(n * 10) / 10;

// Geographic metres -> lat/lon (inverse of restore-nearby-map's projection) -> z18 pixel -> venue metres.
// 187310/109300 are the z18 tiles at the image's top-left corner (docs/aerial-reference/README.md).
const R = 6371000, deg = Math.PI / 180, { lat: lat0, lon: lon0 } = context.origin, tiles = 2 ** 18 * 256;
const pixel = (lat, lon) => [(lon + 180) / 360 * tiles - 187310 * 256,
  (1 - Math.log(Math.tan(lat * deg) + 1 / Math.cos(lat * deg)) / Math.PI) / 2 * tiles - 109300 * 256];
const venue = ([u, v]) => [round(fit.x[0] * u + fit.x[1] * v + fit.x[2]), round(fit.z[0] * u + fit.z[1] * v + fit.z[2])];
const geo = ({ lat, lon }) => [(lon - lon0) * deg * R * Math.cos(lat0 * deg), (lat0 - lat) * deg * R];
const fromGeo = ([x, z]) => venue(pixel(lat0 - z / R / deg, lon0 + x / (R * Math.cos(lat0 * deg)) / deg));
// Venue metres are slightly larger than ground metres (the fit's scale), so widths follow.
const widthScale = fit.worldMetresPerPixel / satellite.groundMetresPerPixel;

const { x: AX, z: AZ } = site.affine;
const property = [site.propertyBoundary.map(p => [AX[0] * p[0] + AX[1] * p[1] + AX[2], AZ[0] * p[0] + AZ[1] * p[1] + AZ[2]])];
property[0].push(property[0][0]);
const inside = (p, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  return hit;
};
const square = [nearSquare[0].map(fromGeo)];

// Building heights `h` (metres) for the 3D buildings of Color → Map. OSM `height`, else `building:levels` at 3.5 m a
// storey; then the landmarks below; else by OSM type and footprint (the neighbourhood is mostly 2-4 storeys). Only the
// Supreme Court dome (27.6 m, sci.gov.in) and Purana Qila's walls and gates (about 18 m) are published figures; the
// other landmark heights are estimates from their storey counts and should be replaced when surveyed.
const LANDMARKS = [
  [/^Supreme Court of India$/, 27.6], [/Darwaza|Sher Shah Suri Gate/, 18], [/Qila-i-Khuna Mosque/, 20], [/Sher Mandal/, 15],
  [/Indira Gandhi Arena/, 30], [/Delhi Secretariat/, 36], [/Indraprastha Bhawan|Doordarshan Bhawan/, 36],
  [/Indian Coast Guard headquarters/, 18], [/Patiala House Court/, 14], [/Supreme Court Metro Station/, 16], [/Matka Peer/, 8],
];
const TYPE_HEIGHT = { house: 8, detached: 8, residential: 11, roof: 5, shed: 5, parking: 9, industrial: 9, ruins: 6, stadium: 20, mosque: 14,
  transportation: 9, bridge: 6 };
const footprint = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const byFootprint = ring => { const a = footprint(ring); return a < 120 ? 5 : a < 400 ? 8 : a < 1500 ? 11 : a < 4000 ? 15 : 18; };
function buildingHeight(tags, ring) {
  const height = parseFloat(tags.height), levels = parseFloat(tags['building:levels']);
  if (height > 0) return round(height);
  if (levels > 0) return round(levels * 3.5 + 1);
  const landmark = LANDMARKS.find(([name]) => name.test(tags.name ?? ''));
  return landmark ? landmark[1] : TYPE_HEIGHT[tags.building] ?? byFootprint(ring);
}

const ROAD_CLASS = { trunk: 'arterial', trunk_link: 'arterial', primary: 'arterial', primary_link: 'arterial',
  secondary: 'arterial', secondary_link: 'arterial', tertiary: 'local', tertiary_link: 'local', residential: 'local',
  unclassified: 'local', living_street: 'local', service: 'service' };

function buildMapContext(raw) {
  const features = [];
  const counts = { road: 0, building: 0, park: 0, water: 0, bridges: 0, tunnelsSkipped: 0, insideProperty: 0 };
  const area = (k, rings, extra) => {
    for (const [outer, ...holes] of rings) features.push({ k, ...extra, p: outer.slice(0, -1), ...(holes.length ? { holes: holes.map(h => h.slice(0, -1)) } : {}) });
  };
  // Distant context (outside the nearby square) is kept, only moved into the venue frame.
  for (const f of context.features) {
    if (f.osmWay) continue;
    if (f.k === 'road' && f.p.length === 2) {
      features.push({ k: 'road', c: (f.w ?? 8) >= 12 ? 'arterial' : 'local', w: round((f.w ?? 8) * widthScale), p: f.p.map(fromGeo) });
    } else {
      const p = f.p.map(fromGeo);
      features.push({ k: f.k, ...(f.k === 'road' ? { c: 'local' } : {}), ...(f.k === 'building' ? { h: byFootprint(p) } : {}), p, ...(f.holes ? { holes: f.holes.map(h => h.map(fromGeo)) } : {}) });
    }
  }
  // Nearby square, re-read from the OSM ways: clipped to the real property here, not to the campus footprint.
  for (const way of raw.elements) {
    const tags = way.tags || {}, k = kind(tags);
    if (!k || !way.geometry?.length) continue;
    if (tags.tunnel === 'yes') { counts.tunnelsSkipped++; continue; }
    if (k === 'road') {
      const c = ROAD_CLASS[tags.highway] ?? 'path', w = round(roadWidth(tags) * widthScale);
      const bridge = (tags.bridge && tags.bridge !== 'no') || Number(tags.layer) > 0;
      const points = way.geometry.map(g => [geo(g), venue(pixel(g.lat, g.lon))]);
      let kept = 0;
      for (let i = 1; i < points.length; i++) {
        const [ga, a] = points[i - 1], [gb, b] = points[i];
        const mid = [(ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (Math.abs(mid[0]) > 1100 || Math.abs(mid[1]) > 1100 || length < .2) continue;
        if (inside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], property[0])) { counts.insideProperty++; continue; }
        // Half a width past each end closes the joints between straight segments.
        const ex = (b[0] - a[0]) / length * w / 2, ez = (b[1] - a[1]) / length * w / 2;
        features.push({ k, c, w, ...(bridge ? { b: 1 } : {}), p: [[round(a[0] - ex), round(a[1] - ez)], [round(b[0] + ex), round(b[1] + ez)]] });
        kept++;
      }
      if (kept) { counts.road++; if (bridge) counts.bridges++; }
      continue;
    }
    const ring = way.geometry.map(g => venue(pixel(g.lat, g.lon)));
    if (ring.length < 4 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) continue;
    const clipped = clip.difference(clip.intersection([ring], square), property);
    if (!clipped.length) continue;
    counts[k]++;
    area(k, clipped, k === 'park' && (tags.natural === 'wood' || tags.landuse === 'forest') ? { c: 'trees' } : k === 'building' ? { h: buildingHeight(tags, ring) } : {});
  }
  if (counts.road < 100 || counts.park < 1) throw new Error('Incomplete nearby data; refusing to write the map context');
  return { credit: context.credit, frame: 'Venue X/Z metres through work/venue-surroundings/satellite-reference.json (z18 fit); delhi-context.json holds the same data in the geographic frame',
    source: raw.source, distantSource: 'delhi-context.json features without osmWay', classes: 'road c: arterial (trunk, primary, secondary and links), local, service, path; b: bridge or layer above ground; park c: trees for woods and forest; building h: height in metres (OSM height or levels, landmark table, else by type and footprint); tunnels left out',
    counts, features };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) throw new Error('Pass the OSM geometry JSON of the nearby square (read-osm-map.py output)');
  const result = buildMapContext(JSON.parse(fs.readFileSync(input, 'utf8')));
  // Self-check: the Convention Centre's z18 pixel must land on its venue anchor within a metre.
  const cc = satellite.anchors.find(a => a.id === 'cc'), at = venue(cc.pixel);
  if (Math.hypot(at[0] - cc.world[0], at[1] - cc.world[1]) > 1) throw new Error('Satellite fit does not place the CC anchor');
  fs.writeFileSync(output, JSON.stringify(result));
  console.log(JSON.stringify({ ...result.counts, features: result.features.length, bytes: fs.statSync(output).size }));
}
module.exports = { buildMapContext };
