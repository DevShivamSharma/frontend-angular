import * as T from 'three';

/** Reuse the approved Gate 9 asphalt on driving surfaces in every loaded layer.
 * Run after the site/entrance assets, before batching and appearance snapshots.
 * A separate UV channel leaves mixed-material markings and footpaths untouched.
 */
export function prepareVenueRoadFinish(root: T.Group): void {
  if (root.userData['gate9RoadFinishPrepared']) return;
  let asphalt: T.MeshStandardMaterial | undefined;
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material instanceof T.MeshStandardMaterial && material.name === 'G9 weathered asphalt' && material.map)
        asphalt = material;
  });
  // If the optional Gate 9 asset failed, retain the existing road finishes.
  if (!asphalt?.map) return;
  const finish = asphalt;
  finish.map!.channel = 1;
  finish.map!.wrapS = finish.map!.wrapT = T.RepeatWrapping;
  finish.map!.needsUpdate = true;
  finish.userData['architecturalCategory'] = 'road';
  finish.userData['gate9RoadFinish'] = true;
  root.updateMatrixWorld(true);
  const retiredGeometry = new Set<T.BufferGeometry>();
  const retiredMaterials = new Set<T.Material>();
  const retiredTextures = new Set<T.Texture>();
  const variants = new Map<T.Material, T.MeshStandardMaterial>();
  const coverage: Record<string, number> = {};
  const point = new T.Vector3();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const next = materials.map(material => {
      if (!(material instanceof T.MeshStandardMaterial)) return material;
      const road = material.userData['architecturalCategory'] === 'road' || /asphalt/i.test(material.name);
      // Gate 9's authored concrete driving lane (and the widened kiosk fork) is
      // distinct from its footpaths, walkway deck and parking deck.
      const gateLane = /^SITE_GROUND_gate9[ _](03[ _]Interior[ _]lanes|09[ _]Kiosk)/.test(object.name) &&
        material.name === 'G9 brushed warm concrete';
      // Concrete joints/damp overlays otherwise become pale scars on asphalt.
      const concreteDetail = /^G9_static_03_Interior_lanes/.test(object.name) &&
        /^(G9 damp concrete patches|G9 expansion joints)$/.test(material.name);
      if (!road && !gateLane && !concreteDetail) return material;
      coverage[material.name] = (coverage[material.name] ?? 0) + 1;
      if (material !== finish) {
        retiredMaterials.add(material);
        for (const value of Object.values(material)) if (value instanceof T.Texture) retiredTextures.add(value);
      }
      if (material === finish) return finish;
      let variant = variants.get(material);
      if (!variant) {
        variant = finish.clone();
        // Preserve the surroundings' road-end fade and other layer metadata.
        // Unique names also keep the optional Color palette from replacing it.
        variant.name = 'G9 shared asphalt / ' + material.name;
        variant.userData = { ...finish.userData, ...material.userData,
          architecturalCategory: 'road', gate9RoadFinish: true };
        variants.set(material, variant);
      }
      return variant;
    });
    if (!next.some(material => material.userData['gate9RoadFinish'])) return;
    const source = object.geometry;
    const geometry = source.clone();
    const positions = geometry.getAttribute('position');
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      // Exact four-metre world mapping from the Gate 9 Blender material.
      uv[i * 2] = point.x / 4;
      uv[i * 2 + 1] = -point.z / 4;
    }
    geometry.setAttribute('uv1', new T.BufferAttribute(uv, 2));
    object.geometry = geometry;
    object.material = Array.isArray(object.material) ? next : next[0];
    retiredGeometry.add(source);
  });
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    retiredGeometry.delete(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      retiredMaterials.delete(material);
      for (const value of Object.values(material)) if (value instanceof T.Texture) retiredTextures.delete(value);
    }
  });
  retiredGeometry.forEach(geometry => geometry.dispose());
  retiredMaterials.forEach(material => material.dispose());
  retiredTextures.forEach(texture => texture.dispose());
  root.userData['gate9RoadFinishPrepared'] = true;
  root.userData['gate9RoadFinishCoverage'] = coverage;
}
