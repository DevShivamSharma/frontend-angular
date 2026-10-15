import * as T from 'three';

/** Rain around the camera, plus wet ground. The drop cloud is static geometry:
 * the vertex shader wraps each streak down through a box that follows the
 * camera, so a frame costs two uniform writes. Wet surfaces darken and polish
 * the ground materials in place and restore exactly when the rain stops.
 */
const DROPS = 9000;
const BOX = new T.Vector3(70, 45, 70);
const GROUND = /GROUND|road|asphalt|concrete|paving|sett|kerb|deck|forecourt|apron|lawn|grass|soil|earth/i;
const GROUND_CATEGORIES = new Set(['paved_ground', 'road', 'context_ground', 'road_marking']);
interface DryFinish { roughness: number; color: number; }

const vertexShader = `
attribute float aSeed;
uniform float time;
uniform vec3 origin;
uniform vec3 wind;
varying float vFade;
void main() {
  // aSeed carries the fall speed; +1000 marks the streak's trailing end.
  float tail = step(999.0, aSeed);
  float speed = aSeed - tail * 1000.0;
  float y = mod(position.y - speed * 24.0 * time, ${BOX.y.toFixed(1)});
  vec3 p = vec3(position.x + wind.x * (${BOX.y.toFixed(1)} - y) * 0.08, y, position.z + wind.z * (${BOX.y.toFixed(1)} - y) * 0.08);
  p -= tail * vec3(wind.x * 0.05, 0.55 * speed, wind.z * 0.05);
  vec4 view = modelViewMatrix * vec4(p + origin, 1.0);
  vFade = (1.0 - smoothstep(18.0, 36.0, length(view.xyz))) * smoothstep(0.0, 2.5, y);
  gl_Position = projectionMatrix * view;
}`;
const fragmentShader = `
uniform float opacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(0.80, 0.84, 0.92, opacity * vFade);
}`;

export function createVenueRain(scene: T.Scene, root: T.Group) {
  const positions = new Float32Array(DROPS * 6), seeds = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = (Math.random() - .5) * BOX.x, y = Math.random() * BOX.y, z = (Math.random() - .5) * BOX.z;
    const speed = .75 + Math.random() * .55;
    for (const end of [0, 1]) {
      const o = (i * 2 + end) * 3;
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
      seeds[i * 2 + end] = speed + end * 1000;
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 1));
  const uniforms = { time: { value: 0 }, origin: { value: new T.Vector3() }, wind: { value: new T.Vector3(1.1, 0, .5) }, opacity: { value: .4 } };
  const material = new T.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, fog: false });
  const streaks = new T.LineSegments(geometry, material);
  streaks.name = 'Rain'; streaks.frustumCulled = false; streaks.visible = false; streaks.renderOrder = 900;
  streaks.raycast = () => {};
  streaks.userData = { rain: true, excludeFromAmbientOcclusion: true, drops: DROPS };
  scene.add(streaks);
  let disposed = false;
  function wet(enabled: boolean) {
    root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof T.MeshStandardMaterial)) continue;
        if (!GROUND_CATEGORIES.has(material.userData['architecturalCategory']) && !GROUND.test(material.name)) continue;
        const dry: DryFinish = material.userData['dryFinish'] ??= { roughness: material.roughness, color: material.color.getHex() };
        if (enabled) { material.roughness = Math.min(dry.roughness, .36); material.color.setHex(dry.color).multiplyScalar(.7); }
        else { material.roughness = dry.roughness; material.color.setHex(dry.color); }
      }
    });
  }
  return {
    get active() { return streaks.visible; },
    setEnabled(enabled: boolean) {
      if (disposed) return;
      streaks.visible = enabled;
      wet(enabled);
    },
    /** Re-apply the wet finish after an appearance change restored the dry materials. */
    refreshMaterials() { if (!disposed && streaks.visible) wet(true); },
    /** Returns true while rain is falling, so the render loop keeps drawing. */
    update(now: number, camera: T.Camera): boolean {
      if (disposed || !streaks.visible) return false;
      uniforms.time.value = now / 1000;
      uniforms.origin.value.set(camera.position.x - BOX.x / 2, camera.position.y - BOX.y * .55, camera.position.z - BOX.z / 2);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (streaks.visible) wet(false);
      streaks.removeFromParent();
      geometry.dispose(); material.dispose();
    },
  };
}
