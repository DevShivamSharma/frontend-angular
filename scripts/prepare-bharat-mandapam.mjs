import fs from 'node:fs';
import crypto from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer';
import { readGlb, readGlbBin, decodeView, walk, worldBox, unionBox } from './venue-glb.mjs';

// Offline: turn the supplied Bharat Mandapam export into the explorer's model.
//  1. Drops the 381 + 23 stacked copies of "DWG circulation/landscape edges · cascade reference" (.001, .002, …);
//     the first copy of each is kept. The copies are 94-97 % the same triangles at the same transform and carry
//     ~89 % of all triangles.
//  2. Bakes the frame fit into every node (all nodes are scene roots): the similarity that takes the model's hall
//     centres onto the explorer frame (world X/Z metres, Y up, east +X, south +Z), fitted on the four reference
//     halls in scripts/venue-frame-bharat-mandapam.json.
//  3. Repacks the binary. Vertex views are copied as the same meshopt bytes; the shared index views keep only the
//     ranges still used and are encoded again (lossless). Nothing is quantized further or simplified.
// Usage: node scripts/prepare-bharat-mandapam.mjs <supplied.glb> [output.glb]
const [source, output = 'src/assets/venue/bharat-mandapam.meshopt.glb'] = process.argv.slice(2);
if (!source) { console.error('Usage: node scripts/prepare-bharat-mandapam.mjs <supplied.glb> [output.glb]'); process.exit(2); }
const DUPLICATE = /^DWG (circulation|landscape) edges · cascade reference\.\d{3}$/;
const HALLS = JSON.parse(fs.readFileSync(new URL('./venue-frame-bharat-mandapam.json', import.meta.url), 'utf8'));

const glb = readGlb(source), json = glb.json, bin = readGlbBin(glb);
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');

// --- frame fit (2D similarity on X/Z, Umeyama), the same as scripts/check-venue-frame.mjs ---
const { world } = walk(json);
const pairs = Object.entries(HALLS).map(([name, spec]) => {
  const re = new RegExp(spec.match); let box;
  json.nodes.forEach((node, i) => { if (re.test(node.name ?? '')) box = unionBox(box, worldBox(json, node, world[i])); });
  if (!box) throw new Error(`No geometry for ${name}`);
  return { name, from: [(box[0] + box[3]) / 2, (box[2] + box[5]) / 2], to: spec.expected };
});
const n = pairs.length, mf = [0, 1].map(k => pairs.reduce((t, p) => t + p.from[k], 0) / n), mt = [0, 1].map(k => pairs.reduce((t, p) => t + p.to[k], 0) / n);
let a = 0, b = 0, norm = 0;
for (const p of pairs) {
  const fx = p.from[0] - mf[0], fz = p.from[1] - mf[1], tx = p.to[0] - mt[0], tz = p.to[1] - mt[1];
  a += fx * tx + fz * tz; b += fx * tz - fz * tx; norm += fx * fx + fz * fz;
}
const theta = Math.atan2(b, a), scale = Math.hypot(a, b) / norm, cos = Math.cos(theta), sin = Math.sin(theta);
// X' = s(cos x - sin z) + tx, Z' = s(sin x + cos z) + tz. A turn of the X/Z plane by theta is a rotation about +Y by -theta.
const tx = mt[0] - scale * (cos * mf[0] - sin * mf[1]), tz = mt[1] - scale * (sin * mf[0] + cos * mf[1]);
const toFrame = ([x, z]) => [scale * (cos * x - sin * z) + tx, scale * (sin * x + cos * z) + tz];
const residuals = pairs.map(p => { const q = toFrame(p.from); return { hall: p.name, metres: +Math.hypot(q[0] - p.to[0], q[1] - p.to[1]).toFixed(2) }; });
const half = -theta / 2, qy = [0, Math.sin(half), 0, Math.cos(half)];
const qmul = (p, q) => [p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1], p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
  p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3], p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2]];

// --- keep nodes, then everything they reach ---
const keptNodes = [], nodeMap = new Map();
json.nodes.forEach((node, i) => { if (!DUPLICATE.test(node.name ?? '')) { nodeMap.set(i, keptNodes.length); keptNodes.push(node); } });
if (keptNodes.some(node => node.children?.length || node.matrix)) throw new Error('Expected a flat scene of TRS nodes');
const meshMap = new Map(), meshes = [], accessorMap = new Map(), accessors = [];
const keepAccessor = index => { if (!accessorMap.has(index)) { accessorMap.set(index, accessors.length); accessors.push(json.accessors[index]); } return accessorMap.get(index); };
for (const node of keptNodes) {
  if (node.mesh !== undefined && !meshMap.has(node.mesh)) {
    const mesh = json.meshes[node.mesh];
    meshMap.set(node.mesh, meshes.length);
    meshes.push({ ...mesh, primitives: mesh.primitives.map(p => ({ ...p,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, keepAccessor(v)])),
      ...(p.indices !== undefined ? { indices: keepAccessor(p.indices) } : {}) })) });
  }
}
const nodes = keptNodes.map(node => {
  const t = node.translation ?? [0, 0, 0], r = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
  const [x, z] = toFrame([t[0], t[2]]);
  return { ...node, ...(node.mesh !== undefined ? { mesh: meshMap.get(node.mesh) } : {}),
    translation: [x, t[1] * scale, z], rotation: qmul(qy, r), scale: s.map(v => v * scale) };
});

