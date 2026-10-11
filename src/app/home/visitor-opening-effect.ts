import * as T from 'three';
import type { VisitorPortal } from './visitor-navigation';
import { visitorOpening } from './visitor-doorway';

/** Keep every doorway visible throughout a visit. A uniform toggles the effect;
 * approaching a gate never replaces clipping planes or recompiles a material. */
export function createVisitorOpeningEffect(surfaces: T.Mesh[], portals: VisitorPortal[]) {
  const openings = portals.map(visitorOpening), enabled = { value: 0 };
  const byMaterial = new Map<T.Material, Set<ReturnType<typeof visitorOpening>>>();
  for (const mesh of surfaces) {
    const bounds = new T.Box3().setFromObject(mesh);
    for (const opening of openings) if (bounds.intersectsBox(opening.bounds)) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!byMaterial.has(material)) byMaterial.set(material, new Set());
        byMaterial.get(material)!.add(opening);
      }
    }
  }
  const restore: (() => void)[] = [];
  for (const [material, selected] of byMaterial) {
    const originalCompile = material.onBeforeCompile, originalKey = material.customProgramCacheKey;
    const cacheKey = originalKey.call(material);
    const planes = [...selected].flatMap(o => o.planes.map(p => new T.Vector4(p.normal.x, p.normal.y, p.normal.z, p.constant)));
    material.onBeforeCompile = (shader, renderer) => {
      originalCompile.call(material, shader, renderer);
      shader.uniforms['visitorOpeningsEnabled'] = enabled;
      shader.uniforms['visitorOpeningPlanes'] = { value: planes };
      shader.vertexShader = `varying vec3 vVisitorWorldPosition;\n${shader.vertexShader}`.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 visitorWorldPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          visitorWorldPosition = batchingMatrix * visitorWorldPosition;
        #endif
        #ifdef USE_INSTANCING
          visitorWorldPosition = instanceMatrix * visitorWorldPosition;
        #endif
        vVisitorWorldPosition = (modelMatrix * visitorWorldPosition).xyz;
      `);
      shader.fragmentShader = `
        varying vec3 vVisitorWorldPosition;
        uniform float visitorOpeningsEnabled;
        uniform vec4 visitorOpeningPlanes[${planes.length}];
        ${shader.fragmentShader}
      `.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        if (visitorOpeningsEnabled > 0.5) {
          for (int opening = 0; opening < ${selected.size}; opening++) {
            bool insideOpening = true;
            for (int side = 0; side < 6; side++) {
              vec4 plane = visitorOpeningPlanes[opening * 6 + side];
              insideOpening = insideOpening && dot(vVisitorWorldPosition, plane.xyz) + plane.w <= 0.0;
            }
            if (insideOpening) discard;
          }
        }
      `);
    };
    material.customProgramCacheKey = () => `${cacheKey}:visitor-openings-v1:${selected.size}`;
    material.needsUpdate = true;
    restore.push(() => {
      material.onBeforeCompile = originalCompile; material.customProgramCacheKey = originalKey; material.needsUpdate = true;
    });
  }
  return {
    setEnabled(value: boolean) { enabled.value = Number(value); },
    cutsPoint(point: T.Vector3, object: T.Object3D) {
      if (!enabled.value || !(object instanceof T.Mesh)) return false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      return materials.some(m => [...(byMaterial.get(m) ?? [])].some(o => o.planes.every(p => p.distanceToPoint(point) <= 0)));
    },
    dispose() { enabled.value = 0; restore.forEach(fn => fn()); byMaterial.clear(); },
  };
}
