import * as T from 'three';

/** Low afternoon light stays visible above the venue's usual eye-level views. */
export const VENUE_SUN_DIRECTION = new T.Vector3(-.91, .14, -.37).normalize();
/** Where the sun is drawn in the sky: ahead of the opening camera, so tilting up finds it. The light itself still comes from VENUE_SUN_DIRECTION. */
export const VENUE_SKY_SUN_DIRECTION = new T.Vector3(-.11, .191, .976).normalize();
export const VENUE_MOON_DIRECTION = new T.Vector3(-.84, .13, -.51).normalize();

type SkyMode = 'day' | 'night' | 'space';
const WIDTH = 2048, HEIGHT = 1024;
const fullscreenVertex = `
varying vec2 skyUv;
void main() {
  skyUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

// Shared direction-space noise keeps the panorama seamless. Only the moon's
// small visible disc evaluates this noise during the otherwise cheap display.
const directionNoise = `
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                 mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                 mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float value = 0.0, weight = 0.533333;
  mat3 turn = mat3(0.00,0.80,0.60, -0.80,0.36,-0.48, -0.60,-0.48,0.64);
  for (int i = 0; i < 4; i++) {
    value += weight * noise3(p);
    p = turn * p * 2.03 + vec3(17.1, 9.2, 3.7);
    weight *= 0.5;
  }
  return value;
}`;

const bakeFragment = `
precision highp float;
varying vec2 skyUv;
uniform float skyMode;
uniform float overcast;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
const float PI = 3.141592653589793;
${directionNoise}
// Two differently scaled static layers: broad cumulus and restrained high haze.
// The low-elevation fade retains clouds in the narrow sky band above hall roofs.
// overcast (rain) lowers the cover thresholds until the cumulus closes into a
// grey rain sheet; the same noise keeps the panorama seamless.
vec3 cloudLayers(vec3 direction, vec3 lightDirection) {
  vec3 p = direction * (3.15 / (max(direction.y, 0.0) + 0.55));
  p += vec3(11.8, 2.1, -4.7);
  float broad = fbm(p);
  float detail = fbm(p * 2.85 + vec3(8.3, -5.7, 2.9));
  float field = broad * 0.77 + detail * 0.23;
  float density = smoothstep(0.43 - overcast * 0.34, 0.66 - overcast * 0.30, field);
  density = max(density, overcast * smoothstep(0.18, 0.46, broad));
  density *= smoothstep(0.005, 0.12, direction.y);
  float shadow = clamp((fbm(p + lightDirection * 0.52) - broad) * 3.5 + 0.34, 0.0, 1.0);
  float high = smoothstep(0.57, 0.77, fbm(direction * 13.0 + vec3(-7.0, 20.0, 3.0)));
  high *= smoothstep(0.015, 0.28, direction.y) * 0.25;
  return vec3(density, shadow, high);
}

vec3 stars(vec3 direction, float scale, float threshold) {
  vec3 p = direction * scale;
  vec3 cell = floor(p);
  float chance = hash31(cell + vec3(71.0, 9.0, 21.0));
  // Centers stay away from cell boundaries: the tiny star profile cannot make
  // hard edges at voxel borders and cannot create a panorama longitude seam.
  vec3 center = 0.25 + hash33(cell + 8.9) * 0.5;
  float radius = mix(0.105, 0.21, hash31(cell + 3.1));
  float point = 1.0 - smoothstep(radius * 0.13, radius, length(fract(p) - center));
  point *= step(threshold, chance);
  float brightness = mix(0.58, 1.0, hash31(cell + 17.8));
  vec3 tint = mix(vec3(0.77, 0.85, 1.0), vec3(1.0, 0.91, 0.76), hash31(cell + 2.3));
  return tint * point * brightness;
}

vec3 starBackground(vec3 direction) {
  float band = exp(-pow(dot(direction, normalize(vec3(0.3, 0.82, -0.48))), 2.0) * 55.0);
  float mist = fbm(direction * 7.0 + vec3(40.1, 4.7, 10.8));
  vec3 color = vec3(0.008, 0.013, 0.026);
  color += vec3(0.030, 0.035, 0.052) * band * mist;
  color += stars(direction, 155.0, 0.947);
  color += stars(direction, 83.0, 0.990) * 0.9;
  return color;
}

