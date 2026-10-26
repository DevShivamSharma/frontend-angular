import fs from 'node:fs';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Node-side GLB reading for the venue model checks. Needs no browser and no WebGL; only the JSON chunk and, for the
// exact-geometry helpers, the (meshopt-decoded) binary chunk are read. Accessor min/max give a world bounding box
// without decoding a single vertex buffer, which keeps a very large model cheap to inspect.

export function readGlb(path) {
  const fd = fs.openSync(path, 'r');
  try {
    const head = Buffer.alloc(20);
    fs.readSync(fd, head, 0, 20, 0);
    if (head.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
    const jsonLength = head.readUInt32LE(12), size = fs.fstatSync(fd).size;
    const jsonBytes = Buffer.alloc(jsonLength);
    fs.readSync(fd, jsonBytes, 0, jsonLength, 20);
    const json = JSON.parse(jsonBytes.toString('utf8'));
    const binOffset = 20 + jsonLength + 8;
    let bin;
    return {
      path, json, size, binOffset,
      /** The binary chunk, read on first use only (the checks that need geometry ask for it). */
      get bin() { return bin ??= (() => { const b = Buffer.alloc(size - binOffset); fs.readSync(fd, b, 0, b.length, binOffset); return b; })(); },
    };
  } finally { /* the descriptor is closed by process exit; bin is read lazily through a fresh open */ }
}

export function readGlbBin(glb) {
  const fd = fs.openSync(glb.path, 'r');
  try { const b = Buffer.alloc(glb.size - glb.binOffset); fs.readSync(fd, b, 0, b.length, glb.binOffset); return b; } finally { fs.closeSync(fd); }
}

const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1];
}

/** Parent index, path name and world matrix per node, for the default scene. Iterative: a 35k-node tree can be deep. */
export function walk(json) {
  const nodes = json.nodes, parent = new Array(nodes.length).fill(-1), world = new Array(nodes.length), depth = new Array(nodes.length).fill(0);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter(i => !nodes.some(n => n.children?.includes(i)));
  const stack = roots.map(i => [i, IDENTITY]);
  const reached = new Set();
  while (stack.length) {
    const [i, up] = stack.pop();
    if (reached.has(i)) continue;
    reached.add(i); world[i] = mul(up, localMatrix(nodes[i]));
    for (const c of nodes[i].children ?? []) { parent[c] = i; depth[c] = depth[i] + 1; stack.push([c, world[i]]); }
  }
  return { parent, world, depth, reached, roots };
}

export function pathName(json, parent, i, sep = ' ') {
  const names = [];
  for (let n = i; n >= 0; n = parent[n]) names.push(json.nodes[n].name ?? '');
  return names.join(sep);
}

/** Transform the 8 corners of an accessor's min/max box; returns [minX..., maxX...] or undefined. */
export function worldBox(json, node, matrix) {
  if (node.mesh === undefined) return undefined;
  let lo, hi;
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION];
    if (!accessor?.min || !accessor?.max) continue;
    for (let corner = 0; corner < 8; corner++) {
      const p = [corner & 1 ? accessor.max[0] : accessor.min[0], corner & 2 ? accessor.max[1] : accessor.min[1], corner & 4 ? accessor.max[2] : accessor.min[2]];
      const w = [0, 1, 2].map(r => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r]);
      lo = lo ? lo.map((v, k) => Math.min(v, w[k])) : w.slice(); hi = hi ? hi.map((v, k) => Math.max(v, w[k])) : w.slice();
    }
  }
  return lo && [...lo, ...hi];
}

export function unionBox(a, b) { return !a ? b : !b ? a : [0, 1, 2].map(k => Math.min(a[k], b[k])).concat([0, 1, 2].map(k => Math.max(a[3 + k], b[3 + k]))); }

/** Decode one meshopt-compressed buffer view into a plain Uint8Array (stride-interleaved elements, as stored). */
export async function decodeView(glb, bin, viewIndex) {
  const view = glb.json.bufferViews[viewIndex], ext = view.extensions?.EXT_meshopt_compression;
  if (!ext) return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  await MeshoptDecoder.ready;
  const out = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter ?? 'NONE');
  return out;
}
export { MeshoptDecoder };
