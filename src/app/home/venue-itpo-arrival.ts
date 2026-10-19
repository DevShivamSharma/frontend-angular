import * as T from 'three';

// Left wall entrance, in campus axes. The office building itself stays fixed.
export const ITPO_PORCH = { s: -438, t: -353.45, sourceS: -404.32, sourceT: -365.45 } as const;

/** Photo-guided additions in the source model's s/t axes (metres).
 * Run after optional site/Gate 9 layers, before collision extraction/batching.
 */
export function prepareItpoArrival(root: T.Group): void {
  if (root.getObjectByName('SITE_DETAIL_itpo_arrival')) return;
  const restore = new Set([
    'PHOTO_ADMIN office ground court', 'PHOTO_ADMIN office pedestrian apron',
    'PHOTO_ADMIN Office front planted island', 'PHOTO_ADMIN CC west tapered lawn',
    'PHOTO_ADMIN Office to CC separating drive', 'PHOTO_ADMIN Office to CC separating drive kerbs',
    'PHOTO_ADMIN CC rear pedestrian path',
  ].map(name => name.replaceAll('_', ' ')));
  root.updateMatrixWorld(true);
  // The surroundings loader hid every PHOTO_ADMIN node, including circulation
  // which its exterior-only asset never replaced. Restore these exact surfaces.
  root.traverse(object => {
    if (restore.has(object.name.replaceAll('_', ' '))) object.traverse(child => {
      child.visible = true; delete child.userData['supersededBySiteReference'];
    });
  });
  movePorchToLeftWall(root);
  clearArrivalJunctionKerbs(root);
  const group = new T.Group(); group.name = 'SITE_DETAIL_itpo_arrival';
  group.rotation.y = Math.PI / 3;
  group.userData['photoGuided'] = true; group.userData['dimensionsEstimated'] = true;
  const mat = (name: string, color: number, roughness = .85) =>
    new T.MeshStandardMaterial({ name: `ITPO arrival ${name}`, color, roughness });
  const stone = mat('honed beige limestone', 0xb7aa89), coping = mat('pale stone coping', 0xcac0a6);
  const concrete = mat('grey concrete', 0x81837b), soil = mat('planted soil', 0x3b4130);
  const leaves = [mat('deep green leaves', 0x264020), mat('olive leaves', 0x40592a), mat('new leaves', 0x536b31)];
  const bark = mat('tree bark', 0x675744), dark = mat('charcoal metal', 0x292f2b, .65);
  const yellow = mat('yellow kerb paint', 0xd3af32), louvre = mat('terracotta service louvres', 0x775248);
  const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + Math.sqrt(3) / 2 * t, y, -Math.sqrt(3) / 2 * s + .5 * t);
  // A local stone finish avoids stretching the source atlas into tall stripes
  // on the curved drum. Cylindrical UVs retain consistent stone courses.
  const stonePixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const joint = y % 32 === 0 || (x + (Math.floor(y / 32) % 2) * 32) % 64 === 0;
    const grain = ((x * 17 + y * 29) % 7) - 3;
    const index = (y * 128 + x) * 4;
    [184, 168, 135].forEach((v, channel) => stonePixels[index + channel] = v + grain - (joint ? 12 : 0));
    stonePixels[index + 3] = 255;
  }
  const stoneTexture = new T.DataTexture(stonePixels, 128, 128);
  stoneTexture.colorSpace = T.SRGBColorSpace; stoneTexture.wrapS = stoneTexture.wrapT = T.RepeatWrapping;
  stoneTexture.magFilter = T.LinearFilter; stoneTexture.minFilter = T.LinearMipmapLinearFilter;
  stoneTexture.generateMipmaps = true; stoneTexture.needsUpdate = true;
  const facade = mat('curved sandstone courses', 0xffffff); facade.map = stoneTexture;
  const ribbonGlass = mat('continuous ribbon glass', 0x34494c, .25);
  ribbonGlass.metalness = .25; ribbonGlass.side = T.DoubleSide;
  // The supplied drum has alternating triangle winding. Rendering both sides
  // prevents back-face culling from exposing the older shell behind its panels.
  facade.side = T.DoubleSide;
  const retired = new Set<T.BufferGeometry>(), retiredMaterials = new Set<T.Material>();
  const ribbonMaterials = new Map<T.Material, T.Material>();
  let facadeUsed = false;
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let names = object.name;
    for (let p = object.parent; p && p !== root; p = p.parent) names += ' ' + p.name;
    if (/PHOTO_CC[ _]ITPO[ _]side[ _]ribbon[ _]windows[ _]and[ _]joints/.test(names)) {
      const doubleSided = (source: T.Material) => {
        let copy = ribbonMaterials.get(source);
        if (!copy) { copy = source.clone(); copy.side = T.DoubleSide; ribbonMaterials.set(source, copy); }
        retiredMaterials.add(source); return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(doubleSided) : doubleSided(object.material);
    }
    if (!/PHOTO_CC[ _]ITPO[ _]side[ _]curved[ _]stone[ _]drum/.test(names)) return;
    const geometry = object.geometry.clone(), positions = geometry.attributes['position'];
    const uv = new Float32Array(positions.count * 2), point = new T.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const s = .5 * point.x - Math.sqrt(3) / 2 * point.z, t = Math.sqrt(3) / 2 * point.x + .5 * point.z;
      uv[i * 2] = Math.atan2(t + 264, s + 309) * 54 / 3;
      uv[i * 2 + 1] = point.y / 3;
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    // Correct winding rather than relying only on DoubleSide: mismatched
    // winding/normals also alternate the lighting of adjacent source panels.
    const index = geometry.index, indices: number[] = [];
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    const normal = new T.Vector3(), radial = new T.Vector3(), axis = new T.Vector3(0, 1, 0);
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
      a.fromBufferAttribute(positions, ids[0]).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(positions, ids[1]).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(positions, ids[2]).applyMatrix4(object.matrixWorld);
      normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
      radial.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(W(-284.315, -234.449, 0));
      radial.y = 0;
      if (Math.abs(normal.clone().normalize().dot(axis)) < .7 && normal.dot(radial) < 0)
        indices.push(ids[0], ids[2], ids[1]);
      else indices.push(...ids);
    }
    geometry.setIndex(indices); geometry.computeVertexNormals();
    retired.add(object.geometry); object.geometry = geometry;
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => retiredMaterials.add(m));
    const finish = (m: T.Material) => /glaz|glass/i.test(m.name) || m.userData['architecturalCategory'] === 'glazing' ? ribbonGlass : facade;
    object.material = Array.isArray(object.material) ? object.material.map(finish) : finish(object.material);
    facadeUsed = true;
  });
  root.traverse(o => { if (o instanceof T.Mesh) {
    retired.delete(o.geometry);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => retiredMaterials.delete(m));
  } });
  retired.forEach(g => g.dispose());
  retiredMaterials.forEach(m => m.dispose());
  if (!facadeUsed) { facade.dispose(); stoneTexture.dispose(); }
  const unit = new T.BoxGeometry(1, 1, 1), trunk = new T.CylinderGeometry(1, 1, 1, 7);
  const leaf = new T.IcosahedronGeometry(1, 1);
  leaf.setIndex(Array.from({ length: leaf.attributes['position'].count }, (_, i) => i));
  function mesh(name: string, geometry: T.BufferGeometry, material: T.Material,
    s: number, t: number, y: number, size: [number, number, number]) {
    const object = new T.Mesh(geometry, material); object.name = `ITPO_ARRIVAL_${name}`;
    object.position.set(s, y, t); object.scale.set(...size); group.add(object); return object;
  }
  const box = (name: string, material: T.Material, s: number, t: number, y: number,
    size: [number, number, number]) => mesh(name, unit, material, s, t, y, size);
  function segment(name: string, material: T.Material, a: T.Vector2, b: T.Vector2,
    width: number, height: number, y: number) {
    const object = box(name, material, (a.x + b.x) / 2, (a.y + b.y) / 2, y,
      [a.distanceTo(b), height, width]);
    object.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x); return object;
  }
  function hedge(points: [number, number][], width = 1.25, height = .85, base = .28) {
    for (let i = 1; i < points.length; i++) {
      const a = new T.Vector2(...points[i - 1]), b = new T.Vector2(...points[i]);
      segment('planting_bed', soil, a, b, width + .22, .08, base + .04);
      segment('clipped_hedge', leaves[0], a, b, width, height, base + height / 2);
      const count = Math.ceil(a.distanceTo(b) / .72);
      for (let j = 0; j <= count; j++) {
        const p = a.clone().lerp(b, j / count);
        mesh('hedge_leaf_crown', leaf, leaves[j % 3], p.x, p.y,
          base + height - .1, [.49, .22 + (j % 3) * .025, width * .54]);
      }
    }
  }
  function fig(s: number, t: number, index: number, base = .28) {
    const h = 4.4 + index % 3 * .4;
    mesh('fig_trunk', trunk, bark, s, t, base + h / 2, [.11, h, .11]);
    for (let tier = 0; tier < 4; tier++) for (let j = 0; j < 6; j++) {
      const angle = j * Math.PI / 3 + tier * .8 + index, radius = tier === 3 ? .3 : .65;
      const object = mesh('fig_broad_leaf', leaf, leaves[(j + tier) % 3],
        s + Math.cos(angle) * radius, t + Math.sin(angle) * radius,
        base + h - tier * .62, [.43, .67, .2]);
      object.rotation.set(.15, -angle, .25 * Math.sin(angle));
    }
  }
  function kerb(points: [number, number][], base = .24) {
    // Arc-length sampling retains the colour sequence through bends.
    const path = new T.CurvePath<T.Vector2>();
    for (let i = 1; i < points.length; i++) path.add(new T.LineCurve(
      new T.Vector2(...points[i - 1]), new T.Vector2(...points[i])));
    const count = Math.ceil(path.getLength() / .65);
    for (let i = 0; i < count; i++) segment('painted_kerb', i % 2 ? yellow : dark,
      path.getPoint(i / count), path.getPoint((i + 1) / count), .28, .24, base + .12);
  }
  // Leave a break in the near hedge for the relocated side entrance.
  hedge([[-481, -338], [-450, -338]], 1.5);
  hedge([[-425, -338], [-411, -338]], 1.5);
  hedge([[-481, -323], [-411, -323]], 1.5);
  for (let i = 0; i < 10; i++) fig(-477 + i * 7, -330, i);
  box('side_entrance_landing', concrete, ITPO_PORCH.s, -344.5, .15, [22, .3, 18]);
  // The photo corridor owns planting inside its footprint. The older tree row
  // would otherwise be recreated in the newly cleared office-side passage.
  let parallelPassages = false;
  root.traverse(o => { if (/18[ _]Photo[ _]parallel[ _]office[ _]passages/.test(o.name)) parallelPassages = true; });
  hedge([[-482, -385.5], [parallelPassages ? -478 : -410, -385.5]], 1.15);
  hedge([[-487, -402.2], [parallelPassages ? -478 : -454, -402.2]], 1.1);
  for (let i = 0; i < (parallelPassages ? 1 : 7); i++) fig(-480 + i * 10, -383.5, i);

  // Reverse photograph's enclosure, clear of the drive and cream shelters.
  box('service_wall', stone, -435, -407, 1.65, [10.5, 2.7, 3.1]);
  box('service_coping', coping, -435, -407, 3.08, [10.7, .16, 3.3]);
  for (const s of [-438, -432]) {
    box('service_recess', dark, s, -405.43, 1.54, [3.7, 1.45, .035]);
    for (let i = 0; i < 10; i++)
      box('service_louvre', louvre, s, -405.38, .9 + i * .14, [3.6, .075, .12]).rotation.x = -.2;
  }
  hedge([[-443, -403.8], [-427, -403.8]], 1.1);

  // Existing open parking podium's ITPO-facing edge. The columns, curved drum
  // and ribbon glazing stay in their original registered positions.
  hedge([[-390, -320], [-390, -297], [-388, -287]], 1.5);
  kerb([[-391.1, -321], [-391.1, -297], [-389.1, -286.8]]);
  for (let i = 0; i < 5; i++) fig(-386.5, -318 + i * 6, i);
  // The podium is curved, not its rectangular bounds. Find its actual north
  // edge with downward rays, then set plants back onto the supported surface.
  const podium: T.Mesh[] = [];
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (let p: T.Object3D | null = o; p && p !== root; p = p.parent)
      if (/PHOTO_CC[ _]elevated[ _]podium[ _]deck/.test(p.name)) { podium.push(o); break; }
  });
  const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  const podiumHeight = (s: number, t: number) => {
    ray.set(W(s, t, 15), down); return ray.intersectObjects(podium, false)[0]?.point.y;
  };
  const edge: { s: number; t: number; y: number }[] = [];
  for (let s = -354; s <= -296; s += 4) {
    for (let t = -341; t <= -285; t += .5) {
      if (podiumHeight(s, t) === undefined) continue;
      const y = podiumHeight(s, t + 2);
      if (y !== undefined) edge.push({ s, t: t + 2, y });
      break;
    }
  }
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1], b = edge[i];
    hedge([[a.s, a.t], [b.s, b.t]], 1.2, .8, Math.min(a.y, b.y) + .01);
    const treeY = podiumHeight(b.s, b.t + 1.1);
    if (i % 2 && treeY !== undefined) fig(b.s, b.t + 1.1, i, treeY + .01);
  }
  box('parking_approach_paving', concrete, -371, -329, .13, [18, .2, 8]);
  for (let i = 0; i < 9; i++) box('paving_joint', dark, -379 + i * 2, -329, .232, [.015, .004, 8]);
  root.add(group);
}

