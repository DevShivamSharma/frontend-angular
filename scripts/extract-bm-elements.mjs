import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadGlb } from './render-venue-plan.mjs';

// Offline: copy a few elements of the Bharat Mandapam CAD model into the explorer as a small detail asset.
//   node scripts/extract-bm-elements.mjs <bharat-mandapam.meshopt.glb>
// The source is the prepared model of branch claude/sweet-newton-zhejct (Git LFS), already in the explorer frame
// (world X/Z metres, Y up, east +X, south +Z). Each element is fitted onto the matching part of the earlier model
// (IITF_2026_ARCHITECTURAL.glb) by its own translation and turn about Y (scale 1), because the two layouts differ by
// 10-30 m. The selected nodes keep their meshopt data unchanged (vertex views copied, index views re-encoded
// losslessly); each element is one parent node carrying its fit.
// Writes src/assets/venue/venue-bm-elements.glb and venue-bm-elements.json (mapping, fits, residuals, the parts of
// the earlier model each element replaces and the footprint inside which they are cut away at run time).
const [source] = process.argv.slice(2);
if (!source) { console.error('Usage: node scripts/extract-bm-elements.mjs <bharat-mandapam.meshopt.glb>'); process.exit(2); }
const OLD_MODEL = 'src/assets/venue/IITF_2026_ARCHITECTURAL.glb';
const OUT_GLB = 'src/assets/venue/venue-bm-elements.glb', OUT_JSON = 'src/assets/venue/venue-bm-elements.json';

/** The elements. `nodes` and `region` (X/Z box, prepared-model frame) select source nodes by name and centre.
 * `old` names the earlier model's parts (spaced names; also runtime objects of its photo passes) that the element
 * replaces (all of them, or inside its footprint: `cut`); `inside` parts are always cut inside the footprint only.
 * `fit` says how the element is placed on them; 'as <id>' reuses another element's transform. */
