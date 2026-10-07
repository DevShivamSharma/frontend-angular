import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSurfaceMaps as surfaceMaps } from './architectural-textures';

/** The same source envelope, with a separate, reversible material/detail layer. */
export function detailHall14(source: T.Group): T.Group {
  const result = source.clone(true);
  result.name = 'Hall 14 detailed study';
  const stone = surfaceMaps('stone'), metal = surfaceMaps('metal');
  result.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const material = object.material as T.MeshStandardMaterial;
    const name = material.name;
    const next = material.clone();
    object.material = next;
    if (/sign|label/i.test(object.name)) {
      if (/ARCH_H14/.test(object.name)) next.color.set('#554d3d');
      return;
    }
    if (/Cladding|fascia/.test(name)) {
      const variation = Number(/Cladding (\d)/.exec(name)?.[1] ?? 3);
      next.color.set('#bbb5a4').multiplyScalar(.94 + variation * .018);
      next.map = stone.color; next.bumpMap = stone.height; next.bumpScale = .035;
      next.roughnessMap = stone.roughness; next.roughness = .88; next.metalness = .08;
      object.geometry = object.geometry.clone();
      surfaceUV(object.geometry, false);
      if (/Cladding/.test(name)) {
        const p = object.geometry.getAttribute('position'), n = object.geometry.getAttribute('normal');
        const normal = new T.Vector3();
        for (let i = 0; i < p.count; i++) if (Math.abs(n.getY(i)) < .15) {
          normal.set(p.getX(i) / (43.55 ** 2), 0, p.getZ(i) / (47.75 ** 2)).normalize();
          n.setXYZ(i, normal.x, 0, normal.z);
        }
        n.needsUpdate = true;
      }
    } else if (/glass/i.test(name)) {
      next.color.set('#3b575c'); next.roughness = .095; next.metalness = .65;
      next.envMapIntensity = 1.8;
    } else if (/Roof/.test(name)) {
      next.color.set(/oxide/.test(name) ? '#626858' : '#4e5957');
      next.map = metal.color; next.bumpMap = metal.height; next.bumpScale = .055;
      next.roughnessMap = metal.roughness; next.roughness = .72; next.metalness = .62;
      object.geometry = object.geometry.clone(); surfaceUV(object.geometry, true);
    } else if (/steel/i.test(name)) {
      next.color.set('#949e9b'); next.metalness = .8; next.roughness = .31;
    }
  });

  result.add(createHall14EntranceDetail());
  return result;
}

/** The approved entrance study, shared by the isolated preview and live campus. */
export function createHall14EntranceDetail(): T.Group {
  const additions = new T.Group(); additions.name = 'HALL_14 entrance detail';
  additions.userData = { destinationId: 'hall14', hall: '14', detailAccents: true };
  const bronze = new T.MeshStandardMaterial({ color: '#74634d', metalness: .7, roughness: .34 });
  const frame = new T.MeshStandardMaterial({ color: '#293b3c', metalness: .72, roughness: .32 });
  const soffit = new T.MeshStandardMaterial({ color: '#d1c7b0', roughness: .7 });
  const glazing = new T.MeshStandardMaterial({ color: '#415e61', metalness: .48, roughness: .12 });
  const step = new T.MeshStandardMaterial({ color: '#aaa99e', roughness: .86 });
  const light = new T.MeshStandardMaterial({ color: '#ffecd0', emissive: '#ffc782', emissiveIntensity: .6 });
  const planting = new T.MeshStandardMaterial({ color: '#566b35', roughness: .94 });
  const darkPlanting = new T.MeshStandardMaterial({ color: '#364b27', roughness: .98 });
  const bins = new Map<T.Material, T.BufferGeometry[]>();
  const box = (mat: T.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const geometry = new T.BoxGeometry(w, h, d).translate(x, y, z);
    const list = bins.get(mat) ?? []; list.push(geometry); bins.set(mat, list);
  };
  // A restrained entrance study; these additions are illustrative, not surveyed.
  box(step, 0, .09, 53.3, 18, .18, 6);
  box(step, 0, .23, 52.2, 16, .10, 3.6);
  box(bronze, 0, 4.48, 53.1, 17, .22, 5.2);
  box(soffit, 0, 4.34, 53.1, 16.65, .08, 4.9);
  for (const x of [-7.55, 7.55]) box(bronze, x, 2.25, 54.85, .14, 4.35, .14);
  for (let x = -7.5; x <= 7.5; x += .42) box(bronze, x, 4.26, 53.1, .035, .07, 4.85);
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
    box(frame, x, 1.97, 51.23, .075, 3.45, .12);
    if (x < 5.2) {
      box(glazing, x + 1.3, 1.97, 51.2, 2.5, 3.37, .055);
      box(frame, x + 1.3, .32, 51.25, 2.6, .07, .1);
      box(frame, x + 1.3, 3.68, 51.25, 2.6, .08, .1);
      box(bronze, x + 1.18, 1.6, 51.38, .035, .72, .065);
      box(bronze, x + 1.42, 1.6, 51.38, .035, .72, .065);
    }
  }
  for (const x of [-5.8, -2.9, 0, 2.9, 5.8]) box(light, x, 4.27, 54.6, .8, .035, .09);
  // Jointed entrance paving and a narrow drain give the close-up a human scale.
  for (let x = -8.25; x <= 8.25; x += 1.5) box(frame, x, .184, 54.6, .014, .008, 3.4);
  for (let z = 53.2; z <= 56; z += .7) box(frame, 0, .184, z, 17.5, .008, .012);
  box(frame, 0, .285, 51.5, 13.8, .012, .16);
  for (let x = -6.8; x <= 6.8; x += .13) box(bronze, x, .294, 51.5, .026, .012, .14);
  for (const x of [-11.2, 11.2]) {
    box(step, x, .47, 53.1, 3.8, .86, 2.3);
    box(frame, x, .905, 53.1, 3.52, .035, 2.02);
    for (let i = 0; i < 28; i++) {
      const theta = i * 2.39996, radius = Math.sqrt(i / 28);
      const bush = new T.IcosahedronGeometry(.42 + (i % 3) * .075, 1);
      bush.scale(1.1, .78, .85).translate(x + Math.cos(theta) * radius * 1.35,
        1.05 + (1 - radius) * .5, 53.1 + Math.sin(theta) * radius * .7);
      const mat = i % 3 ? planting : darkPlanting;
      const list = bins.get(mat) ?? []; list.push(bush); bins.set(mat, list);
    }
  }
  // Fine coping around the existing oval; no change to its footprint or height.
  const rim = new T.TorusGeometry(1, .0015, 4, 192);
  rim.rotateX(Math.PI / 2); rim.scale(43.9, 25, 48.1); rim.translate(0, 25.14, 0);
  bins.set(bronze, [...(bins.get(bronze) ?? []), rim]);
  for (const [material, geometries] of bins) {
    // Primitive families have different index layouts; merge a common layout.
    const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(flat, false)!;
    flat.forEach((g, i) => { if (g !== geometries[i]) g.dispose(); });
    geometries.forEach(g => g.dispose());
    const mesh = new T.Mesh(merged, material);
    mesh.name = 'HALL_14 entrance and coping'; mesh.castShadow = mesh.receiveShadow = true;
    additions.add(mesh);
  }
  return additions;
}

function surfaceUV(geometry: T.BufferGeometry, roof: boolean): void {
  const positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    uv[i * 2] = roof ? x / 6 : Math.atan2(z / 47.75, x / 43.55) * 45.6 / 6;
    uv[i * 2 + 1] = roof ? z / 6 : y / 6.2;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
}