/** The source packs the canopy and piers into the office facade meshes. Find
 * disconnected solids using welded positions, then rotate only the projecting
 * porch parts. Selecting entire nodes would move the five-storey building too.
 * Preserve indices, materials, UVs and every non-porch vertex.
 */
function movePorchToLeftWall(root: T.Group): void {
  const retired = new Set<T.BufferGeometry>();
  const toCampus = new T.Matrix4().makeRotationY(-Math.PI / 3);
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let names = object.name;
    for (let p = object.parent; p && p !== root; p = p.parent) names += ' ' + p.name;
    if (!/PHOTO_ITPO[ _]office[ _](sandstone[ _]structure|entrance[ _]planting)/.test(names)) return;
    const source = object.geometry, positions = source.getAttribute('position'), index = source.index;
    const parents = Array.from({ length: positions.count }, (_, i) => i);
    const find = (i: number): number => {
      while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
      return i;
    };
    const join = (a: number, b: number) => { parents[find(a)] = find(b); };
    const welded = new Map<string, number>(), point = new T.Vector3();
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => v.toFixed(4)).join(',');
      const other = welded.get(key);
      if (other !== undefined) join(i, other); else welded.set(key, i);
    }
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const a = index ? index.getX(i) : i;
      join(a, index ? index.getX(i + 1) : i + 1); join(a, index ? index.getX(i + 2) : i + 2);
    }
    const matrix = toCampus.clone().multiply(object.matrixWorld), inverse = matrix.clone().invert();
    const bounds = new Map<number, T.Box3>();
    for (let i = 0; i < positions.count; i++) {
      const component = find(i);
      if (!bounds.has(component)) bounds.set(component, new T.Box3());
      bounds.get(component)!.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(matrix));
    }
    const selected = new Set([...bounds].filter(([, b]) =>
      b.min.x > -405.1 && b.max.x > -402.5 && b.max.y < 6.1).map(([id]) => id));
    if (!selected.size) return;
    const geometry = source.clone(), moved = geometry.getAttribute('position');
    for (let i = 0; i < moved.count; i++) {
      if (!selected.has(find(i))) continue;
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      const s = point.x, t = point.z;
      point.x = ITPO_PORCH.s - (t - ITPO_PORCH.sourceT);
      point.z = ITPO_PORCH.t + (s - ITPO_PORCH.sourceS);
      point.y += .3; // same rise as the landing, with column bases supported
      point.applyMatrix4(inverse); moved.setXYZ(i, point.x, point.y, point.z);
    }
    // Rotate existing normals/tangents with the selected solids, retaining the
    // authored shading on the rest of the facade.
    const rotation = inverse.clone().multiply(new T.Matrix4().makeRotationY(-Math.PI / 2)).multiply(matrix);
    for (const name of ['normal', 'tangent']) {
      const attribute = geometry.getAttribute(name);
      if (!attribute) continue;
      for (let i = 0; i < attribute.count; i++) if (selected.has(find(i))) {
        point.fromBufferAttribute(attribute, i).transformDirection(rotation);
        attribute.setXYZ(i, point.x, point.y, point.z);
      }
    }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    object.geometry = geometry; object.userData['porchRelocated'] = true; retired.add(source);
  });
  root.traverse(o => { if (o instanceof T.Mesh) retired.delete(o.geometry); });
  retired.forEach(g => g.dispose());
}

