import fs from 'node:fs';
import { readGlb, walk, pathName, worldBox, unionBox } from './venue-glb.mjs';

// Is a venue GLB in the explorer's frame? The frame is world X/Z metres, Y up, east +X, south +Z; the navigation,
// walkway, site-detail and map JSON files all sit in it. The centre of each reference hall is the XZ centre of the
// world bounding box of the nodes that make it up, and is compared with the known centre.
// For every choice of the two ground axes and of mirroring, a similarity (scale, rotation, translation) is fitted to
// the reference points by least squares, and the best fit is reported with per-hall residuals.
// Usage: node scripts/check-venue-frame.mjs <model.glb> [--map halls.json] [--json out.json]
//   halls.json: { "CC": { "expected": [x, z], "match": "<regex on a node's own name or path>" }, ... }
const [file, ...rest] = process.argv.slice(2);
const option = name => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
if (!file) { console.error('Usage: node scripts/check-venue-frame.mjs <model.glb> [--map halls.json] [--json out.json]'); process.exit(2); }
// Defaults describe the earlier model; a new model needs its own --map.
const DEFAULT_MAP = {
  CC: { expected: [-345.2, 129.0], match: '^PHOTO_CC ' },
  'Hall 14': { expected: [-223.6, 4.9], match: '^PHOTO_HALL_14 ' },
  'Hall 1': { expected: [151.5, 232.7], match: '^PHOTO_HALL_1 ' },
  'Hall 6': { expected: [248.0, -277.2], match: '^PHOTO_HALL_6 ' },
};
const map = option('--map') ? JSON.parse(fs.readFileSync(option('--map'), 'utf8')) : DEFAULT_MAP;
const glb = readGlb(file), { json } = glb, { parent, world, reached } = walk(json);
const halls = Object.entries(map).map(([name, spec]) => {
  const own = new RegExp(spec.match), boxes = [];
  let count = 0, box;
  json.nodes.forEach((node, i) => {
    if (!reached.has(i) || !(own.test(node.name ?? '') || (spec.matchPath && new RegExp(spec.matchPath).test(pathName(json, parent, i))))) return;
    count++; box = unionBox(box, worldBox(json, node, world[i]));
  });
  return { name, expected: spec.expected, nodes: count, box };
});
const missing = halls.filter(h => !h.box);
if (missing.length) { console.error('No geometry for: ' + missing.map(h => `${h.name} (${map[h.name].match})`).join(', ')); process.exit(1); }

// Fit s*R*(p or mirrored p) + t to the expected points; closed form (Umeyama, 2D).
function fit(src, dst, mirror) {
  const p = src.map(([x, y]) => [mirror ? -x : x, y]), n = p.length;
  const mp = [0, 1].map(k => p.reduce((a, q) => a + q[k], 0) / n), md = [0, 1].map(k => dst.reduce((a, q) => a + q[k], 0) / n);
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const px = p[i][0] - mp[0], py = p[i][1] - mp[1], dx = dst[i][0] - md[0], dy = dst[i][1] - md[1];
    a += px * dx + py * dy; b += px * dy - py * dx; norm += px * px + py * py;
  }
  const theta = Math.atan2(b, a), scale = Math.hypot(a, b) / norm, c = Math.cos(theta), s = Math.sin(theta);
  const apply = ([x, y]) => { const px = (mirror ? -x : x) - mp[0], py = y - mp[1]; return [scale * (c * px - s * py) + md[0], scale * (s * px + c * py) + md[1]]; };
  const residuals = src.map((q, i) => Math.hypot(apply(q)[0] - dst[i][0], apply(q)[1] - dst[i][1]));
  return { scale, thetaDeg: theta * 180 / Math.PI, mirror, residuals, rms: Math.sqrt(residuals.reduce((t, r) => t + r * r, 0) / n), apply, mp, md };
}
const AXES = ['x', 'y', 'z'], results = [];
for (const [u, v] of [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]]) {
  const src = halls.map(h => [(h.box[u] + h.box[3 + u]) / 2, (h.box[v] + h.box[3 + v]) / 2]);
  for (const mirror of [false, true]) results.push({ axes: [AXES[u], AXES[v]], up: AXES[3 - u - v], ...fit(src, halls.map(h => h.expected), mirror), src });
}
results.sort((a, b) => a.rms - b.rms);
const best = results[0];
// The "as-is" reading: model x/z used directly, no transform.
const asIs = results.find(r => r.axes.join() === 'x,z' && !r.mirror && Math.abs(r.scale - 1) < 1e-9);
const direct = halls.map(h => Math.hypot((h.box[0] + h.box[3]) / 2 - h.expected[0], (h.box[2] + h.box[5]) / 2 - h.expected[1]));
const report = {
  model: file, nodes: json.nodes.length,
  halls: halls.map((h, i) => ({ name: h.name, matchedNodes: h.nodes, expected: h.expected, modelCentre_xz: [+((h.box[0] + h.box[3]) / 2).toFixed(2), +((h.box[2] + h.box[5]) / 2).toFixed(2)], modelCentre_xy: [+((h.box[0] + h.box[3]) / 2).toFixed(2), +((h.box[1] + h.box[4]) / 2).toFixed(2)], residual_if_used_unchanged_m: +direct[i].toFixed(2) })),
  inFrameAsIs: direct.every(d => d < 3),
  bestFit: { groundAxes: best.axes, up: best.up, mirrored: best.mirror, scale: +best.scale.toFixed(6), rotationDeg: +best.thetaDeg.toFixed(4), residuals_m: best.residuals.map(r => +r.toFixed(3)), rms_m: +best.rms.toFixed(3) },
  runnersUp: results.slice(1, 4).map(r => ({ groundAxes: r.axes, mirrored: r.mirror, scale: +r.scale.toFixed(4), rms_m: +r.rms.toFixed(2) })),
  note: 'Four reference points leave 4 redundant equations for a 4-parameter similarity: a small rms means the frame is a similarity of the expected frame, not just a coincidence of two points.',
};
console.log(JSON.stringify(report, null, 2));
if (option('--json')) fs.writeFileSync(option('--json'), JSON.stringify(report, null, 2));
