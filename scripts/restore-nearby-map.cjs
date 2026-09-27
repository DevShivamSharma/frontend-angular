/* Offline only: fill the oversized omission in the bundled OSM context.
 * Uses existing dependencies; no polygon clipping runs in the home renderer.
 * node --preserve-symlinks scripts/restore-nearby-map.cjs input.json
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const clip = require('polygon-clipping');

const asset = 'src/assets/venue/geography/delhi-context.json';
const model = 'outputs/outputs/IITF_2026_ARCHITECTURAL.glb';
// Replace a square entirely covered by the downloaded geographic bounding box.
// Keep the distant data and trim both datasets at the same seam.
const extent = 1100;
const nearSquare = [[[-extent, -extent], [extent, -extent], [extent, extent], [-extent, extent], [-extent, -extent]]];
const round = n => Math.round(n * 100) / 100;

const { campusFootprint } = require('./model-footprint.cjs');

function roadPolygon(a, b, width) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < .2) return null;
  const x = dz / length * width / 2, z = -dx / length * width / 2;
  return [[[a[0] + x, a[1] + z], [b[0] + x, b[1] + z],
    [b[0] - x, b[1] - z], [a[0] - x, a[1] - z], [a[0] + x, a[1] + z]]];
}

function polygon(feature) {
  return feature.k === 'road' && feature.p.length === 2
    ? roadPolygon(feature.p[0], feature.p[1], feature.w || 8)
    : [feature.p, ...(feature.holes || [])];
}

function kind(tags) {
  if (tags.highway && !['proposed', 'construction'].includes(tags.highway)) return 'road';
  if (tags.building && tags.building !== 'no') return 'building';
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water';
  if (['wood', 'grassland', 'scrub'].includes(tags.natural) ||
      ['grass', 'forest', 'meadow', 'recreation_ground'].includes(tags.landuse) ||
      ['park', 'garden', 'pitch'].includes(tags.leisure)) return 'park';
  return null;
}

function roadWidth(tags) {
  const specified = Number(tags.width);
  if (Number.isFinite(specified) && specified > 0) return Math.min(40, specified);
  return { motorway: 16, trunk: 16, primary: 12, secondary: 10, tertiary: 8,
    residential: 6, unclassified: 6, service: 4, footway: 2.4, path: 2.4,
    pedestrian: 4, steps: 2.4, cycleway: 2.4 }[tags.highway] || 6;
}

function restoreContext(context, raw, footprint) {
  const features = [];
  function append(feature, polygons) {
    for (const rings of polygons) {
      const p = rings[0];
      const area = Math.abs(p.slice(1).reduce((sum, b, i) => sum + p[i][0] * b[1] - b[0] * p[i][1], 0)) / 2;
      if (area < .05) continue;
      const { holes: ignored, ...base } = feature;
      // Preserve clipping precision at the shared seam and campus boundary.
      const result = { ...base, p };
      if (rings.length > 1) result.holes = rings.slice(1);
      features.push(result);
    }
  }
  for (const f of context.features) {
    // Cheap rejection keeps all untouched distant outlines byte-for-byte.
    if (f.p.every(([x]) => x < -extent - 25) || f.p.every(([x]) => x > extent + 25) ||
        f.p.every(([, z]) => z < -extent - 25) || f.p.every(([, z]) => z > extent + 25)) {
      features.push(f); continue;
    }
    const shape = polygon(f);
    if (shape) append(f, clip.difference(shape, nearSquare));
  }
  const origin = context.origin, scale = Math.PI / 180 * 6371000;
  const project = p => [round((p.lon - origin.lon) * scale * Math.cos(origin.lat * Math.PI / 180)), round((origin.lat - p.lat) * scale)];
  const counts = { road: 0, building: 0, park: 0, water: 0 };
  for (const way of raw.elements) {
    const k = kind(way.tags || {});
    if (!k || !way.geometry?.length) continue;
    const points = way.geometry.map(project);
    const pieces = [];
    if (k === 'road') {
      const width = roadWidth(way.tags);
      for (let i = 1; i < points.length; i++) {
        const p = roadPolygon(points[i - 1], points[i], width);
        if (p) pieces.push(p);
      }
    } else {
      if (points.length < 4 || points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1]) continue;
      pieces.push([points]);
    }
    for (const shape of pieces) {
      const clipped = clip.intersection(shape, nearSquare);
      if (!clipped.length) continue;
      const outside = clip.difference(clipped, footprint);
      if (outside.length) {
        counts[k]++;
        append({ k, p: [], osmWay: way.id }, outside);
      }
    }
  }
  if (counts.road < 100 || counts.park < 1) throw new Error('Incomplete nearby data; refusing to replace the asset');
  return { ...context, features, nearby: { source: raw.source, extentMetres: extent,
    origin: context.origin, exclusion: 'Union of transformed SITE_GROUND, authored admin ground surfaces, campus paths and gate entry apron; no radius buffer',
    footprint, counts } };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) throw new Error('Pass an OSM geometry JSON file');
  const source = fs.readFileSync(input), modelBytes = fs.readFileSync(model);
  const output = restoreContext(JSON.parse(fs.readFileSync(asset)), JSON.parse(source), campusFootprint(modelBytes));
  output.nearby.importedAt = new Date().toISOString();
  output.nearby.inputSha256 = crypto.createHash('sha256').update(source).digest('hex');
  output.nearby.modelSha256 = crypto.createHash('sha256').update(modelBytes).digest('hex');
  fs.writeFileSync(asset, JSON.stringify(output));
  console.log(JSON.stringify({ total: output.features.length, nearby: output.nearby.counts, bytes: fs.statSync(asset).size }));
}
module.exports = { campusFootprint, restoreContext, polygon, nearSquare };