/** Two separately authored road layers meet here. Keep their driving surfaces,
 * but remove kerb triangles lying across the other road's actual top surface.
 * Work only at the office junctions; preserve every attribute on retained faces.
 */
function clearArrivalJunctionKerbs(root: T.Group): void {
  const oldRoads: T.Mesh[] = [], newRoads: T.Mesh[] = [], kerbs: { mesh: T.Mesh; newer: boolean }[] = [];
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    let name = o.name;
    for (let p = o.parent; p && p !== root; p = p.parent) name += ' ' + p.name;
    if (/PHOTO_ADMIN[ _]Office[ _]to[ _]CC[ _]separating[ _]drive/.test(name)) {
      if (/kerbs/.test(name)) kerbs.push({ mesh: o, newer: false }); else oldRoads.push(o);
    }
    if (/SITE_GROUND_gate9[ _]03[ _]Interior[ _]lanes/.test(name)) newRoads.push(o);
    if (/G9[ _]static[ _]03[ _]Interior[ _]lanes.*kerb[ _]paint/.test(name)) kerbs.push({ mesh: o, newer: true });
  });
  if (!oldRoads.length || !newRoads.length) return;
  const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0), center = new T.Vector3();
  const vertex = new T.Vector3(), retired = new Set<T.BufferGeometry>();
  for (const { mesh, newer } of kerbs) {
    const source = mesh.geometry, positions = source.attributes['position'], index = source.index;
    if (source.groups.length > 1 || Array.isArray(mesh.material)) continue;
    const indices: number[] = []; let removed = false;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const triangle = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
      center.set(0, 0, 0);
      triangle.forEach(k => center.add(vertex.fromBufferAttribute(positions, k).applyMatrix4(mesh.matrixWorld)));
      center.multiplyScalar(1 / 3);
      const s = .5 * center.x - Math.sqrt(3) / 2 * center.z;
      const t = Math.sqrt(3) / 2 * center.x + .5 * center.z;
      let overlaps = false;
      if (s > -507 && s < -355 && t > -375 && t < -310) {
        center.y = 1; ray.set(center, down);
        overlaps = ray.intersectObjects(newer ? oldRoads : newRoads, false).length > 0;
      }
      if (overlaps) removed = true; else indices.push(...triangle);
    }
    if (removed) {
      const geometry = source.clone(); geometry.setIndex(indices); geometry.clearGroups();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      mesh.geometry = geometry; retired.add(source);
    }
  }
  root.traverse(o => { if (o instanceof T.Mesh) retired.delete(o.geometry); });
  retired.forEach(g => g.dispose());
}
