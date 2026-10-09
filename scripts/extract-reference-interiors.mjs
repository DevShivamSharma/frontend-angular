// Reproducible extraction: retain complete connected components, original attribute bytes,
// material definitions and embedded images. Welding is used ONLY for component discovery.
import fs from 'node:fs';
import * as T from 'three';
import { json, bin, parts, world, inventory } from './reference-glb.mjs';

const output = 'src/assets/venue/interiors';
fs.mkdirSync(output, { recursive: true });
const manifest = { version: 1, source: inventory.source, sha256: inventory.sha256, components: [] };
function writeAsset(name, selections, anchor) {
  const out = {
    asset: {
      version: '2.0',
      generator: 'Reference interior extractor',
      extras: { source: inventory.source, sha256: inventory.sha256 },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, children: [] }],
    meshes: [],
    materials: [],
    textures: [],
    images: [],
    samplers: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    extensionsUsed: [],
  };
  const chunks = [],
    materialMap = new Map(),
    textureMap = new Map(),
    imageMap = new Map();
  let length = 0,
    triangles = 0;
  const evidence = [];
  function buffer(data) {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    const id = out.bufferViews.length;
    out.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    chunks.push(data);
    length += data.length;
    return id;
  }
  function image(index) {
    if (imageMap.has(index)) return imageMap.get(index);
    const src = json.images[index];
    if (src.uri) throw Error('Expected embedded image');
    const v = json.bufferViews[src.bufferView];
    const id = out.images.length;
    imageMap.set(index, id);
    out.images.push({
      ...src,
      bufferView: buffer(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)),
    });
    return id;
  }
  function texture(index) {
    if (textureMap.has(index)) return textureMap.get(index);
    const src = json.textures[index],
      id = out.textures.length;
    textureMap.set(index, id);
    const dest = { ...src, source: image(src.source) };
    if (src.sampler !== undefined) {
      dest.sampler = out.samplers.length;
      out.samplers.push(json.samplers[src.sampler]);
    }
    out.textures.push(dest);
    return id;
  }
  function material(index) {
    if (materialMap.has(index)) return materialMap.get(index);
    const m = structuredClone(json.materials[index]),
      id = out.materials.length;
    materialMap.set(index, id);
    function visit(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k.endsWith('Texture') && v?.index !== undefined) v.index = texture(v.index);
        if (v && typeof v === 'object') visit(v);
      }
    }
    visit(m);
    out.materials.push(m);
    return id;
  }
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 },
    widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const { node, select } of selections) {
    const src = json.nodes[node];
    for (const [pi, p] of json.meshes[src.mesh].primitives.entries()) {
      const selected = parts(node, pi).filter(select);
      if (!selected.length) continue;
      const ids = selected.flatMap((c) => c.indices),
        unique = [...new Set(ids)],
        remap = new Map(unique.map((v, i) => [v, i])),
        attributes = {};
      for (const [semantic, index] of Object.entries(p.attributes)) {
        const a = json.accessors[index],
          v = json.bufferViews[a.bufferView],
          size = sizes[a.componentType] * widths[a.type],
          data = Buffer.alloc(unique.length * size);
        unique.forEach((id, i) => {
          const offset = (v.byteOffset || 0) + (a.byteOffset || 0) + id * (v.byteStride || size);
          bin.copy(data, i * size, offset, offset + size);
        });
        const dest = {
          componentType: a.componentType,
          count: unique.length,
          type: a.type,
          bufferView: buffer(data),
        };
        if (a.normalized) dest.normalized = true;
        if (semantic === 'POSITION') {
          dest.min = [Infinity, Infinity, Infinity];
          dest.max = [-Infinity, -Infinity, -Infinity];
          unique.forEach((_, i) => {
            for (let k = 0; k < 3; k++) {
              const x = data.readFloatLE(i * size + k * 4);
              dest.min[k] = Math.min(dest.min[k], x);
              dest.max[k] = Math.max(dest.max[k], x);
            }
          });
        }
        attributes[semantic] = out.accessors.length;
        out.accessors.push(dest);
      }
      const indexData = Buffer.alloc(ids.length * 4);
      ids.forEach((id, i) => indexData.writeUInt32LE(remap.get(id), i * 4));
      const indexId = out.accessors.length;
      out.accessors.push({
        componentType: 5125,
        count: ids.length,
        type: 'SCALAR',
        bufferView: buffer(indexData),
      });
      const mesh = out.meshes.length;
      out.meshes.push({
        name: src.name,
        primitives: [{ attributes, indices: indexId, material: material(p.material) }],
      });
      const matrix = new T.Matrix4()
        .makeTranslation(-anchor[0], -anchor[1], -anchor[2])
        .multiply(world[node]);
      out.nodes[0].children.push(out.nodes.length);
      out.nodes.push({
        name: src.name,
        mesh,
        matrix: matrix.toArray(),
        extras: { sourceNode: node, sourceComponents: selected.map((c) => c.index) },
      });
      triangles += ids.length / 3;
      evidence.push({
        node,
        name: src.name,
        components: selected.map((c) => c.index),
        triangles: ids.length / 3,
      });
    }
  }
  if (name === 'hall-point-light') {
    out.extensions = {
      KHR_lights_punctual: { lights: [json.extensions.KHR_lights_punctual.lights[5]] },
    };
    out.nodes[0].children.push(out.nodes.length);
    out.nodes.push({
      name: 'SourceHallPointLight',
      extensions: { KHR_lights_punctual: { light: 0 } },
      extras: { sourceNode: 226, sourceLight: 5 },
    });
  }
  const extensions = new Set();
  function scan(o) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'extensions') Object.keys(v).forEach((e) => extensions.add(e));
      scan(v);
    }
  }
  scan(out);
  out.extensionsUsed = [...extensions];
  const binary = Buffer.concat(chunks);
  out.buffers = [{ byteLength: binary.length }];
  const raw = Buffer.from(JSON.stringify(out)),
    jl = Math.ceil(raw.length / 4) * 4,
    bl = Math.ceil(binary.length / 4) * 4,
    glb = Buffer.alloc(28 + jl + bl);
  glb.writeUInt32LE(0x46546c67);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jl, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  glb.fill(32, 20, 20 + jl);
  raw.copy(glb, 20);
  glb.writeUInt32LE(bl, 20 + jl);
  glb.writeUInt32LE(0x004e4942, 24 + jl);
  binary.copy(glb, 28 + jl);
  fs.writeFileSync(`${output}/${name}.glb`, glb);
  manifest.components.push({
    name,
    file: `${name}.glb`,
    bytes: glb.length,
    triangles,
    anchor,
    evidence,
    textures: out.textures.length,
  });
}
const one = (i) => (c) => c.index === i;
const inside = (min, max) => (c) =>
  c.bounds[0].every((v, k) => v >= min[k] - 0.002) &&
  c.bounds[1].every((v, k) => v <= max[k] + 0.002);