const ELEMENTS = [
  {
    id: 'tunnel', label: 'Central covered walk (canopy with lattice)',
    nodes: /^(Central canopy (deep fascia|interior continuous soffit|remaining solid roof panels)|Canopy bent bronze side panels|Canopy bent transverse frame|Canopy continuous panel bearing|Canopy front individual metal grating bars|Main canopy longitudinal Y fork|Recovered native canopy steel column|Native canopy ticket-booth wall)/,
    region: [-140, 50, 55, 195],
    fitNew: /^Central canopy remaining solid roof panels$/, fitOld: /^PHOTO VIDEO central spine curved roof$/, fit: 'axis',
    // The earlier spine is longer (303 m against 179 m): only the part under the new canopy goes, its ends stay.
    cut: 'footprint',
    old: ['^PHOTO CENTRAL SPINE continuous canopy columns trusses and gutters', '^PHOTO VIDEO central spine curved roof',
      '^REFERENCE (canopy perforated infill|canopy panel frames)$', '^PHOTO concourse (stone column bases|event banners)$',
      '^ARCH Pedestrian canopy edge lighting$'],
    tags: {},
  },
  {
    id: 'forecourt', label: 'Forecourt garden: sandstone shafts, lawns, benches, planting',
    nodes: /^(Forecourt (shaft|lawn)|Shaft (sandstone coursing|return stone bed joint)|Native (seats|paving)|Stone seat cap|Low planted-bed shrub|DWG planting bed|Planting bed edging|Planted surface)/,
    region: [-160, 100, 0, 212],
    // Placed with the walk's transform, so walk, garden, plaza and Hall 14 keep their exact CAD arrangement.
    fit: 'as tunnel',
    // The whole earlier garden goes; leftover portals at its corners would mix the two designs.
    cut: 'all',
    old: ['^PHOTO CENTRAL GARDEN (hedges and trees|raised beds benches and lawns|sandstone display portals)$'],
    tags: {},
  },
  {
    id: 'plaza', label: 'Central plaza: patterned paving with rose bands, slab islands, ventilation grilles',
    nodes: /^(Plaza patterned paving|Plaza solid slab islands|Vent grille|Pale ventilation louvre blade|Shaft (white louvre|vent inset|inset top|projecting coping))/,
    region: [-80, -200, 300, 110],
    fit: 'as tunnel',
    // Laid over the earlier site ground (SITE_GROUND stays underneath); the planters standing on it go.
    cut: 'all', old: [], inside: ['^SITE DETAIL decorative planters$'],
    tags: {},
  },
  {
    id: 'amphitheatre1', label: 'Amphitheatre 1: sandstone seating bands',
    nodes: /^(North seating\s*\/?\s*paving band|Planting bed edging|Planted surface)/, region: [150, -105, 215, -35],
    fitNew: /^North seating\s*\/?\s*paving band /, fitOld: /^PHOTO VIDEO amphitheatre 1 seating with stair aisles$/, fit: 'grid',
    // Only the seating: the earlier stage, guardrails and outer planting stay (the CAD model has none).
    cut: 'all',
    old: ['^PHOTO VIDEO amphitheatre 1 seating with stair aisles$'],
    tags: {},
  },
  {
    id: 'amphitheatre2', label: 'Amphitheatre 2: sandstone seating bands',
    nodes: /^(South seating\s*\/?\s*paving band|Planting bed edging|Planted surface)/, region: [78, 18, 143, 88],
    fitNew: /^South seating\s*\/?\s*paving band /, fitOld: /^PHOTO VIDEO amphitheatre 2 seating with stair aisles$/, fit: 'grid',
    cut: 'all',
    old: ['^PHOTO VIDEO amphitheatre 2 seating with stair aisles$'],
    tags: {},
  },
  {
    id: 'hall14', label: 'Hall 14 drum',
    nodes: /^Hall 14 /, region: [-300, -100, -100, 120],
    fit: 'as tunnel',
    cut: 'all',
    old: ['^PHOTO HALL 14 ', '^ROOF LABEL H14$', '^ARCH H14 SIGN$', '^REFERENCE HALL 14 ', '^HALL 14 entrance detail$', '^PHOTO ROOF SIGN BOARD H14$'],
    // The larger CAD drum covers part of the earlier CC-to-garden canopy.
    inside: ['^PHOTO CC corrected garden connection '],
    tags: { hall: '14' },
    // Interiors and the visitor fit Hall 14 to this roof (venue-interiors.ts).
    roles: { '^Hall 14 roof$': 'hallRoof', '^Hall 14 (standing seams|roof coping)$': 'hallRoofPart' },
  },
];
/** The CAD colours are kept (as vertex colours at run time); each material only chooses a shared finish. */
const finishOf = name => /glazing/i.test(name) ? 'glass' : /steel|bronze|canopy|grille|louvre/i.test(name) ? 'metal' : 'matte';
const spaced = name => name.replace(/_/g, ' ');

