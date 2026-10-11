import { expect, test } from '@playwright/test';
import * as T from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createVenueAmbientOcclusion, venueAoStrength } from '../src/app/home/venue-ambient-occlusion';
import { createVenueWater } from '../src/app/home/venue-water';
import { visitorGeometry } from './visitor-fixture';

test('contact shading skips unresolved campus detail and reuses stationary depth until invalidated', () => {
  const camera = new T.PerspectiveCamera(40, 1.44, .1, 5000), scene = new T.Scene();
  const renderer = { getDrawingBufferSize: (v: T.Vector2) => v.set(1440, 1000),
    getSize: (v: T.Vector2) => v.set(1440, 1000) } as unknown as T.WebGLRenderer;
  const full = SSAOPass.prototype.render, composite = SSAOPass.prototype.renderPass;
  let fullFrames = 0, reusedFrames = 0;
  SSAOPass.prototype.render = function() { fullFrames++; };
  SSAOPass.prototype.renderPass = function() { reusedFrames++; };
  const ao = createVenueAmbientOcclusion(renderer, scene, camera);
  try {
    ao.render(1400); expect(fullFrames).toBe(0);
    ao.render(180); ao.render(180); expect(fullFrames).toBe(1); expect(reusedFrames).toBe(1);
    camera.position.x = 1; ao.render(180); expect(fullFrames).toBe(2);
    ao.invalidate(); ao.render(180); expect(fullFrames).toBe(3);
    ao.resize(); ao.render(180); expect(fullFrames).toBe(4);
    expect(venueAoStrength(180, 40, 1000)).toBe(.45);
    expect(venueAoStrength(400, 40, 1000)).toBeGreaterThan(venueAoStrength(500, 40, 1000));
    expect(Math.abs(venueAoStrength(400, 40, 1000) - venueAoStrength(401, 40, 1000))).toBeLessThan(.004);
  } finally { ao.dispose(); SSAOPass.prototype.render = full; SSAOPass.prototype.renderPass = composite; }
});

test('water sleeps for distant or off-screen patches and resumes its capped phase nearby', () => {
  const root = new T.Group();
  const material = new T.MeshStandardMaterial(); material.userData['architecturalCategory'] = 'water';
  const left = new T.PlaneGeometry(10, 10).rotateX(-Math.PI / 2).translate(-250, 0, 0);
  const right = left.clone().translate(500, 0, 0);
  const mesh = new T.Mesh(mergeGeometries([left, right], false)!, material); root.add(mesh);
  const water = createVenueWater(root), camera = new T.PerspectiveCamera(40, 1, .1, 5000);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>' } as any;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  const phase = () => shader.uniforms.venueWaterTime.value as number;
  camera.position.set(0, 80, 0); camera.lookAt(0, 0, 0);
  expect(water.update(0, camera, true)).toBe(false); // A merged bounding sphere alone is a false positive.
  camera.position.set(-250, 1400, 0); camera.lookAt(-250, 0, 0);
  expect(water.update(100, camera, true)).toBe(false);
  camera.position.set(-250, 80, 0); camera.lookAt(-250, 0, 0);
  expect(water.update(200, camera, true)).toBe(true);
  water.update(250, camera, true); expect(phase()).toBeCloseTo(.05);
  expect(water.update(300, camera, false)).toBe(false);
  water.update(100000, camera, true); expect(phase()).toBeCloseTo(.05);
  water.update(101000, camera, true); expect(phase()).toBeCloseTo(.15);
  root.visible = false; expect(water.update(101050, camera, true)).toBe(false);
  water.dispose(); left.dispose(); right.dispose(); mesh.geometry.dispose(); material.dispose();
});

test('shipping venue rests in overview and keeps every fountain preview animated, including mobile', () => {
  const root = visitorGeometry(), water = createVenueWater(root);
  const camera = new T.PerspectiveCamera(40, 1.44, 1, 5e7);
  const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + Math.sqrt(3) / 2 * t, y, -Math.sqrt(3) / 2 * s + .5 * t);
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    camera.aspect = width / height; camera.updateProjectionMatrix();
    const target = W(-65, 12, 0);
    camera.position.copy(W(-720, 600, 640));
    camera.position.sub(target).setLength(510 / Math.tan(T.MathUtils.degToRad(20)) * Math.max(.78, 1 / camera.aspect)).add(target);
    camera.lookAt(target);
    expect(water.update(0, camera, true, height), `Overview ${width}px sleeps`).toBe(false);
    for (const [position, lookAt] of [
      [[160, 78, 345], [67, 2, 250]], [[-125, 67, 265], [-207, 3, 205]], [[286, 6, -158], [265, .7, -182]]
    ]) {
      const target = new T.Vector3(...lookAt as [number, number, number]);
      camera.position.set(...position as [number, number, number]);
      camera.position.sub(target).multiplyScalar(Math.max(1, 1.4 / camera.aspect)).add(target); camera.lookAt(target);
      expect(water.update(100, camera, true, height), `Fountain ${position} at ${width}px flows`).toBe(true);
    }
  }
  water.dispose();
});