// --- repack buffer views ---
await MeshoptEncoder.ready;
const chunks = []; let offset = 0;
const append = bytes => { const start = offset, padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).copy(padded); chunks.push(padded); offset += padded.length; return start; };
const users = new Map();
accessors.forEach((accessor, i) => users.set(accessor.bufferView, [...(users.get(accessor.bufferView) ?? []), i]));
const bufferViews = [], newAccessors = accessors.map(accessor => ({ ...accessor }));
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
let fallback = 0, reencoded = 0, copied = 0;
const addFallback = length => { const at = fallback; fallback += Math.ceil(length / 4) * 4; return at; };
for (const [viewIndex, readers] of users) {
  const view = json.bufferViews[viewIndex], ext = view.extensions?.EXT_meshopt_compression;
  if (!ext) throw new Error(`View ${viewIndex} is not meshopt-compressed`);
  const allReaders = json.accessors.filter(acc => acc.bufferView === viewIndex).length;
  if (allReaders === 1 && readers.length === 1) {
    // One accessor reads the whole view: the compressed bytes move unchanged.
    const bytes = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    newAccessors[readers[0]].bufferView = bufferViews.length;
    bufferViews.push({ ...view, buffer: 1, byteOffset: addFallback(view.byteLength),
      extensions: { ...view.extensions, EXT_meshopt_compression: { ...ext, buffer: 0, byteOffset: append(bytes) } } });
    copied++; continue;
  }
  // A shared index view: keep the used ranges only, then encode again.
  if (ext.mode !== 'TRIANGLES' && ext.mode !== 'INDICES') throw new Error(`Shared view ${viewIndex} has mode ${ext.mode}`);
  const decoded = await decodeView(glb, bin, viewIndex), stride = ext.byteStride, parts = [];
  let length = 0;
  for (const i of readers) {
    const accessor = accessors[i], bytes = accessor.count * SIZE[accessor.componentType] * WIDTH[accessor.type];
    if (SIZE[accessor.componentType] !== stride) throw new Error('Index size differs from view stride');
    parts.push(decoded.subarray(accessor.byteOffset ?? 0, (accessor.byteOffset ?? 0) + bytes));
    newAccessors[i].byteOffset = length; newAccessors[i].bufferView = bufferViews.length; length += bytes;
  }
  const data = new Uint8Array(length); let at = 0;
  for (const part of parts) { data.set(part, at); at += part.length; }
  const count = length / stride, mode = ext.mode === 'TRIANGLES' && count % 3 === 0 ? 'TRIANGLES' : 'INDICES';
  const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode);
  bufferViews.push({ buffer: 1, byteOffset: addFallback(length), byteLength: length, ...(view.target ? { target: view.target } : {}),
    extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.length, byteStride: stride, count, mode } } });
  reencoded++;
}
const out = {
  ...json,
  asset: { ...json.asset, extras: { ...json.asset?.extras,
    preparedBy: 'scripts/prepare-bharat-mandapam.mjs', sourceSHA256: sourceHash,
    droppedDuplicateNodes: json.nodes.length - nodes.length,
    frame: { description: 'world X/Z metres, Y up, east +X, south +Z (explorer frame)', scale, rotationAboutYDeg: -theta * 180 / Math.PI, translationXZ: [tx, tz], residuals } } },
  scenes: json.scenes.map(scene => ({ ...scene, nodes: scene.nodes.filter(i => nodeMap.has(i)).map(i => nodeMap.get(i)) })),
  nodes, meshes, accessors: newAccessors, bufferViews,
  buffers: [{ byteLength: offset }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }],
};
const text = Buffer.from(JSON.stringify(out)), jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
text.copy(jsonChunk);
const binChunk = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(binChunk.length); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, binChunk]));
console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, sourceBytes: glb.size, nodes: nodes.length, sourceNodes: json.nodes.length,
  meshes: meshes.length, accessors: accessors.length, viewsCopied: copied, indexViewsReencoded: reencoded,
  frame: { scale: +scale.toFixed(6), rotationAboutYDeg: +(-theta * 180 / Math.PI).toFixed(4), translationXZ: [+tx.toFixed(3), +tz.toFixed(3)], residuals } }, null, 2));
