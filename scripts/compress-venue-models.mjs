import fs from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';

// Offline, lossless: every vertex and index buffer of a GLB is stored with EXT_meshopt_compression (no quantization
// or filters, so three.js decodes the same float attributes and indices the model was exported with). Node names,
// extras, materials and embedded images are kept as they are. Gate 9 ships the same encoding from Blender.
// Usage: node scripts/compress-venue-models.mjs [<source.glb> <output.glb> [--bits N]]
// With no paths it writes the explorer's IITF_2026_ARCHITECTURAL.meshopt.glb (gitignored) when the source is newer;
// `npm start` and `npm run build` run it so the copy always follows the exported model.
const [sourceArg, outputArg, flag, bitsArg] = process.argv.slice(2);
const source = sourceArg ?? 'src/assets/venue/IITF_2026_ARCHITECTURAL.glb';
const output = outputArg ?? 'src/assets/venue/IITF_2026_ARCHITECTURAL.meshopt.glb';
const BITS = flag === '--bits' ? Number(bitsArg) : 0;
if (flag && !(BITS >= 8 && BITS <= 24)) throw new Error('--bits takes 8 to 24 mantissa bits.');
if (!sourceArg && fs.existsSync(output) && fs.statSync(output).mtimeMs >= Math.max(fs.statSync(source).mtimeMs, fs.statSync(new URL(import.meta.url)).mtimeMs)) {
  console.log(JSON.stringify({ output, upToDate: true })); process.exit(0);
}
const bytes = fs.readFileSync(source), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
await MeshoptEncoder.ready;
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
// A buffer view is encoded only when exactly one plain accessor reads all of it.
const readers = new Map();
json.accessors.forEach((accessor, index) => { if (accessor.bufferView !== undefined) readers.set(accessor.bufferView, [...(readers.get(accessor.bufferView) ?? []), index]); });
const triangleIndices = new Set(json.meshes.flatMap(mesh => mesh.primitives.filter(p => (p.mode ?? 4) === 4 && p.indices !== undefined).map(p => p.indices)));
const indexAccessors = new Set(json.meshes.flatMap(mesh => mesh.primitives.map(p => p.indices).filter(i => i !== undefined)));
const chunks = [], fallbackViews = [];
let offset = 0, encodedViews = 0;
const append = buffer => { const start = offset, padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4); Buffer.from(buffer).copy(padded); chunks.push(padded); offset += padded.length; return start; };
json.bufferViews.forEach((view, viewIndex) => {
  const data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), users = readers.get(viewIndex) ?? [];
  const accessor = users.length === 1 ? json.accessors[users[0]] : undefined;
  const size = accessor && SIZES[accessor.type] * COMPONENT[accessor.componentType];
  const plain = accessor && !accessor.sparse && !(accessor.byteOffset) && size && accessor.count * size === view.byteLength && (!view.byteStride || view.byteStride === size);
  const isIndex = plain && indexAccessors.has(users[0]);
  const mode = !plain ? undefined : isIndex ? (triangleIndices.has(users[0]) && accessor.count % 3 === 0 ? 'TRIANGLES' : 'INDICES') : 'ATTRIBUTES';
  // Attribute strides must be a multiple of 4; index strides 2 or 4.
  if (!mode || (mode === 'ATTRIBUTES' ? size % 4 !== 0 || size > 256 : size !== 2 && size !== 4)) {
    view.buffer = 0; view.byteOffset = append(data); return;
  }
  // With --bits, float attributes keep that many mantissa bits (the exponential filter; still float32 when decoded).
  const filter = BITS && mode === 'ATTRIBUTES' && accessor.componentType === 5126 ? 'EXPONENTIAL' : undefined;
  const input = filter ? MeshoptEncoder.encodeFilterExp(new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), accessor.count, size, BITS) : new Uint8Array(data);
  const encoded = MeshoptEncoder.encodeGltfBuffer(input, accessor.count, size, mode);
  view.extensions = { ...view.extensions, EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.length, byteStride: size, count: accessor.count, mode, ...(filter ? { filter } : {}) } };
  if (mode === 'ATTRIBUTES') view.byteStride = size;
  fallbackViews.push(view); encodedViews++;
});
// Encoded views point at an empty fallback buffer, as the extension requires; the data lives in the GLB chunk.
let fallbackOffset = 0;
for (const view of fallbackViews) { view.buffer = 1; view.byteOffset = fallbackOffset; fallbackOffset += Math.ceil(view.byteLength / 4) * 4; }
json.buffers = [{ byteLength: offset }, { byteLength: fallbackOffset, extensions: { EXT_meshopt_compression: { fallback: true } } }];
for (const key of ['extensionsUsed', 'extensionsRequired']) json[key] = [...new Set([...(json[key] ?? []), 'EXT_meshopt_compression'])];
json.asset.extras = { ...json.asset.extras, meshoptSource: source.replaceAll('\\', '/').split('/').at(-1), meshopt: 'lossless, scripts/compress-venue-models.mjs' };
const encoded = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
encoded.copy(jsonChunk);
const bin = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + bin.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, bin]));
console.log(JSON.stringify({ output, encodedViews, views: json.bufferViews.length, sourceBytes: bytes.length, bytes: fs.statSync(output).size }));
