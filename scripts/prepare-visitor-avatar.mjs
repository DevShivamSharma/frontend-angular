import fs from 'node:fs';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

// Offline preparation: preserve the supplied material, skeleton and skin weights.
// Usage: node scripts/prepare-visitor-avatar.mjs <original.glb>
const source = process.argv[2];
if (!source) throw new Error('Provide the original visitor GLB path.');
const bytes = fs.readFileSync(source), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const data = json.bufferViews.map(view => {
  const ext = view.extensions?.EXT_meshopt_compression;
  if (!ext) return Buffer.from(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  const decoded = Buffer.alloc(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride,
    binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
  return decoded;
});
const primitive = json.meshes[0].primitives[0];
const position = json.accessors[primitive.attributes.POSITION], index = json.accessors[primitive.indices];
if (position.componentType !== 5126 || index.componentType !== 5125)
  throw new Error('Expected float positions and uint32 indices in this supplied asset.');
const positions = data[position.bufferView], indices = data[index.bufferView];
const [simplified, error] = MeshoptSimplifier.simplify(
  new Uint32Array(indices.buffer, indices.byteOffset + (index.byteOffset ?? 0), index.count),
  new Float32Array(positions.buffer, positions.byteOffset + (position.byteOffset ?? 0), position.count * 3),
  3, 180000, .003, ['LockBorder']);
const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified);
for (const accessorIndex of Object.values(primitive.attributes)) {
  const accessor = json.accessors[accessorIndex], view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride, original = data[accessor.bufferView];
  const compact = Buffer.alloc(vertexCount * stride);
  for (let vertex = 0; vertex < remap.length; vertex++) {
    if (remap[vertex] === 0xffffffff) continue;
    original.copy(compact, remap[vertex] * stride, vertex * stride, (vertex + 1) * stride);
  }
  data[accessor.bufferView] = compact;
  accessor.count = vertexCount;
}
data[index.bufferView] = Buffer.from(simplified.buffer, simplified.byteOffset, simplified.byteLength);
index.count = simplified.length;
// Uncompressed compact buffers avoid downloading/decompressing the original 40 MB mesh.
let offset = 0;
const chunks = data.map((buffer, i) => {
  const view = json.bufferViews[i];
  view.buffer = 0; view.byteOffset = offset; view.byteLength = buffer.length;
  delete view.extensions;
  const padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4); buffer.copy(padded);
  offset += padded.length;
  return padded;
});
json.buffers = [{ byteLength: offset }];
for (const key of ['extensionsUsed', 'extensionsRequired'])
  json[key] = json[key].filter(name => name !== 'EXT_meshopt_compression');
json.asset.generator = 'Supplied Tripo rig; meshoptimizer reduced visitor mesh';
json.asset.extras = { source: source.replaceAll('\\', '/').split('/').at(-1),
  sourceTriangles: indices.length / 12, triangles: simplified.length / 3, simplificationError: error,
  animation: 'No source clips; application uses procedural skeletal motion.' };
const encoded = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
encoded.copy(jsonChunk);
const bin = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + bin.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
const output = 'src/assets/venue/characters/visitor.glb';
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, bin]));
console.log(JSON.stringify({ output, vertices: vertexCount, triangles: simplified.length / 3,
  relativeError: error, bytes: fs.statSync(output).size }));
