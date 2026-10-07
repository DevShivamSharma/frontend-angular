// Reproducible, lossless extraction of Hall 14 from the supplied campus model.
const fs = require('node:fs');
const source = fs.readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
const length = source.readUInt32LE(12);
const input = JSON.parse(source.subarray(20, 20 + length));
const binary = 28 + length;
const output = { asset: { version: '2.0', generator: 'Hall 14 lossless study extraction' }, scene: 0,
  scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
const maps = { meshes: new Map(), materials: new Map(), accessors: new Map(), bufferViews: new Map() };
const chunks = []; let offset = 0;
function copy(kind, index) {
  if (maps[kind].has(index)) return maps[kind].get(index);
  const destination = output[kind].length, item = structuredClone(input[kind][index]);
  maps[kind].set(index, destination); output[kind].push(item);
  if (kind === 'meshes') for (const p of item.primitives) {
    for (const key of Object.keys(p.attributes)) p.attributes[key] = copy('accessors', p.attributes[key]);
    if (p.indices !== undefined) p.indices = copy('accessors', p.indices);
    p.material = copy('materials', p.material);
  }
  if (kind === 'accessors') item.bufferView = copy('bufferViews', item.bufferView);
  if (kind === 'bufferViews') {
    const data = source.subarray(binary + (item.byteOffset || 0), binary + (item.byteOffset || 0) + item.byteLength);
    item.buffer = 0; item.byteOffset = offset;
    chunks.push(data); offset += data.length;
    const padding = (4 - offset % 4) % 4; chunks.push(Buffer.alloc(padding)); offset += padding;
  }
  return destination;
}
for (const index of input.scenes[input.scene || 0].nodes) {
  const node = input.nodes[index];
  if (!/^(PHOTO_HALL_14 |ARCH_H14_SIGN$|PHOTO_ROOF_SIGN_BOARD_H14$|ROOF_LABEL_H14$)/.test(node.name || '')) continue;
  if (node.children?.length) throw new Error('Extraction needs to preserve this new child hierarchy.');
  output.scenes[0].nodes.push(output.nodes.length);
  output.nodes.push({ ...node, mesh: copy('meshes', node.mesh) });
}
if (output.nodes.length !== 6) throw new Error('Unexpected source Hall 14 structure.');
output.buffers = [{ byteLength: offset }];
const json = Buffer.from(JSON.stringify(output)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
json.copy(padded);
const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + padded.length + offset, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync('src/assets/venue/hall14-study.glb', Buffer.concat([header, padded, binHeader, ...chunks]));
console.log(`Hall 14: ${output.nodes.length} source objects, ${offset} geometry bytes; campus asset unchanged.`);