// ---------- geometry of both models (GLTFLoader, as the viewer sees them) ----------
const [newScene, oldScene] = [await loadGlb(source), await loadGlb(OLD_MODEL)];
for (const s of [newScene, oldScene]) s.updateMatrixWorld(true);
const pointsOf = (scene, test) => {
  const out = [];
  scene.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    let hit = false; for (let p = o; p && !hit; p = p.parent) hit = test(spaced(p.name));
    if (!hit) return;
    const pos = o.geometry.getAttribute('position'), v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push([v.x, v.z]); }
  });
  return out;
};
const inRegion = ([x0, z0, x1, z1]) => o => { const c = new T.Box3().setFromObject(o).getCenter(new T.Vector3()); return c.x >= x0 && c.x <= x1 && c.z >= z0 && c.z <= z1; };
const elementPoints = (element, extra = () => true) => {
  const out = [], region = inRegion(element.region);
  newScene.traverse(o => {
    if (!(o instanceof T.Mesh) || !element.nodes.test(spaced(o.name)) || !extra(o) || !region(o)) return;
    const pos = o.geometry.getAttribute('position'), v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push([v.x, v.z]); }
  });
  return out;
};
const max = values => values.reduce((a, v) => v > a ? v : a, -Infinity), min = values => values.reduce((a, v) => v < a ? v : a, Infinity);
const mean = ps => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
const axisAngle = ps => {
  const [mx, mz] = mean(ps); let xx = 0, zz = 0, xz = 0;
  for (const [x, z] of ps) { xx += (x - mx) ** 2; zz += (z - mz) ** 2; xz += (x - mx) * (z - mz); }
  return .5 * Math.atan2(2 * xz, xx - zz);
};
const rotate = ([x, z], t) => [Math.cos(t) * x - Math.sin(t) * z, Math.sin(t) * x + Math.cos(t) * z];
/** Centre of the box of the points measured along the campus axes (the halls' 30°/120° grid). */
const CAMPUS = Math.atan2(.5, .8660254038);
const gridCentre = ps => {
  const local = ps.map(p => rotate(p, -CAMPUS));
  const c = [(min(local.map(p => p[0])) + max(local.map(p => p[0]))) / 2, (min(local.map(p => p[1])) + max(local.map(p => p[1]))) / 2];
  return rotate(c, CAMPUS);
};
const hull = points => {
  const ps = [...new Map(points.map(p => [p.map(v => v.toFixed(2)).join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const h = []; for (const p of list) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h.slice(0, -1); };
  return [...half(ps), ...half([...ps].reverse())];
};
const boundary = polygon => polygon.flatMap((a, i) => { const b = polygon[(i + 1) % polygon.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); return Array.from({ length: n }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); });
const distanceTo = (polygon, [x, z]) => min(polygon.map((a, i) => { const b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz; const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0; return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); }));
const outset = (polygon, d) => { const [cx, cz] = mean(polygon); return polygon.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1; return [x + (x - cx) / l * d, z + (z - cz) / l * d]; }); };

