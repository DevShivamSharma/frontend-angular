import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type WaterKind = 'pool' | 'spray' | 'spill';

/** The small Hall 6 basin has ten modeled nozzles but no exported water streams. */
export function prepareVenueFountainJets(root: T.Group) {
  root.updateMatrixWorld(true);
  const nozzles: T.Box3[] = [];
  const point = new T.Vector3(), center = new T.Vector3();
  root.traverse(object => {
    if (!(object instanceof T.Mesh) || Array.isArray(object.material) ||
        object.material.userData['architecturalCategory'] !== 'structure') return;
    let basin = false;
    for (let node: T.Object3D | null = object; node; node = node.parent)
      if (/Hall_?6.*triangular_basin|Hall 6.*triangular basin/i.test(node.name)) basin = true;
    if (!basin) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      let nozzle = nozzles.find(box => {
        box.getCenter(center);
        return Math.hypot(center.x - point.x, center.z - point.z) < .15;
      });
      if (!nozzle) { nozzle = new T.Box3(); nozzles.push(nozzle); }
      nozzle.expandByPoint(point);
    }
  });
  const inverseRoot = root.matrixWorld.clone().invert();
  const tubes = nozzles.flatMap(box => {
    const size = box.getSize(new T.Vector3());
    if (size.x > .12 || size.z > .12 || size.y > .5) return [];
    const start = box.getCenter(new T.Vector3()); start.y = box.max.y;
    const apex = start.clone().add(new T.Vector3(.06, 2.6, -.04));
    const landing = start.clone().add(new T.Vector3(.30, -.32, -.17));
    return [new T.TubeGeometry(new T.QuadraticBezierCurve3(start, apex, landing), 18, .027, 5, false)
      .applyMatrix4(inverseRoot)];
  });
  if (!tubes.length) return;
  const geometry = mergeGeometries(tubes, false);
  tubes.forEach(tube => tube.dispose());
  if (!geometry) return;
  const material = new T.MeshStandardMaterial({ color: 0xb4d5db, transparent: true });
  material.name = 'Hall 6 fountain streams';
  material.userData['architecturalCategory'] = 'water_spray';
  const jets = new T.Mesh(geometry, material);
  jets.name = 'Hall 6 basin water spray';
  root.add(jets);
}

/** Animate the authored water surfaces in place, including the thin cascade faces.
 * A shared clock and procedural shading add no textures, geometry or draw calls.
 */
export function createVenueWater(root: T.Group) {
  const time = { value: 0 };
  const surfaces = new Map<T.MeshStandardMaterial, WaterKind>();
  const meshes: T.Mesh[] = [];
  const frustum = new T.Frustum(), projection = new T.Matrix4();
  let lastTime: number | undefined;
  let disposed = false;

  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let water = false;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const category = material.userData['architecturalCategory'];
      if (category !== 'water' && category !== 'water_spray') continue;
      const falling = /spill|falling water/i.test(material.name + ' ' + object.name);
      surfaces.set(material, category === 'water_spray' ? (falling ? 'spill' : 'spray') : 'pool');
      water = true;
    }
    if (water) {
      object.castShadow = false;
      meshes.push(object);
    }
  });

  function refreshMaterials() {
    for (const [material, kind] of surfaces) {
      const spray = kind !== 'pool';
      material.roughness = spray ? .19 : .25;
      material.metalness = spray ? .02 : .18;
      // Keep pools opaque: the supplied model already contains the basin floor.
      material.transparent = spray;
      material.opacity = spray ? .88 : 1;
      material.depthWrite = !spray;
      material.onBeforeCompile = shader => {
        shader.uniforms['venueWaterTime'] = time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            varying vec3 vVenueWaterPosition;
            varying vec3 vVenueWaterNormal;`)
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vVenueWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vVenueWaterNormal = normalize(mat3(modelMatrix) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform float venueWaterTime;
            varying vec3 vVenueWaterPosition;
            varying vec3 vVenueWaterNormal;`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            vec2 waterP = vVenueWaterPosition.xz;
            float waterT = venueWaterTime;
            float waterA = dot(waterP, vec2(2.3, 1.7)) - waterT * 2.8;
            float waterB = dot(waterP, vec2(-3.1, 2.8)) - waterT * 2.1;
            float waterC = dot(waterP, vec2(.9, -1.5)) + waterT * 1.4;
            // Fade fine detail with pixel footprint to prevent distant shimmer.
            float waterDetail = 1.0 / (1.0 + 1.6 * length(fwidth(waterP)));
            vec2 waterSlope = (vec2(2.3, 1.7) * cos(waterA) * .025
              + vec2(-3.1, 2.8) * cos(waterB) * .012
              + vec2(.9, -1.5) * cos(waterC) * .025) * waterDetail;
            float waterHorizontal = smoothstep(.45, .85, abs(vVenueWaterNormal.y));
            normal = normalize(normal + mat3(viewMatrix)
              * vec3(-waterSlope.x, 0.0, -waterSlope.y) * waterHorizontal);
            float waterWave = (sin(waterA) + .5 * sin(waterB) + .65 * sin(waterC)) / 2.15;
            ${spray ? `
              // Moving turbulence runs along the existing jets and down the spillways.
              float waterTravel = vVenueWaterPosition.y * 5.5 ${kind === 'spill' ? '+' : '-'} waterT * 13.0;
              waterTravel += sin(dot(waterP, vec2(2.3, 1.7))) * 2.0;
              float waterPulse = .5 + .5 * sin(waterTravel);
              float waterBeads = smoothstep(.30, .94, waterPulse);
              diffuseColor.rgb = mix(diffuseColor.rgb * .68, vec3(.78, .9, .92), waterBeads * .65);
              diffuseColor.a *= .50 + .50 * waterBeads;
              roughnessFactor = .15 + .16 * (1.0 - waterBeads);
            ` : `
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.035, .16, .17), .20);
              diffuseColor.rgb *= 1.0 + waterWave * .17 * waterDetail * waterHorizontal;
              float waterCrest = pow(max(0.0, waterWave), 5.0) * waterDetail;
              diffuseColor.rgb += vec3(.035, .07, .075) * waterCrest * waterHorizontal;
              // Vertical faces carry bright, downward-moving rivulets.
              float waterFall = .5 + .5 * sin(vVenueWaterPosition.y * 8.0 + waterT * 10.0
                + sin(dot(waterP, vec2(5.0, 3.0))));
              float waterStrand = pow(.5 + .5 * sin(dot(waterP, vec2(7.0, 4.0))), 4.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.32, .48, .48),
                (1.0 - waterHorizontal) * (.3 + .45 * waterFall) * (.55 + .45 * waterStrand));
              roughnessFactor = .20 + .08 * (1.0 - waterWave);
            `}`);
      };
      material.customProgramCacheKey = () => `venue-flowing-water-v1-${kind}`;
      material.needsUpdate = true;
    }
  }

  refreshMaterials();
  return {
    refreshMaterials,
    /** Keep rendering only while water is in the local camera view. */
    update(now: number, camera: T.Camera, enabled: boolean) {
      if (disposed || !enabled) { lastTime = undefined; return false; }
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      const visible = meshes.some(mesh => {
        for (let node: T.Object3D | null = mesh; node; node = node.parent)
          if (!node.visible) return false;
        return frustum.intersectsObject(mesh);
      });
      if (!visible) { lastTime = undefined; return false; }
      // Cap resumed deltas: a hidden tab must not jump through minutes of animation.
      if (lastTime !== undefined) time.value += Math.min(.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      return true;
    },
    dispose() { disposed = true; surfaces.clear(); meshes.length = 0; }
  };
}
