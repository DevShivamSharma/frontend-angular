import * as T from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

/** A low-resolution AO multiplier over the sharp, antialiased full-resolution scene.
 * Render it every camera frame: neither its resolution nor strength depends on motion.
 */
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

  function resize() {
    renderer.getDrawingBufferSize(drawingSize);
    // Half the width/height, with a bound for large/high-DPI displays.
    const scale = Math.min(.5, 1024 / Math.max(drawingSize.x, drawingSize.y));
    pass.setSize(Math.max(1, Math.round(drawingSize.x * scale)), Math.max(1, Math.round(drawingSize.y * scale)));
  }

  function render(distance: number) {
    // Contact shading has no useful scale in the planetary view. Fade with distance,
    // never with input state or time since the last interaction.
    const strength = .45 * (1 - T.MathUtils.smoothstep(distance, 3000, 5500));
    if (strength <= 0) return;
    pass.copyMaterial.uniforms['aoStrength'].value = strength;
    const uniforms = pass.ssaoMaterial.uniforms;
    uniforms['cameraNear'].value = camera.near;
    uniforms['cameraFar'].value = camera.far;
    uniforms['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
    uniforms['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
    pass.minDistance = .25 / (camera.far - camera.near);
    pass.maxDistance = 8 / (camera.far - camera.near);
    // The pass writes directly to screen; composer input/output buffers are unused.
    pass.render(renderer, pass.ssaoRenderTarget, pass.ssaoRenderTarget, 0, false);
  }

  resize();
  return { render, resize, dispose() {
    // The bundled r169 SSAOPass.dispose omits its sampling shader and noise texture.
    pass.ssaoMaterial.dispose();
    pass.noiseTexture.dispose();
    pass.dispose();
  } };
}
