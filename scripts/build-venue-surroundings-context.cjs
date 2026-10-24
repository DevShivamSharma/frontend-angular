/* Offline OSM volumes and railways for Color → Map. No network requests or GLB changes.
 * node scripts/build-venue-surroundings-context.cjs [saved OSM geometry JSON]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const clip = require('polygon-clipping');
const { pixel, venue, property, square, widthScale, inside } = require('./build-venue-map-context.cjs');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'work/venue-surroundings/osm-surroundings.json');
const output = path.join(root, 'src/assets/venue/geography/venue-surroundings.json');
const round = n => Math.round(n * 100) / 100;
const area = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;
const project = p => venue(pixel(p.lat, p.lon));
const keptTags = ['building', 'building:levels', 'height', 'min_height', 'building:min_level', 'name', 'alt_name',
  'roof:colour', 'building:colour', 'roof:material', 'railway', 'gauge', 'bridge', 'layer', 'tunnel', 'service', 'tourism'];

function metres(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n * (/ft|feet|'/.test(value) ? .3048 : 1) : undefined;
}

function buildingStyle(tags, ring, landmark) {
  const type = tags.building, name = tags.name ?? landmark ?? '';
  const station = /Supreme Court Metro/.test(name);
  const levels = parseFloat(tags['building:levels']);
  const tagged = metres(tags.height), minimum = metres(tags.min_height);
  const low = { house: 7, detached: 7, residential: 10.5, apartments: 14, shed: 4, garage: 3.5,
    garages: 3.5, roof: 4, industrial: 8, warehouse: 8, government: 14, public: 12, school: 10.5, mosque: 12 };
  // Museum buildings are separate footprints within the OSM museum grounds, never the site boundary itself.
  const fallback = station ? 17 : /Handicrafts|Crafts/.test(name) ? 7 : /Science/.test(name) ? 19 :
    /^Supreme Court of India$/.test(name) ? 14 : low[type] ?? (area(ring) < 120 ? 5 : area(ring) < 900 ? 8 : 12);
  const base = minimum ?? (parseFloat(tags['building:min_level']) * 3.5 || (station ? 12 : 0));
  const height = Math.max(base + 1, tagged > 0 ? tagged : levels > 0 ? levels * 3.5 + .8 : fallback);
  // A small roof palette follows the bundled aerial: dusty concrete, sandstone, pale metal, occasional blue sheds.
  const roof = station ? '#c1c3bd' : /Handicrafts|Crafts/.test(name) ? '#9e7c61' : /Science/.test(name) ? '#b29c85' :
    /Supreme Court/.test(name) ? '#c2b8a1' : /metal/.test(tags['roof:material'] ?? '') ? '#9ba6a6' :
    ['shed', 'industrial', 'warehouse'].includes(type) ? '#929b9b' : ['#a5a092', '#b4ad9d', '#96978d'][Math.floor(area(ring)) % 3];
  const wall = station ? '#606c6a' : /Handicrafts|Crafts|Science/.test(name) ? '#ab8a70' : '#c1b6a0';
  const colour = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : fallback;
  return { h: round(height * widthScale), base: round(base * widthScale), roof: colour(tags['roof:colour'], roof),
    wall: colour(tags['building:colour'], wall), heightSource: tagged > 0 ? 'height' : levels > 0 ? 'building:levels' : 'estimated',
    floors: Math.max(1, Math.round(levels > 0 ? levels - (parseFloat(tags['building:min_level']) || 0) : (height - base) / 3.5)),
    ...(name ? { name } : {}), ...(station ? { station: true } : {}) };
}

// Split at the coverage/property boundary, including a segment whose endpoints both lie outside.
function clippedLines(points) {
  const lines = []; let line;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], cuts = [0, 1];
    for (const ring of [square[0], property[0]]) for (let j = 1; j < ring.length; j++) {
      const c = ring[j - 1], d = ring[j], ex = d[0] - c[0], ez = d[1] - c[1], det = dx * ez - dz * ex;
      if (Math.abs(det) < 1e-8) continue;
      const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / det;
      const u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / det;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    const at = t => [round(a[0] + t * dx), round(a[1] + t * dz)];
    for (let j = 1; j < cuts.length; j++) {
      const mid = at((cuts[j - 1] + cuts[j]) / 2), start = at(cuts[j - 1]), end = at(cuts[j]);
      if (!inside(mid, square[0]) || inside(mid, property[0])) { line = undefined; continue; }
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < .1) continue;
      if (!line || Math.hypot(line.at(-1)[0] - start[0], line.at(-1)[1] - start[1]) > .1) lines.push(line = [start]);
      line.push(end);
    }
  }
  return lines;
}

function buildSurroundings(raw) {
  const buildings = [], railways = [], seen = new Set();
  const museums = raw.elements.filter(e => e.tags?.tourism === 'museum' && e.geometry?.length)
    .map(e => ({ name: e.tags.name, ring: e.geometry.map(project) }));
  for (const way of raw.elements) {
    const tags = way.tags ?? {};
    if (!way.geometry?.length || tags.tunnel === 'yes') continue;
    const p = way.geometry.map(project);
    if (tags.railway === 'rail' || tags.railway === 'subway') {
      const metro = tags.railway === 'subway', elevated = tags.bridge && tags.bridge !== 'no';
      for (const line of clippedLines(p)) railways.push({ id: way.id, p: line, metro,
        y: round((metro && elevated ? 12 : elevated ? 5 : 0) * widthScale),
        gauge: round((parseFloat(tags.gauge) / 1000 || 1.676) * widthScale), w: round((metro ? 4.4 : 3.8) * widthScale) });
    }
    if (!tags.building || ['no', 'construction'].includes(tags.building) || p.length < 4) continue;
    if (p[0][0] !== p.at(-1)[0] || p[0][1] !== p.at(-1)[1]) continue;
    const key = JSON.stringify(p); if (seen.has(key)) continue; seen.add(key);
    const landmark = museums.find(m => p.some(point => inside(point, m.ring)))?.name;
    const rings = [p, ...(way.holes ?? []).map(h => h.map(project))];
    // The historical illustrative property polygon includes both museum sites. Restore only their actual
    // OSM buildings; do not change that shared boundary, the halls, or the walkway/navigation data.
    const clipped = clip.intersection(rings, square);
    for (const [outer, ...holes] of landmark ? clipped : clip.difference(clipped, property)) {
      if (area(outer) < 12) continue;
      buildings.push({ id: way.id, ...buildingStyle(tags, p, landmark), p: outer.slice(0, -1).map(p => p.map(round)),
        ...(holes.length ? { holes: holes.map(h => h.slice(0, -1).map(p => p.map(round))) } : {}) });
    }
  }
  return { credit: '© OpenStreetMap contributors · ODbL https://www.openstreetmap.org/copyright', source: raw.source,
    frame: 'lat/lon → z18 pixel → satellite-reference.json fit (shared with build-venue-map-context.cjs)',
    sourceSha256: crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    coverage: square[0], scale: widthScale,
    note: 'Heights without OSM height/levels and bridge elevations are estimates. Building holes are courtyards. Railway rail is distinct from the elevated subway. Museum site polygons are not buildings.',
    buildings, railways };
}

const raw = JSON.parse(fs.readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : sourcePath, 'utf8'));
const source = { source: raw.source, elements: raw.elements.filter(e => e.geometry?.length &&
  (e.tags?.building || ['rail', 'subway'].includes(e.tags?.railway) || e.tags?.tourism === 'museum')).map(e => ({
    id: e.id, tags: Object.fromEntries(keptTags.filter(key => e.tags[key] !== undefined).map(key => [key, e.tags[key]])),
    geometry: e.geometry, ...(e.holes ? { holes: e.holes } : {}) })) };
const data = buildSurroundings(source);
if (data.buildings.length < 300 || data.railways.length < 10 || !data.buildings.some(b => b.station))
  throw new Error('Incomplete OSM surroundings; existing assets were not changed');
fs.writeFileSync(sourcePath, JSON.stringify(source));
fs.writeFileSync(output, JSON.stringify(data));
console.log(JSON.stringify({ buildings: data.buildings.length, railways: data.railways.length,
  taggedHeights: data.buildings.filter(b => b.heightSource !== 'estimated').length, bytes: fs.statSync(output).size }));