vec3 daySky(vec3 direction) {
  float altitude = max(direction.y, 0.0);
  float height = pow(altitude, 0.42);
  vec3 color = mix(vec3(0.72, 0.81, 0.86), vec3(0.20, 0.43, 0.67), height);
  color = mix(color, mix(vec3(0.60, 0.63, 0.66), vec3(0.42, 0.46, 0.51), height), overcast * 0.85);
  float sunAngle = acos(clamp(dot(direction, sunDirection), -1.0, 1.0));
  float haze = exp(-altitude * 12.0);
  color = mix(color, vec3(0.83, 0.84, 0.81), haze * 0.17);
  float sunlight = 1.0 - overcast * 0.92;
  color += vec3(0.12, 0.09, 0.045) * exp(-sunAngle * 4.0) * sunlight;
  color += vec3(0.28, 0.23, 0.15) * exp(-sunAngle * 33.0) * sunlight;
  vec3 cloud = cloudLayers(direction, sunDirection);
  vec3 cloudColor = mix(vec3(0.94, 0.94, 0.91), vec3(0.58, 0.66, 0.72), cloud.y * 0.72);
  cloudColor = mix(cloudColor, mix(vec3(0.52, 0.55, 0.59), vec3(0.33, 0.36, 0.40), cloud.y), overcast);
  cloudColor += vec3(0.075, 0.066, 0.048) * exp(-sunAngle * 9.0) * (1.0 - cloud.x) * sunlight;
  color = mix(color, cloudColor, cloud.x * 0.93);
  color = mix(color, mix(vec3(0.89, 0.91, 0.92), vec3(0.48, 0.51, 0.55), overcast), cloud.z);
  // A stylised sun, about four times the real disc, so it reads at screen size; a tight bloom
  // blends it into the sky instead of leaving a hard-edged coin. It is drawn over the clouds,
  // so a thin cloud softens it instead of hiding it.
  float sunClear = 1.0 - cloud.x * 0.25 - cloud.z * 0.1;
  // The halo stays well below white so the disc keeps its edge against it.
  color += vec3(0.38, 0.26, 0.10) * exp(-sunAngle * 48.0) * sunlight * sunClear;
  color += vec3(0.20, 0.13, 0.05) * exp(-sunAngle * 12.0) * sunlight * sunClear;
  float solarDisc = (1.0 - smoothstep(0.0165, 0.0195, sunAngle)) * (1.0 - overcast);
  vec3 sunColor = mix(vec3(1.0, 0.98, 0.82), vec3(1.0, 0.90, 0.58), smoothstep(0.006, 0.0185, sunAngle));
  color = mix(color, sunColor, solarDisc * sunClear);
  // Below-horizon haze avoids a black seam during elevated orbital views.
  color = mix(mix(vec3(0.64, 0.71, 0.74), vec3(0.50, 0.53, 0.56), overcast), color, smoothstep(-0.18, 0.015, direction.y));
  return color;
}

vec4 nightSky(vec3 direction) {
  float altitude = max(direction.y, 0.0);
  vec3 color = mix(vec3(0.082, 0.103, 0.145), vec3(0.015, 0.027, 0.054), pow(altitude, 0.43));
  float moonAngle = acos(clamp(dot(direction, moonDirection), -1.0, 1.0));
  vec3 cloud = cloudLayers(direction, moonDirection);
  float starVisibility = smoothstep(0.008, 0.13, direction.y) * (1.0 - cloud.x * 0.98);
  color += (starBackground(direction) - vec3(0.008, 0.013, 0.026)) * starVisibility;
  color += vec3(0.064, 0.071, 0.09) * exp(-moonAngle * 13.0);
  color += vec3(0.07, 0.075, 0.083) * exp(-moonAngle * moonAngle / 0.0006);
  // Keep the broad halo baked, but resolve the one-degree disc at native screen
  // pixels in the display pass. Alpha carries cloud transmittance for that disc.
  vec3 moonCloud = mix(vec3(0.145, 0.164, 0.20), vec3(0.082, 0.096, 0.132), cloud.y);
  moonCloud += vec3(0.045, 0.048, 0.057) * exp(-moonAngle * 6.0);
  color = mix(color, moonCloud, cloud.x * 0.68);
  color = mix(color, vec3(0.13, 0.15, 0.185), cloud.z * 0.52);
  color = mix(vec3(0.067, 0.082, 0.109), color, smoothstep(-0.16, 0.015, direction.y));
  float moonVisibility = (1.0 - cloud.x * 0.92) * (1.0 - cloud.z * 0.75) * (1.0 - overcast);
  return vec4(color, moonVisibility);
}

