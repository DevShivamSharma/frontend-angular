import fs from 'node:fs';
import zlib from 'node:zlib';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Top-down plan of a venue GLB as a PNG, without WebGL: every visible triangle is rasterised in X/Z with its
// material colour, the highest surface wins, and a little slope shading shows edges. For locating and comparing
// parts of the earlier and the Bharat Mandapam models.
// Usage: node scripts/render-venue-plan.mjs <model.glb> <out.png> [x0 z0 x1 z1] [metres-per-pixel] [--match regex]
//   --match draws only nodes whose name (spaces for "_") matches; others are drawn faint.
const [file, out, ...rest] = process.argv.slice(2);
const flag = rest.indexOf('--match'), match = flag >= 0 ? new RegExp(rest[flag + 1], 'i') : undefined;
const nums = (flag >= 0 ? rest.slice(0, flag) : rest).map(Number);
const [x0, z0, x1, z1] = nums.length >= 4 ? nums : [-800, -520, 640, 440], step = nums[4] ?? 1;

export async function loadGlb(path) {
  const bytes = fs.readFileSync(path), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  // Node has no image decoder: drop textures, keep geometry and material factors.
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k];
    for (const k of Object.keys(m.pbrMetallicRoughness ?? {})) if (/Texture$/.test(k)) delete m.pbrMetallicRoughness[k];
  }
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const rest = bytes.subarray(20 + jsonLength), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + rest.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([header, padded, rest]);
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')).scene;
}

export function renderPlan(root, { x0, z0, x1, z1, step, match }) {
  const width = Math.ceil((x1 - x0) / step), height = Math.ceil((z1 - z0) / step);
  const depth = new Float32Array(width * height).fill(-Infinity), rgb = new Uint8Array(width * height * 3).fill(245);
  root.updateMatrixWorld(true);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), e = new T.Vector3(), col = new T.Color();
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    col.copy(material.color ?? new T.Color(0.6, 0.6, 0.6)).convertLinearToSRGB();
    let named = false;
    for (let p = o; p && !named; p = p.parent) named = !!match?.test(p.name.replace(/_/g, ' '));
    const faint = match && !named;
    const position = o.geometry.getAttribute('position'), index = o.geometry.index, count = index?.count ?? position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(position, index ? index.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(c, a));
      const len = n.length(); if (len < 1e-9) continue;
      const light = .55 + .45 * Math.abs(n.y / len);
      const ax = (a.x - x0) / step, az = (a.z - z0) / step, bx = (b.x - x0) / step, bz = (b.z - z0) / step, cx = (c.x - x0) / step, cz = (c.z - z0) / step;
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minZ = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxZ = Math.min(height - 1, Math.ceil(Math.max(az, bz, cz)));
      if (minX > maxX || minZ > maxZ) continue;
      const thin = Math.abs(det) < 1e-6;
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        let y;
        if (thin) { if (maxX - minX > 1 && maxZ - minZ > 1) continue; y = Math.max(a.y, b.y, c.y); }
        else {
          const px = x + .5, pz = z + .5, w1 = ((px - ax) * (cz - az) - (cx - ax) * (pz - az)) / det, w2 = ((bx - ax) * (pz - az) - (px - ax) * (bz - az)) / det;
          if (w1 < -.02 || w2 < -.02 || w1 + w2 > 1.02) continue;
          y = a.y + w1 * (b.y - a.y) + w2 * (c.y - a.y);
        }
        const k = z * width + x;
        if (faint) y -= 1000;
        if (y <= depth[k]) continue;
        depth[k] = y;
        const f = faint ? .25 : 1;
        rgb[k * 3] = 245 - (245 - col.r * 255 * light) * f; rgb[k * 3 + 1] = 245 - (245 - col.g * 255 * light) * f; rgb[k * 3 + 2] = 245 - (245 - col.b * 255 * light) * f;
      }
    }
  });
  // A 50 m grid with heavier lines every 250 m, so pixels read back as world X/Z.
  for (let gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) for (let z = 0; z < height; z++) { const k = z * width + Math.round((gx - x0) / step); if (k >= 0 && k < width * height) for (let i = 0; i < 3; i++) rgb[k * 3 + i] = gx % 250 ? rgb[k * 3 + i] * .85 : 60; }
  for (let gz = Math.ceil(z0 / 50) * 50; gz < z1; gz += 50) for (let x = 0; x < width; x++) { const k = Math.round((gz - z0) / step) * width + x; if (k >= 0 && k < width * height) for (let i = 0; i < 3; i++) rgb[k * 3 + i] = gz % 250 ? rgb[k * 3 + i] * .85 : 60; }
  return { width, height, rgb };
}

export function writePng(path, { width, height, rgb }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

if (/render-venue-plan\.mjs$/.test(process.argv[1] ?? "")) {
  const root = await loadGlb(file);
  const image = renderPlan(root, { x0, z0, x1, z1, step, match });
  writePng(out, image);
  console.log(JSON.stringify({ out, width: image.width, height: image.height, bounds: [x0, z0, x1, z1], metresPerPixel: step }));
}
