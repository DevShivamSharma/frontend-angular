import * as T from 'three';
import { createVisitorAvatarModel } from './visitor-avatar-model';

const FRAMES = 24;

/** Bake the real walk once, then interpolate poses on the GPU for every instance.
 * No animation mixers or skeleton traversals run in the frame loop. */
export async function createCrowdBatch(model: T.Group, clips: T.AnimationClip[], material: T.MeshStandardMaterial,
  capacity: number, signal: AbortSignal) {
  const avatar = createVisitorAvatarModel(model, clips, { sharedResources: true });
  let skin: T.SkinnedMesh | undefined;
  model.traverse(o => { if (o instanceof T.SkinnedMesh) skin ??= o; });
  if (!skin) { avatar.dispose(); throw new Error('Crowd asset has no skinned mesh'); }
  const source = skin, geometry = source.geometry.clone();
  const position = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const vertices = position.count, width = 1024, poseTexels = (FRAMES + 1) * vertices;
  const height = Math.ceil(poseTexels * 2 / width), pixels = new Uint16Array(width * height * 4);
  const point = new T.Vector3(), normalPoint = new T.Vector3(), normalMatrix = new T.Matrix3();
  const put = (texel: number, value: T.Vector3) => {
    const i = texel * 4; pixels[i] = T.DataUtils.toHalfFloat(value.x);
    pixels[i + 1] = T.DataUtils.toHalfFloat(value.y); pixels[i + 2] = T.DataUtils.toHalfFloat(value.z);
  };
  try {
    for (let frame = 0; frame <= FRAMES; frame++) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
      avatar.sampleWalk(frame / FRAMES, frame === FRAMES);
      normalMatrix.getNormalMatrix(source.matrixWorld);
      for (let vertex = 0; vertex < vertices; vertex++) {
        point.fromBufferAttribute(position, vertex);
        normalPoint.fromBufferAttribute(normals, vertex).add(point);
        source.applyBoneTransform(vertex, normalPoint); source.applyBoneTransform(vertex, point);
        normalPoint.sub(point).applyMatrix3(normalMatrix).normalize();
        point.applyMatrix4(source.matrixWorld);
        put(frame * vertices + vertex, point); put(poseTexels + frame * vertices + vertex, normalPoint);
      }
    }
  } catch (error) { geometry.dispose(); throw error; }
  finally { avatar.dispose(); }
  const texture = new T.DataTexture(pixels, width, height, T.RGBAFormat, T.HalfFloatType);
  texture.name = 'Nathan shared walk and standing poses'; texture.needsUpdate = true;
  texture.minFilter = texture.magFilter = T.NearestFilter; texture.generateMipmaps = false;
  geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
  geometry.deleteAttribute('tangent');
  geometry.setAttribute('crowdVertex', new T.Float32BufferAttribute(Array.from({ length: vertices }, (_, i) => i), 1));
  const phases = new T.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('crowdPose', phases);
  const finish = material.clone();
  finish.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { crowdAtlas: { value: texture }, crowdAtlasSize: { value: new T.Vector2(width, height) },
      crowdVertices: { value: vertices }, crowdFrames: { value: FRAMES } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float crowdVertex;
      attribute vec2 crowdPose;
      uniform sampler2D crowdAtlas;
      uniform vec2 crowdAtlasSize;
      uniform float crowdVertices, crowdFrames;
      vec3 crowdRead(float frame, float normalLayer) {
        float texel = (normalLayer * (crowdFrames + 1.0) + frame) * crowdVertices + crowdVertex;
        vec2 uv = (vec2(mod(texel, crowdAtlasSize.x), floor(texel / crowdAtlasSize.x)) + 0.5) / crowdAtlasSize;
        return texture2D(crowdAtlas, uv).xyz;
      }
      vec3 crowdSample(float layer) {
        if (crowdPose.y < 0.001) return crowdRead(crowdFrames, layer);
        float frame = fract(crowdPose.x) * crowdFrames;
        vec3 walking = mix(crowdRead(floor(frame), layer), crowdRead(mod(floor(frame) + 1.0, crowdFrames), layer), fract(frame));
        if (crowdPose.y > 0.999) return walking;
        return mix(crowdRead(crowdFrames, layer), walking, crowdPose.y);
      }`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(crowdSample(1.0));');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = crowdSample(0.0);');
  };
  finish.customProgramCacheKey = () => 'nathan-instanced-walk-v1';
  const mesh = new T.InstancedMesh(geometry, finish, capacity);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.count = 0; mesh.raycast = () => {};
  return { mesh, phases, strideDuration: avatar.strideDuration, capturedSpeed: avatar.capturedSpeed,
    commit() { phases.needsUpdate = true; mesh.instanceMatrix.needsUpdate = true; },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); finish.dispose(); texture.dispose(); } };
}
