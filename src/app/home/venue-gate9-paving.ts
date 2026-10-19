import * as T from 'three';

/** Use the approved plaza tiles on exterior paving in every loaded venue layer.
 * Runs after all entrance additions and the road finish, before batching and
 * appearance capture. World-space UVs keep separate floor pieces continuous.
 */
export function prepareGate9Paving(root: T.Group): void {
  if (root.userData['gate9PavingPrepared']) return;
  let paving: T.MeshStandardMaterial | undefined;
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m instanceof T.MeshStandardMaterial && m.userData['architecturalCategory'] === 'paved_ground')
        if (!paving || m.name === 'PM_Precinct limestone') paving = m;
  });
  if (!paving) return;
  root.updateMatrixWorld(true);
  const retiredGeometry = new Set<T.BufferGeometry>(), retiredMaterials = new Set<T.Material>();
  const retiredTextures = new Set<T.Texture>(), point = new T.Vector3();
  const overlays: T.Mesh[] = [];
  const coverage: Record<string, number> = {};
  const variants = new Map<T.Material, T.MeshStandardMaterial>();
  const pavingMaterials = new Set<T.Material>([paving]);
  const finishFor = (source: T.Material): T.MeshStandardMaterial => {
    if (!source.userData['siteDetail']) return paving!;
    let finish = variants.get(source);
    if (!finish) {
      finish = paving!.clone();
      // Keep the surroundings' boundary fade; only the floor finish changes.
      finish.userData = { ...source.userData, ...paving!.userData };
      variants.set(source, finish); pavingMaterials.add(finish);
    }
    return finish;
  };
  let count = 0;
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    const name = o.name.replaceAll('_', ' ');
    const ground = name.startsWith('SITE GROUND gate9 ');
    const oldLaneDetail = name.startsWith('G9 static 03 Interior lanes');
    const kioskBase = name === 'G9 planted earth bed kiosk';
    const oldSoilStrip = name === 'G9 static 05 Planting G9 planted earth';
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    // Old repairs and drawn concrete joints sit above complete floor surfaces.
    // Remove them instead of texturing thin raised strips over the tile joints.
    const obsoleteOverlay = (ground || oldLaneDetail) && materials.every(m =>
      /G9 (damp concrete patches|expansion joints|entrance hairline cracks|entrance old aggregate repair)$/.test(m.name));
    if (obsoleteOverlay || name === 'ITPO ARRIVAL paving joint') {
      overlays.push(o); retiredGeometry.add(o.geometry);
      materials.forEach(m => {
        retiredMaterials.add(m);
        for (const v of Object.values(m)) if (v instanceof T.Texture) retiredTextures.add(v);
      });
      return;
    }
    const next = oldSoilStrip ? [materials[0], paving!] : materials.map(m => {
      const surface = (ground || name === 'G9 checking room floor slab') &&
        /G9 (brushed warm concrete|entrance weathered cement)$/.test(m.name);
      // The road pass can have already assigned its asphalt variant to this
      // concrete lane. Match its source suffix as well as the original material.
      const kiosk = name === 'SITE GROUND gate9 kiosk fork' && m.name === 'G9 weathered asphalt';
      const venuePaving = m.userData['architecturalCategory'] === 'paved_ground' ||
        m.userData['architecturalCategory'] === 'road_footpath' ||
        /^(SITE(?:_ROAD)? warm concrete footpaths|SITE_ADMIN limestone paving|GATE_PATH pedestrian paving|PM_CC aerial limestone paving|ITPO arrival grey concrete)$/.test(m.name);
      if (!surface && !kiosk && !kioskBase && !venuePaving) return m;
      coverage[m.name] = (coverage[m.name] ?? 0) + 1;
      if (m === paving) return m;
      retiredMaterials.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) retiredTextures.add(v);
      return finishFor(m);
    });
    if (!oldSoilStrip && !next.some(m => pavingMaterials.has(m))) return;
    const source = o.geometry, geometry = source.clone(), positions = geometry.getAttribute('position');
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
      // Exactly the same campus alignment and 32 m atlas scale as the reference plaza.
      uv[i * 2] = (.5 * point.x - .8660254038 * point.z) / 32;
      uv[i * 2 + 1] = (.8660254038 * point.x + .5 * point.z) / 32;
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (oldSoilStrip) {
      // Superseded bare soil crosses the kiosk court above the newer floor.
      // Retile only its local triangles; other planted beds keep their soil.
      geometry.clearGroups();
      const index = geometry.index, length = index?.count ?? positions.count;
      let start = 0, previous = -1;
      for (let i = 0; i < length; i += 3) {
        let s = 0, t = 0;
        for (let k = 0; k < 3; k++) {
          const v = index ? index.getX(i + k) : i + k;
          s += uv[v * 2] * 32 / 3; t += uv[v * 2 + 1] * 32 / 3;
        }
        const a = (s + 542.692) * .447213596 + (t + 363.315) * .894427191;
        const d = (s + 542.692) * .894427191 - (t + 363.315) * .447213596;
        const material = a > -5 && a < 24 && d > 18 && d < 65 ? 1 : 0;
        if (material !== previous) {
          if (previous >= 0) geometry.addGroup(start, i - start, previous);
          start = i; previous = material;
        }
      }
      if (previous >= 0) geometry.addGroup(start, length - start, previous);
    }
    o.geometry = geometry; o.material = oldSoilStrip || Array.isArray(o.material) ? next : next[0];
    retiredGeometry.add(source); count++;
  });
  overlays.forEach(o => o.removeFromParent());
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    retiredGeometry.delete(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      retiredMaterials.delete(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) retiredTextures.delete(v);
    }
  });
  retiredGeometry.forEach(g => g.dispose()); retiredMaterials.forEach(m => m.dispose());
  retiredTextures.forEach(t => t.dispose());
  root.userData['gate9PavingPrepared'] = true;
  root.userData['gate9PavedSurfaces'] = count;
  root.userData['venuePavingCoverage'] = coverage;
  root.userData['retiredFloorOverlays'] = overlays.map(o => o.name);
}
