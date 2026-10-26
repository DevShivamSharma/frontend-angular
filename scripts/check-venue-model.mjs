import fs from 'node:fs';
import { readGlb, walk, pathName } from './venue-glb.mjs';

// Size, structure and name coverage of a venue GLB, read without WebGL: node/mesh/material counts, the memory the
// geometry takes once decoded (from accessor sizes; nothing is decoded here), an estimate of the draw calls after
// material batching, and how many nodes each name the explorer's code looks for would match.
// Usage: node scripts/check-venue-model.mjs <model.glb> [--patterns patterns.json] [--json out.json]
//   patterns.json: { "label": "<regex tested against a node's own name, then its ancestor path>" }
const [file, ...rest] = process.argv.slice(2);
const option = name => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
if (!file) { console.error('Usage: node scripts/check-venue-model.mjs <model.glb> [--patterns patterns.json] [--json out.json]'); process.exit(2); }

// Names the explorer code looks for today (see docs/venue-model-swap.md for where each is used).
const CODE_PATTERNS = {
  'PHOTO_* (any)': '^PHOTO_', 'HALL_* / PHOTO_HALL_*': '^(PHOTO_)?HALL_', 'ROOF_LABEL_*': '^ROOF_LABEL_', 'ARCH_*_SIGN': '^ARCH_',
  'PHOTO_GATE_*': '^PHOTO_GATE_', 'PHOTO_PATH_*': '^PHOTO_PATH_', 'PHOTO_CC*': '^PHOTO_CC', 'PHOTO_ITPO*': '^PHOTO_ITPO', 'PHOTO_ADMIN*': '^PHOTO_ADMIN',
  SITE_GROUND: '^SITE_GROUND', OUTER_GROUND: '^OUTER_GROUND$', CONTEXT_GROUND: '^CONTEXT_GROUND$', SUPREME_COURT_METRO_STN: '^SUPREME_COURT_METRO_STN$',
  CAM_TARGET: '^CAM_TARGET$', BOUNDARY_WALL: 'BOUNDARY_WALL', 'PHOTO_MUSICAL_FOUNTAIN*': '^PHOTO_MUSICAL_FOUNTAIN', 'lawn/turf/grass': 'lawn|turf|grass',
};
const patterns = Object.entries(option('--patterns') ? JSON.parse(fs.readFileSync(option('--patterns'), 'utf8')) : CODE_PATTERNS).map(([k, v]) => [k, new RegExp(v, 'i')]);

const glb = readGlb(file), { json } = glb, { parent, depth, reached } = walk(json);
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const accessorBytes = a => a.count * WIDTH[a.type] * COMPONENT_BYTES[a.componentType];
let triangles = 0, vertices = 0, geometryBytes = 0, primitives = 0, meshNodes = 0, skinned = 0, instancedNodes = 0;
const materialUsers = new Map(), seenAccessors = new Set();
const meshOfNode = [];
json.nodes.forEach((node, i) => {
  if (!reached.has(i) || node.mesh === undefined) return;
  meshNodes++; if (node.skin !== undefined) skinned++;
  if (node.extensions?.EXT_mesh_gpu_instancing) instancedNodes++;
  for (const p of json.meshes[node.mesh].primitives) {
    primitives++;
    const m = p.material ?? -1; materialUsers.set(m, (materialUsers.get(m) ?? 0) + 1);
    // Triangles and vertices are per instance (every node re-draws its mesh); bytes are per distinct accessor.
    if (p.attributes.POSITION !== undefined) vertices += json.accessors[p.attributes.POSITION].count;
    if (p.indices !== undefined && (p.mode ?? 4) === 4) triangles += json.accessors[p.indices].count / 3;
  }
  meshOfNode.push(node.mesh);
});
for (const mesh of new Set(meshOfNode)) for (const p of json.meshes[mesh].primitives)
  for (const index of [...Object.values(p.attributes), ...(p.indices !== undefined ? [p.indices] : [])]) if (!seenAccessors.has(index)) { seenAccessors.add(index); geometryBytes += accessorBytes(json.accessors[index]); }
const isBlend = m => json.materials?.[m]?.alphaMode === 'BLEND';
const opaqueMaterials = [...materialUsers.keys()].filter(m => !isBlend(m)), blendPrimitives = [...materialUsers].filter(([m]) => isBlend(m)).reduce((t, [, n]) => t + n, 0);
// Batching merges every opaque, non-skinned mesh of one material (further split by the classify/semantics key at run time),
// and leaves transparent meshes alone: material count + transparent primitives is the floor, primitives the ceiling.
const imageBytes = (json.images ?? []).reduce((t, im) => t + (im.bufferView !== undefined ? json.bufferViews[im.bufferView].byteLength : 0), 0);
let maxDepth = 0, deepNodes = 0;
for (const i of reached) { maxDepth = Math.max(maxDepth, depth[i]); }
const hitList = patterns.map(([label, re]) => {
  let own = 0, viaPath = 0, meshes = 0; const sample = [];
  json.nodes.forEach((node, i) => {
    if (!reached.has(i)) return;
    const byOwn = re.test(node.name ?? ''); const byPath = !byOwn && re.test(pathName(json, parent, i));
    if (byOwn) own++; else if (byPath) viaPath++; else return;
    if (node.mesh !== undefined) meshes++;
    if (sample.length < 3 && byOwn) sample.push(node.name);
  });
  const materials = (json.materials ?? []).filter(m => re.test(m.name ?? '')).length;
  return { pattern: label, nodesByOwnName: own, nodesViaAncestorOnly: viaPath, meshNodes: meshes, materialsByName: materials, sample };
});
const extras = new Map();
for (const n of json.nodes) for (const k of Object.keys(n.extras ?? {})) extras.set(k, (extras.get(k) ?? 0) + 1);
const matExtras = new Map();
for (const m of json.materials ?? []) for (const k of Object.keys(m.extras ?? {})) matExtras.set(k, (matExtras.get(k) ?? 0) + 1);
const mb = n => +(n / 1048576).toFixed(1);
const report = {
  model: file, fileMB: mb(glb.size), extensionsUsed: json.extensionsUsed ?? [], extensionsRequired: json.extensionsRequired ?? [], generator: json.asset?.generator,
  nodes: json.nodes.length, nodesReachableFromScene: reached.size, maxDepth, meshNodes, meshes: json.meshes.length, primitives, skinnedNodes: skinned, gpuInstancedNodes: instancedNodes,
  materials: json.materials?.length ?? 0, textures: json.textures?.length ?? 0, images: json.images?.length ?? 0, embeddedImageMB: mb(imageBytes),
  vertices, triangles: Math.round(triangles),
  decodedGeometryMB: mb(geometryBytes),
  drawCallsNow: { unbatched: primitives, afterMaterialBatch_floor: opaqueMaterials.length + blendPrimitives, opaqueMaterialsUsed: opaqueMaterials.length, transparentPrimitivesKept: blendPrimitives },
  memoryNote: 'decodedGeometryMB is the vertex+index data three.js holds after decoding; batching copies it once more (clone, merge), so peak is roughly 2-3x until the sources are released.',
  nodeExtrasKeys: Object.fromEntries([...extras].sort((a, b) => b[1] - a[1]).slice(0, 25)),
  materialExtrasKeys: Object.fromEntries(matExtras),
  namePatterns: hitList,
  topLevelSceneNodes: (json.scenes?.[json.scene ?? 0]?.nodes ?? []).length,
};
console.log(JSON.stringify(report, null, 2));
if (option('--json')) fs.writeFileSync(option('--json'), JSON.stringify(report, null, 2));
