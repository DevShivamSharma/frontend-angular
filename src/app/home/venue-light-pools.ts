import * as T from 'three';
import type { VenueLightSource } from './venue-light-sources';

/** One draw call keeps distant roads/paths lit in aerial views. Real nearby
 * lights still illuminate walls, people and the underside of the canopies.
 */
export function createVenueLightPools(sources: VenueLightSource[]) {
  const placed = sources.filter(s => s.ground);
  const geometry = new T.PlaneGeometry(2, 2); geometry.rotateX(-Math.PI / 2);
  // Sparse campus fixtures need wider, stronger pools than the dense Gate 9 cluster.
  geometry.setAttribute('poolStrength', new T.InstancedBufferAttribute(
    new Float32Array(placed.map(s => s.name.startsWith('Gate 9 ') ? .24 : .85)), 1));
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `attribute float poolStrength; varying float vPoolStrength; varying vec2 vPoolUv;
      void main() { vPoolUv = uv; vPoolStrength = poolStrength; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vPoolStrength; varying vec2 vPoolUv;
      void main() {
        float radius = length(vPoolUv * 2.0 - 1.0);
        float falloff = exp(-radius * radius * 4.5) * (1.0 - smoothstep(.65, 1.0, radius));
        gl_FragColor = vec4(vec3(1.0, .77, .43), falloff * vPoolStrength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new T.InstancedMesh(geometry, material, placed.length);
  mesh.name = 'Venue distant warm light pools'; mesh.renderOrder = 1;
  const matrix = new T.Matrix4(), rotation = new T.Quaternion(), scale = new T.Vector3();
  placed.forEach((source, i) => {
    const radius = (source.kind === 'bollard' ? 2.8 : source.kind === 'flood' ? 21 :
      source.kind === 'lamp' ? 13 : source.kind === 'entrance' ? 6 : 8) *
      (source.name.startsWith('Gate 9 ') ? 1 : 1.4);
    matrix.compose(new T.Vector3(...source.ground!), rotation, scale.set(radius, 1, radius)); mesh.setMatrixAt(i, matrix);
  });
  mesh.computeBoundingSphere();
  return { mesh, dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); } };
}