// ---------- fits ----------
const manifest = { source: { file: 'bharat-mandapam.meshopt.glb', branch: 'claude/sweet-newton-zhejct', sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') }, elements: [] };
const fits = new Map();
for (const element of ELEMENTS) {
  if (element.fit.startsWith('as ')) {
    const same = fits.get(element.fit.slice(3)), entry = manifest.elements.find(e => e.id === element.fit.slice(3));
    fits.set(element.id, same);
    const all = elementPoints(element), placed = hull(all.map(p => { const r = rotate(p, same.theta); return [r[0] + same.t[0], r[1] + same.t[1]]; }));
    manifest.elements.push({ id: element.id, label: element.label, fit: { ...entry.fit, method: element.fit },
      residual: { description: `placed with ${element.fit.slice(3)}'s transform: same arrangement as in the CAD model` },
      replaces: element.old, cut: element.cut, inside: element.inside ?? [], roles: element.roles ?? {},
      footprint: outset(placed, 1).map(p => p.map(v => +v.toFixed(2))), tags: element.tags });
    continue;
  }
  const newKey = elementPoints(element, o => element.fitNew.test(spaced(o.name)));
  const oldKey = pointsOf(oldScene, n => element.fitOld.test(n));
  if (!newKey.length || !oldKey.length) throw new Error(`${element.id}: fit geometry missing (new ${newKey.length}, old ${oldKey.length})`);
  let theta = 0;
  if (element.fit === 'axis') {
    theta = axisAngle(oldKey) - axisAngle(newKey);
    while (theta > Math.PI / 2) theta -= Math.PI; while (theta < -Math.PI / 2) theta += Math.PI;
  }
  // Centres: the long axis (tunnel), the grid box (shaft and portal grids) or the plain mean (hall roof).
  const centre = element.fit === 'grid' ? gridCentre : mean;
  const [nx, nz] = centre(newKey.map(p => rotate(p, theta))), [ox, oz] = centre(oldKey);
  const t = [ox - nx, oz - nz];
  const place = p => { const r = rotate(p, theta); return [r[0] + t[0], r[1] + t[1]]; };
  const all = elementPoints(element);
  const placed = hull(all.map(place)), oldHull = hull(oldKey);
  const a = boundary(placed), b = boundary(oldHull);
  const ab = a.map(p => distanceTo(oldHull, p)), ba = b.map(p => distanceTo(placed, p));
  const extent = (ps, angle) => { const l = ps.map(p => rotate(p, -angle)); return [max(l.map(p => p[0])) - min(l.map(p => p[0])), max(l.map(p => p[1])) - min(l.map(p => p[1]))]; };
  const along = element.fit === 'axis' ? axisAngle(oldKey) : CAMPUS;
  fits.set(element.id, { theta, t });
  manifest.elements.push({
    id: element.id, label: element.label,
    fit: { method: element.fit, rotationDeg: +(theta * 180 / Math.PI).toFixed(3), translationXZ: t.map(v => +v.toFixed(2)),
      movedBy: +Math.hypot(...t).toFixed(2), newReference: element.fitNew.source, oldReference: element.fitOld.source },
    residual: {
      description: 'outline of the placed element vs outline of the earlier part it replaces (its fit reference), metres',
      meanNewToOld: +(ab.reduce((s, v) => s + v, 0) / ab.length).toFixed(2), maxNewToOld: +max(ab).toFixed(2),
      meanOldToNew: +(ba.reduce((s, v) => s + v, 0) / ba.length).toFixed(2), maxOldToNew: +max(ba).toFixed(2),
      sizeAlongAcross: { new: extent(all.map(place), along).map(v => +v.toFixed(1)), old: extent(oldKey, along).map(v => +v.toFixed(1)) },
    },
    replaces: element.old, cut: element.cut, inside: element.inside ?? [], roles: element.roles ?? {},
    footprint: outset(placed, 1).map(p => p.map(v => +v.toFixed(2))), tags: element.tags,
  });
}

// ---------- write the asset: selected nodes under one fitted parent per element ----------
const bytes = fs.readFileSync(source), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)), bin = bytes.subarray(28 + jsonLength);
const nodeCentre = node => {
  const m = new T.Matrix4().compose(new T.Vector3(...(node.translation ?? [0, 0, 0])), new T.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new T.Vector3(...(node.scale ?? [1, 1, 1])));
  const box = new T.Box3();
  for (const p of json.meshes[node.mesh].primitives) {
    const a = json.accessors[p.attributes.POSITION], unit = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
    box.union(new T.Box3(new T.Vector3(...a.min.map(v => Math.max(v / unit, -1))), new T.Vector3(...a.max.map(v => Math.max(v / unit, -1)))).applyMatrix4(m));
  }
  return box.getCenter(new T.Vector3());
};
const nodes = [], meshMap = new Map(), meshes = [], accessorMap = new Map(), accessors = [], materialMap = new Map(), materials = [], roots = [];
const keepAccessor = i => { if (!accessorMap.has(i)) { accessorMap.set(i, accessors.length); accessors.push({ ...json.accessors[i] }); } return accessorMap.get(i); };
for (const element of ELEMENTS) {
  const { theta, t } = fits.get(element.id), [x0, z0, x1, z1] = element.region, children = [];
  json.nodes.forEach(node => {
    if (node.mesh === undefined || node.children?.length || !element.nodes.test(node.name ?? '')) return;
    const c = nodeCentre(node);
    if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) return;
    if (!meshMap.has(`${element.id}:${node.mesh}`)) {
      const mesh = json.meshes[node.mesh];
      meshMap.set(`${element.id}:${node.mesh}`, meshes.length);
      meshes.push({ ...mesh, primitives: mesh.primitives.map(p => {
        const key = `${element.id}:${p.material}`;
        if (!materialMap.has(key)) {
          const m = json.materials[p.material];
          materialMap.set(key, materials.length);
          materials.push({ ...m, name: `BM ${element.id} · ${m.name}`, extras: { ...m.extras, bmSourceMaterial: m.name, bmFinish: finishOf(m.name) } });
        }
        return { ...p, material: materialMap.get(key), attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, keepAccessor(v)])),
          ...(p.indices !== undefined ? { indices: keepAccessor(p.indices) } : {}) };
      }) });
    }
    children.push(nodes.length);
    nodes.push({ ...node, mesh: meshMap.get(`${element.id}:${node.mesh}`) });
  });
  const entry = manifest.elements.find(e => e.id === element.id);
  entry.sourceNodes = children.length;
  entry.triangles = children.reduce((s, i) => s + meshes[nodes[i].mesh].primitives.reduce((u, p) => u + (p.indices !== undefined ? accessors[p.indices].count / 3 : 0), 0), 0);
  roots.push(nodes.length);
  nodes.push({ name: `BM_ELEMENT_${element.id}`, children, rotation: [0, Math.sin(-theta / 2), 0, Math.cos(-theta / 2)], translation: [t[0], 0, t[1]],
    extras: { bmElement: element.id, ...element.tags } });
}
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const chunks = []; let offset = 0, fallback = 0;
const append = data => { const start = offset, padded = Buffer.alloc(Math.ceil(data.length / 4) * 4); Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(padded); chunks.push(padded); offset += padded.length; return start; };
const addFallback = length => { const at = fallback; fallback += Math.ceil(length / 4) * 4; return at; };
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const readers = new Map(); json.accessors.forEach(a => readers.set(a.bufferView, (readers.get(a.bufferView) ?? 0) + 1));
const users = new Map(); accessors.forEach((a, i) => users.set(a.bufferView, [...(users.get(a.bufferView) ?? []), i]));
const bufferViews = [];
for (const [viewIndex, list] of users) {
  const view = json.bufferViews[viewIndex], ext = view.extensions.EXT_meshopt_compression;
  const compressed = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
  if (readers.get(viewIndex) === 1) {
    accessors[list[0]].bufferView = bufferViews.length;
    bufferViews.push({ ...view, buffer: 1, byteOffset: addFallback(view.byteLength), extensions: { EXT_meshopt_compression: { ...ext, buffer: 0, byteOffset: append(compressed) } } });
    continue;
  }
  const decoded = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride, compressed, ext.mode, ext.filter ?? 'NONE');
  const parts = []; let length = 0;
  for (const i of list) {
    const a = accessors[i], size = a.count * SIZE[a.componentType] * WIDTH[a.type];
    parts.push(decoded.subarray(a.byteOffset ?? 0, (a.byteOffset ?? 0) + size));
    a.byteOffset = length; a.bufferView = bufferViews.length; length += size;
  }
  const data = new Uint8Array(length); let at = 0; for (const p of parts) { data.set(p, at); at += p.length; }
  const count = length / ext.byteStride, mode = ext.mode === 'TRIANGLES' && count % 3 === 0 ? 'TRIANGLES' : 'INDICES';
  const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, ext.byteStride, mode);
  bufferViews.push({ buffer: 1, byteOffset: addFallback(length), byteLength: length, target: view.target,
    extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.length, byteStride: ext.byteStride, count, mode } } });
}
const out = {
  asset: { version: '2.0', generator: 'scripts/extract-bm-elements.mjs', extras: { source: manifest.source } },
  extensionsUsed: json.extensionsUsed, extensionsRequired: json.extensionsRequired,
  scene: 0, scenes: [{ name: 'Bharat Mandapam elements', nodes: roots }], nodes, meshes, materials, accessors, bufferViews,
  buffers: [{ byteLength: offset }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }],
};
const text = Buffer.from(JSON.stringify(out)), jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(jsonChunk);
const binChunk = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(binChunk.length); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(OUT_GLB, Buffer.concat([header, jsonChunk, binHeader, binChunk]));
manifest.asset = { file: 'venue-bm-elements.glb', bytes: fs.statSync(OUT_GLB).size };
fs.writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ glb: OUT_GLB, bytes: manifest.asset.bytes, elements: manifest.elements.map(e => ({ id: e.id, nodes: e.sourceNodes, triangles: e.triangles, fit: e.fit, residual: e.residual })) }, null, 1));