void main() {
  float longitude = (skyUv.x - 0.5) * 2.0 * PI;
  float latitude = (skyUv.y - 0.5) * PI;
  vec3 direction = vec3(cos(latitude) * cos(longitude), sin(latitude), cos(latitude) * sin(longitude));
  vec4 color = skyMode < 0.5 ? vec4(daySky(direction), 1.0)
    : (skyMode < 1.5 ? nightSky(direction) : vec4(starBackground(direction), 1.0));
  // Explicit sRGB-encoded bytes retain dark-sky precision in an RGBA8 target.
  // The texture has NoColorSpace: its explicit decode lives in the display pass.
  gl_FragColor = clamp(color, 0.0, 1.0);
}`;

const displayFragment = `
varying vec2 skyUv;
uniform sampler2D localSky;
uniform sampler2D spaceSky;
uniform float spaceMix;
uniform mat4 inverseProjection;
uniform mat3 cameraRotation;
uniform bool orthographic;
uniform bool daylight;
uniform vec3 moonDirection;
const float PI = 3.141592653589793;
${directionNoise}
vec3 fromSrgb(vec3 value) {
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), value));
}
void main() {
  vec4 view = inverseProjection * vec4(skyUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = orthographic ? vec3(0.0, 0.0, -1.0) : normalize(view.xyz / view.w);
  vec3 direction = normalize(cameraRotation * ray);
  vec2 uv = vec2(atan(direction.z, direction.x) / (2.0 * PI) + 0.5,
                 asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5);
  vec4 localSample = vec4(0.0);
  vec3 localColor = vec3(0.0);
  if (spaceMix < 1.0) {
    localSample = texture2D(localSky, uv);
    localColor = fromSrgb(localSample.rgb);
  }
  // A broad preliminary cone keeps noise work off all other background pixels.
  // Screen derivatives soften only the disc's edge, regardless of panorama/DPR.
  if (!daylight && spaceMix < 1.0 && dot(direction, moonDirection) > 0.99988) {
    vec3 right = normalize(cross(vec3(0,1,0), moonDirection));
    vec3 up = cross(moonDirection, right);
    vec2 face = vec2(dot(direction, right), dot(direction, up)) / 0.008726646;
    float radius = length(face);
    float edge = max(fwidth(radius) * 0.6, 0.002);
    float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, radius);
    if (disc > 0.0) {
      vec3 sphere = vec3(face, sqrt(max(0.0, 1.0 - dot(face, face))));
      float maria = fbm(sphere * 4.9 + vec3(6.8, -2.1, 11.9));
      float craters = noise3(sphere * 28.0 + 5.6);
      float light = 0.66 + 0.34 * max(0.0, dot(sphere, normalize(vec3(-0.35, 0.23, 0.91))));
      float surface = mix(0.68, 0.97, smoothstep(0.31, 0.70, maria)) + (craters - 0.5) * 0.045;
      vec3 moonColor = fromSrgb(vec3(0.94, 0.945, 0.91) * surface * light);
      localColor = mix(localColor, moonColor, disc * localSample.a);
    }
  }
  vec3 color = localColor;
  // Only flights need both panoramas. Local and orbital views sample one.
  if (spaceMix > 0.0) color = mix(color, fromSrgb(texture2D(spaceSky, uv).rgb), spaceMix);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

/** A camera-rotation-only background. Baking is lazy and static: no clock,
 * requestAnimationFrame or render invalidation is owned by the sky. Call rebuild
 * after WebGL context restoration because render-target pixels are GPU-owned.
 */
export function createVenueSky(renderer: T.WebGLRenderer) {
  // One baked panorama per mode, and an overcast variant of day/night for rain.
  const targets = new Map<string, T.WebGLRenderTarget>();
  const quad = new T.PlaneGeometry(2, 2);
  const bakeMaterial = new T.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: bakeFragment,
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { skyMode: { value: 0 }, overcast: { value: 0 }, sunDirection: { value: VENUE_SKY_SUN_DIRECTION.clone() },
      moonDirection: { value: VENUE_MOON_DIRECTION.clone() } } });
  const bakeScene = new T.Scene(), bakeCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeMesh = new T.Mesh(quad, bakeMaterial); bakeMesh.frustumCulled = false; bakeScene.add(bakeMesh);
  // Camera matrices exist before the first render, including a renderer first
  // used during scene construction. The shader itself emits clip-space vertices.
  bakeCamera.updateProjectionMatrix(); bakeCamera.updateMatrixWorld(true);
  const uniforms = { localSky: { value: null as T.Texture | null }, spaceSky: { value: null as T.Texture | null },
    spaceMix: { value: 0 }, inverseProjection: { value: new T.Matrix4() },
    cameraRotation: { value: new T.Matrix3() }, orthographic: { value: false },
    daylight: { value: true }, moonDirection: { value: VENUE_MOON_DIRECTION.clone() } };
  const material = new T.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: displayFragment,
    uniforms, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const mesh = new T.Mesh(quad, material); mesh.name = 'Venue sky';
  mesh.renderOrder = -10000; mesh.frustumCulled = false; mesh.raycast = () => {};
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData = { venueSky: true, excludeFromAmbientOcclusion: true, bakeResolution: [WIDTH, HEIGHT],
    daylight: true, spaceMix: 0, bakedTextures: 0 };
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraRotation.value.setFromMatrix4(camera.matrixWorld);
    uniforms.orthographic.value = (camera as T.OrthographicCamera).isOrthographicCamera === true;
  };
  let daylight = true, disposed = false, raining = false;

  function texture(mode: SkyMode): T.Texture {
    const overcast = raining && mode !== 'space';
    const key = overcast ? `${mode}-overcast` : mode;
    const existing = targets.get(key); if (existing) return existing.texture;
    const target = new T.WebGLRenderTarget(WIDTH, HEIGHT, { format: T.RGBAFormat, type: T.UnsignedByteType,
      minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: false, colorSpace: T.NoColorSpace });
    target.texture.name = `Venue ${mode} sky`; target.texture.wrapS = T.RepeatWrapping;
    target.texture.wrapT = T.ClampToEdgeWrapping;
    const state = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(),
      clear: renderer.getClearColor(new T.Color()), alpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear, xr: renderer.xr.enabled,
      shadows: renderer.shadowMap.autoUpdate, shadowDirty: renderer.shadowMap.needsUpdate };
    try {
      renderer.xr.enabled = false; renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      bakeMaterial.uniforms['skyMode'].value = mode === 'day' ? 0 : mode === 'night' ? 1 : 2;
      bakeMaterial.uniforms['overcast'].value = overcast ? 1 : 0;
      // setRenderTarget installs this target's physical-pixel viewport/scissor.
      // setViewport would multiply by devicePixelRatio and crop a high-DPR bake.
      // Leave the renderer's logical viewport/scissor entirely untouched.
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.render(bakeScene, bakeCamera);
      targets.set(key, target); mesh.userData['bakedTextures'] = targets.size;
      return target.texture;
    } catch (error) {
      target.dispose(); throw error;
    } finally {
      renderer.setRenderTarget(state.target, state.face, state.mip);
      renderer.setClearColor(state.clear, state.alpha);
      renderer.autoClear = state.autoClear; renderer.xr.enabled = state.xr;
      renderer.shadowMap.autoUpdate = state.shadows; renderer.shadowMap.needsUpdate = state.shadowDirty;
    }
  }
  function refresh() {
    uniforms.localSky.value = texture(daylight ? 'day' : 'night');
    uniforms.spaceSky.value = uniforms.spaceMix.value > 0 ? texture('space') : uniforms.localSky.value;
  }
  // A failed initial bake does not leave orphaned CPU/GPU resources behind.
  try { refresh(); } catch (error) { dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true;
    mesh.onBeforeRender = () => {};
    uniforms.localSky.value = uniforms.spaceSky.value = null;
    targets.forEach(target => target.dispose()); targets.clear();
    material.dispose(); bakeMaterial.dispose(); quad.dispose(); bakeScene.clear();
    mesh.userData['bakedTextures'] = 0;
  }
  return {
    mesh,
    setDaylight(enabled: boolean): void {
      if (disposed) return;
      daylight = !!enabled; uniforms.daylight.value = daylight;
      mesh.userData['daylight'] = daylight; refresh();
    },
    /** Rain closes the cloud cover; the clear panoramas stay cached for the toggle back. */
    setRain(enabled: boolean): void {
      if (disposed || raining === !!enabled) return;
      raining = !!enabled; mesh.userData['raining'] = raining; refresh();
    },
    setSpaceMix(amount: number): void {
      if (disposed) return;
      const mix = T.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
      uniforms.spaceMix.value = mix; mesh.userData['spaceMix'] = mix;
      if (mix > 0) uniforms.spaceSky.value = texture('space');
    },
    rebuild(): void {
      if (disposed) return;
      targets.forEach(target => target.dispose()); targets.clear();
      mesh.userData['bakedTextures'] = 0; refresh();
    },
    dispose
  };
}
