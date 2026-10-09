import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';

export const source =
  process.argv[2] || 'C:/Users/Shivam Sharma/Downloads/bharat-mandapam-default.glb';
export const bytes = fs.readFileSync(source);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
  throw Error('Not a glTF 2 GLB');
export const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const binOffset = 28 + bytes.readUInt32LE(12);
export const bin = bytes.subarray(binOffset);
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const types = {
  5120: [1, 'getInt8'],
  5121: [1, 'getUint8'],
  5122: [2, 'getInt16'],
  5123: [2, 'getUint16'],
  5125: [4, 'getUint32'],
  5126: [4, 'getFloat32'],
};
export function accessor(index) {
  const a = json.accessors[index],
    v = json.bufferViews[a.bufferView],
    [size, method] = types[a.componentType],
    width = widths[a.type];
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (a.sparse) throw Error('Sparse accessor needs explicit handling');
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: width }, (_, c) =>
      view[method](
        (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || size * width) + c * size,
        true,
      ),
    ),
  );
}
export const world = [];
function matrices(index, parent = new T.Matrix4()) {
  const n = json.nodes[index],
    local = n.matrix
      ? new T.Matrix4().fromArray(n.matrix)
      : new T.Matrix4().compose(
          new T.Vector3().fromArray(n.translation || [0, 0, 0]),
          new T.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]),
          new T.Vector3().fromArray(n.scale || [1, 1, 1]),
        );
  world[index] = parent.clone().multiply(local);
  for (const child of n.children || []) matrices(child, world[index]);
}
for (const n of json.scenes[json.scene || 0].nodes) matrices(n);
export function parts(nodeIndex, primitiveIndex = 0) {
  const n = json.nodes[nodeIndex],
    p = json.meshes[n.mesh].primitives[primitiveIndex];
  const positions = accessor(p.attributes.POSITION),
    indices = p.indices === undefined ? positions.map((_, i) => i) : accessor(p.indices).flat();
  if (p.mode !== undefined && p.mode !== 4) return [];
  const parent = positions.map((_, i) => i),
    coords = new Map();
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function join(a, b) {
    parent[find(a)] = find(b);
  }
  positions.forEach((p, i) => {
    const key = p.map((x) => Math.round(x * 10000)).join(',');
    if (coords.has(key)) join(i, coords.get(key));
    else coords.set(key, i);
  });
  for (let t = 0; t < indices.length; t += 3) {
    join(indices[t], indices[t + 1]);
    join(indices[t], indices[t + 2]);
  }
  const groups = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(...indices.slice(t, t + 3));
  }
  return [...groups.values()].map((ids, index) => {
    const box = new T.Box3();
    for (const id of new Set(ids))
      box.expandByPoint(new T.Vector3().fromArray(positions[id]).applyMatrix4(world[nodeIndex]));
    return {
      index,
      indices: ids,
      bounds: [box.min.toArray(), box.max.toArray()],
      size: box.getSize(new T.Vector3()).toArray(),
      center: box.getCenter(new T.Vector3()).toArray(),
      triangles: ids.length / 3,
    };
  });
}
export const inventory = {
  source: source.split(/[\\/]/).pop(),
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  asset: json.asset,
  counts: {
    nodes: json.nodes.length,
    meshes: json.meshes.length,
    materials: json.materials.length,
    textures: json.textures?.length || 0,
    images: json.images?.length || 0,
    cameras: json.cameras?.length || 0,
    animations: json.animations?.length || 0,
    lights: json.extensions?.KHR_lights_punctual?.lights?.length || 0,
  },
  extensionsUsed: json.extensionsUsed,
  extensionsRequired: json.extensionsRequired,
  lights: json.extensions?.KHR_lights_punctual?.lights,
  materials: json.materials,
  textures: json.textures,
  images: json.images,
  nodes: [],
};
for (let i = 0; i < json.nodes.length; i++) {
  const n = json.nodes[i],
    record = { index: i, ...n, worldMatrix: world[i]?.toArray() };
  if (n.mesh !== undefined)
    record.primitives = json.meshes[n.mesh].primitives.map((p, pi) => ({
      material: p.material,
      materialName: json.materials[p.material]?.name,
      attributes: p.attributes,
      mode: p.mode ?? 4,
      vertices: json.accessors[p.attributes.POSITION].count,
      triangles:
        p.mode === 0
          ? 0
          : (p.indices !== undefined
              ? json.accessors[p.indices].count
              : json.accessors[p.attributes.POSITION].count) / 3,
      components: parts(i, pi).map(({ indices, ...part }) => part),
    }));
  inventory.nodes.push(record);
}
fs.mkdirSync('docs/reference-interiors', { recursive: true });
fs.writeFileSync('docs/reference-interiors/inventory.json', JSON.stringify(inventory));
console.log(JSON.stringify({ counts: inventory.counts, sha256: inventory.sha256 }));
