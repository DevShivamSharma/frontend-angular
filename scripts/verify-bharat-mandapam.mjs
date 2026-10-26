import { readGlb, readGlbBin, decodeView } from './venue-glb.mjs';

// Lossless check for scripts/prepare-bharat-mandapam.mjs: every vertex accessor of the prepared model decodes to exactly
// the bytes of the same mesh/attribute in the supplied model, every index accessor to the same triangles in the same
// order and winding, every primitive keeps its material, and only the stacked copies are gone.
// Usage: node scripts/verify-bharat-mandapam.mjs <supplied.glb> <prepared.glb>
const [sourcePath, preparedPath] = process.argv.slice(2);
const source = readGlb(sourcePath), prepared = readGlb(preparedPath);
const sourceBin = readGlbBin(source), preparedBin = readGlbBin(prepared);
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const cache = new Map(), readerCounts = new Map();
const readers = glb => { if (!readerCounts.has(glb)) { const m = new Map(); for (const a of glb.json.accessors) m.set(a.bufferView, (m.get(a.bufferView) ?? 0) + 1); readerCounts.set(glb, m); } return readerCounts.get(glb); };
async function bytesOf(glb, bin, index) {
  const accessor = glb.json.accessors[index], key = glb.path + ':' + accessor.bufferView;
  // Shared (index) views are decoded once and kept; single-accessor views are decoded on demand.
  const view = cache.get(key) ?? await decodeView(glb, bin, accessor.bufferView);
  if (readers(glb).get(accessor.bufferView) > 1) cache.set(key, view);
  const stride = glb.json.bufferViews[accessor.bufferView].byteStride, element = SIZE[accessor.componentType] * WIDTH[accessor.type];
  const start = accessor.byteOffset ?? 0;
  if (!stride || stride === element) return view.subarray(start, start + accessor.count * element);
  // Padded vertex strides: compare the data, not the padding.
  const out = new Uint8Array(accessor.count * element);
  for (let i = 0; i < accessor.count; i++) out.set(view.subarray(start + i * stride, start + i * stride + element), i * element);
  return out;
}
// The meshopt index codec may start a triangle at another of its corners (same triangle, same winding).
function sameTriangles(u, v, componentType) {
  if (u.length !== v.length) return false;
  const A = componentType === 5125 ? new Uint32Array(u.buffer, u.byteOffset, u.length / 4) : new Uint16Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.length));
  const B = componentType === 5125 ? new Uint32Array(v.buffer, v.byteOffset, v.length / 4) : new Uint16Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.length));
  for (let t = 0; t < A.length; t += 3) {
    const [a0, a1, a2] = [A[t], A[t + 1], A[t + 2]], [b0, b1, b2] = [B[t], B[t + 1], B[t + 2]];
    if (!((a0 === b0 && a1 === b1 && a2 === b2) || (a0 === b1 && a1 === b2 && a2 === b0) || (a0 === b2 && a1 === b0 && a2 === b1))) return false;
  }
  return true;
}
const byName = new Map(source.json.nodes.map((node, i) => [node.name, i]));
let compared = 0, mismatched = 0, missing = 0;
const sourceNames = new Set(source.json.nodes.map(n => n.name)), preparedNames = new Set(prepared.json.nodes.map(n => n.name));
const dropped = [...sourceNames].filter(name => !preparedNames.has(name));
// Visit meshes in index order (accessors are mostly in that order), comparing each once.
const seen = new Set();
for (const node of prepared.json.nodes) {
  if (node.mesh === undefined || seen.has(node.mesh)) continue;
  seen.add(node.mesh);
  const original = source.json.nodes[byName.get(node.name)];
  if (!original) { missing++; continue; }
  const a = prepared.json.meshes[node.mesh].primitives, b = source.json.meshes[original.mesh].primitives;
  for (let p = 0; p < a.length; p++) {
    const pairs = [...Object.keys(a[p].attributes).map(k => [a[p].attributes[k], b[p].attributes[k]]), ...(a[p].indices !== undefined ? [[a[p].indices, b[p].indices]] : [])];
    for (const [x, y] of pairs) {
      const [u, v] = [await bytesOf(prepared, preparedBin, x), await bytesOf(source, sourceBin, y)];
      compared++;
      const isTriangles = x === a[p].indices && (a[p].mode ?? 4) === 4;
      if (!(isTriangles ? sameTriangles(u, v, prepared.json.accessors[x].componentType) : u.length === v.length && Buffer.compare(Buffer.from(u), Buffer.from(v)) === 0)) {
        mismatched++; if (process.env.DEBUG) console.error(node.name, x, y);
      }
    }
    if (a[p].material !== b[p].material) mismatched++;
  }
}
console.log(JSON.stringify({ comparedAccessors: compared, mismatched, nodesWithoutSource: missing,
  droppedNodeNames: dropped.length, droppedAllAreCascadeCopies: dropped.every(name => /^DWG (circulation|landscape) edges · cascade reference\.\d{3}$/.test(name)) }, null, 2));
if (mismatched || missing) process.exit(1);
