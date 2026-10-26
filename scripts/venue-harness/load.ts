import * as fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Parse a GLB the way the viewer does (GLTFLoader + MeshoptDecoder). Images are dropped: Node has no image decoder. */
export async function loadVenueGlb(file: string): Promise<T.Group> {
  const bytes = fs.readFileSync(file), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  if (json.images?.length) {
    delete json.images; delete json.textures; delete json.samplers;
    for (const m of json.materials ?? []) for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k];
    for (const m of json.materials ?? []) if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (/Texture$/.test(k)) delete m.pbrMetallicRoughness[k];
  }
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const rest = bytes.subarray(20 + jsonLength), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + rest.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([header, padded, rest]);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return gltf.scene;
}
export function heapMB(): number { global.gc?.(); return Math.round(process.memoryUsage().heapUsed / 1048576 + process.memoryUsage().arrayBuffers / 1048576); }