writeAsset(
  'stand-island',
  [93, 108, 109, ...Array.from({ length: 16 }, (_, i) => 110 + i)].map((node) => ({
    node,
    select: inside([244.9, 0, -40.1], [251.1, 4, -0.9]),
  })),
  [248, 0.2, -20.5],
);
writeAsset(
  'reception-counter',
  [108, 109].map((node) => ({ node, select: one(0) })),
  [144, 0.195, -3],
);
writeAsset('ceiling-light', [{ node: 90, select: one(0) }], [64.5004787445, 9.44, 0.9833877236]);
writeAsset('steel-beam', [{ node: 97, select: one(7) }], [246, 14.4, 5]);
writeAsset('stone-column', [{ node: 60, select: one(0) }], [78.2800026, 0, -12]);
writeAsset('floor-deck', [{ node: 100, select: one(0) }], [195, 0, 5]);
writeAsset('ceiling-deck', [{ node: 105, select: one(0) }], [195, 15.75, 5]);
writeAsset('linear-light', [{ node: 106, select: one(0) }], [195, 15.1, -39]);
writeAsset('exit-sign', [{ node: 104, select: one(0) }], [235, 13, 5]);
writeAsset(
  'fire-door',
  [
    { node: 70, select: one(0) },
    { node: 71, select: one(0) },
    { node: 68, select: one(2) },
  ],
  [240, 0, -45],
);
writeAsset(
  'stage',
  [
    { node: 91, select: one(0) },
    { node: 92, select: one(0) },
    { node: 93, select: one(0) },
    { node: 94, select: one(0) },
  ],
  [0, 0, -41.5],
);
writeAsset(
  'plenary-seating',
  [
    { node: 95, select: () => true },
    { node: 99, select: () => true },
  ],
  [0, 0, -18],
);
writeAsset('hall-point-light', [], [195, 13, 5]);
fs.writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify(
    manifest.components.map(({ name, bytes, triangles, textures }) => ({
      name,
      bytes,
      triangles,
      textures,
    })),
  ),
);
