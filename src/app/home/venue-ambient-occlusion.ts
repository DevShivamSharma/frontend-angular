import * as T from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

/** Fade contacts by their projected size, never by input activity. A whole-campus
 * view cannot resolve metre-scale creases and should not render the scene twice. */
export function venueAoStrength(distance: number, fov: number, viewportHeight: number): number {
  const pixels = 1.5 * viewportHeight / (2 * Math.tan(T.MathUtils.degToRad(fov / 2)) * Math.max(1, distance));
  return .45 * T.MathUtils.smoothstep(pixels, 3, 9);
}

/** A low-resolution AO multiplier over the sharp, antialiased scene. Its spatial
 * fade is identical during motion and at rest. Water changes shading, not depth,
 * so a stationary camera can reuse its exact contact mask. */
export function createVenueAmbientOcclusion(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.PerspectiveCamera
) {
  const pass = new SSAOPass(scene, camera, 1, 1, 16);
  pass.kernelRadius = 5;
  pass.renderToScreen = true;
  pass.output = SSAOPass.OUTPUT.Default;
  // Only the scalar AO mask is blurred/upscaled; the color image never is.
  // SSAOPass multiplies this mask into the existing screen without clearing it.
  pass.copyMaterial.uniforms['aoStrength'] = { value: .45 };
  pass.copyMaterial.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float aoStrength;
    varying vec2 vUv;
    void main() {
      float ao = texture2D(tDiffuse, vUv).r;
      gl_FragColor = vec4(vec3(mix(1.0, ao, aoStrength)), 1.0);
    }
  `;
  const drawingSize = new T.Vector2();
  const logicalSize = new T.Vector2();
  const previousCamera = new T.Matrix4(), previousProjection = new T.Matrix4();
  let dirty = true;

  function resize() {
    renderer.getDrawingBufferSize(drawingSize);
    renderer.getSize(logicalSize);
    // Half the width/height, with a bound for large/high-DPI displays.
    const scale = Math.min(.5, 1024 / Math.max(drawingSize.x, drawingSize.y));
    pass.setSize(Math.max(1, Math.round(drawingSize.x * scale)), Math.max(1, Math.round(drawingSize.y * scale)));
    dirty = true;
  }

  function render(distance: number) {
    const strength = venueAoStrength(distance, camera.fov, logicalSize.y);
    if (strength <= 0) return;
    pass.copyMaterial.uniforms['aoStrength'].value = strength;
    camera.updateMatrixWorld();
    if (!dirty && previousCamera.equals(camera.matrixWorld) && previousProjection.equals(camera.projectionMatrix)) {
      // r169 accepts null for its screen target; its declaration omits that case.
      pass.renderPass(renderer, pass.copyMaterial, null as unknown as T.WebGLRenderTarget);
      return;
    }
    const uniforms = pass.ssaoMaterial.uniforms;
    uniforms['cameraNear'].value = camera.near;
    uniforms['cameraFar'].value = camera.far;
    uniforms['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
    uniforms['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
    pass.minDistance = .25 / (camera.far - camera.near);
    pass.maxDistance = 8 / (camera.far - camera.near);
    // The pass writes directly to screen; composer input/output buffers are unused.
    pass.render(renderer, pass.ssaoRenderTarget, pass.ssaoRenderTarget, 0, false);
    previousCamera.copy(camera.matrixWorld); previousProjection.copy(camera.projectionMatrix);
    dirty = false;
  }

  resize();
  return { render, resize, invalidate() { dirty = true; }, dispose() {
    // The bundled r169 SSAOPass.dispose omits its sampling shader and noise texture.
    pass.ssaoMaterial.dispose();
    pass.noiseTexture.dispose();
    pass.dispose();
  } };
}
