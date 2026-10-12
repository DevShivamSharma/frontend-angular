import * as T from 'three';
import { repairVisitorLegWeights } from './visitor-avatar-skin';
import { separateVisitorThighs } from './visitor-avatar-seams';

const AVATAR_HEIGHT = 1.8;
// The supplied character faces -Z; its parent is turned to navigation's +Z.
const across = new T.Vector3(-1, 0, 0);

/** The supplied Tripo skeleton has a baked stride pose and no animation clips.
 * Work in model-space axes, rather than assuming its bone-local X axes agree. */
export function createVisitorAvatarRig(model: T.Group) {
  const root = new T.Group(), body = new T.Group();
  root.name = 'Supplied visitor avatar'; root.add(body); body.add(model);
  const bones = new Map<string, T.Bone>();
  model.traverse(object => {
    if (object instanceof T.Bone) bones.set(object.name, object);
    if (object instanceof T.Mesh) {
      object.castShadow = true; object.receiveShadow = true;
      if (object instanceof T.SkinnedMesh) object.frustumCulled = false;
    }
  });
  const required = ['L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot',
    'L_Upperarm', 'L_Forearm', 'L_Hand', 'R_Upperarm', 'R_Forearm', 'R_Hand'];
  if (required.some(name => !bones.has(name))) throw new Error('Visitor rig is missing a required limb.');
  root.updateMatrixWorld(true);
  repairVisitorLegWeights(model, bones);
  const point = new T.Vector3(), next = new T.Vector3(), parentRotation = new T.Quaternion();
  const rotation = new T.Quaternion(), delta = new T.Quaternion();
  const feet = ['L_Foot', 'R_Foot'].map(name => bones.get(name)!);
  const footRotations = feet.map(foot => foot.getWorldQuaternion(new T.Quaternion()));
  function aim(name: string, end: string, direction: T.Vector3) {
    const bone = bones.get(name)!;
    bone.getWorldPosition(point); bones.get(end)!.getWorldPosition(next);
    delta.setFromUnitVectors(next.sub(point).normalize(), direction.normalize());
    bone.getWorldQuaternion(rotation).premultiply(delta);
    bone.parent!.getWorldQuaternion(parentRotation).invert();
    bone.quaternion.copy(parentRotation.multiply(rotation));
    root.updateMatrixWorld(true);
  }
  // Relax the frozen mid-stride into standing, preserving the supplied skin.
  for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
    const thigh = bones.get(`${side}_Thigh`)!;
    thigh.getWorldPosition(point); point.x += sign * .045;
    thigh.position.copy(thigh.parent!.worldToLocal(point));
    root.updateMatrixWorld(true);
    aim(`${side}_Thigh`, `${side}_Calf`, new T.Vector3(sign * .025, -1, 0));
    aim(`${side}_Calf`, `${side}_Foot`, new T.Vector3(0, -1, 0));
    aim(`${side}_Upperarm`, `${side}_Forearm`, new T.Vector3(sign * .12, -1, 0));
    aim(`${side}_Forearm`, `${side}_Hand`, new T.Vector3(0, -1, -.12));
  }
  feet.forEach((foot, i) => {
    foot.parent!.getWorldQuaternion(parentRotation).invert();
    foot.quaternion.copy(parentRotation.multiply(footRotations[i]));
  });
  root.updateMatrixWorld(true);
  separateVisitorThighs(model, bones);
  const bounds = new T.Box3().setFromObject(model, true), size = bounds.getSize(new T.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Visitor model has invalid dimensions.');
  const center = bounds.getCenter(new T.Vector3()), scale = AVATAR_HEIGHT / size.y;
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  root.updateMatrixWorld(true);
  const driven = new Map<string, { bone: T.Bone; base: T.Quaternion; axis: T.Vector3 }>();
  for (const name of required) {
    const bone = bones.get(name)!;
    const inverse = bone.getWorldQuaternion(new T.Quaternion()).invert();
    driven.set(name, { bone, base: bone.quaternion.clone(), axis: across.clone().applyQuaternion(inverse) });
  }
  // Sole probes anchor the lower foot without scanning the skinned mesh each frame.
  const soles = feet.flatMap(foot => {
    const p = foot.getWorldPosition(new T.Vector3());
    return [-.08, .08].map(z => ({ foot, local: foot.worldToLocal(new T.Vector3(p.x, 0, p.z + z)) }));
  });
  root.rotation.y = Math.PI;
  let phase = 0, blend = 0, airBlend = 0;
  function pose(name: string, angle: number) {
    const joint = driven.get(name)!;
    joint.bone.quaternion.copy(joint.base).multiply(delta.setFromAxisAngle(joint.axis, angle));
  }
  return {
    root,
    update(dt: number, speed: number, reducedMotion: boolean, jumpHeight: number) {
      blend = T.MathUtils.damp(blend, Math.min(1, speed / 1.5), 12, dt);
      airBlend = T.MathUtils.damp(airBlend, jumpHeight > .01 ? 1 : 0, 18, dt);
      phase += dt * Math.min(speed, 5.5) * 4.5;
      const amplitude = T.MathUtils.lerp(.42, .62, T.MathUtils.clamp((speed - 2.6) / 2.9, 0, 1));
      for (const [side, offset] of [['L', 0], ['R', Math.PI]] as const) {
        const swing = Math.sin(phase + offset) * amplitude * blend;
        const thigh = T.MathUtils.lerp(-swing, -.22, airBlend);
        const knee = T.MathUtils.lerp(Math.max(0, -swing) * 1.35, .5, airBlend);
        pose(`${side}_Thigh`, thigh); pose(`${side}_Calf`, knee);
        pose(`${side}_Foot`, -thigh - knee);
        pose(`${side}_Upperarm`, T.MathUtils.lerp(swing * .75, -.3, airBlend));
        pose(`${side}_Forearm`, T.MathUtils.lerp(-.12 * blend, -.45, airBlend));
      }
      body.position.y = 0;
      root.updateWorldMatrix(true, true);
      let lowest = Infinity;
      for (const sole of soles) {
        point.copy(sole.local); sole.foot.localToWorld(point); root.worldToLocal(point);
        lowest = Math.min(lowest, point.y);
      }
      body.position.y = -lowest;
      if (!reducedMotion && blend < .01 && airBlend < .01) body.position.y += Math.sin(phase) * .002;
    },
    dispose() { root.removeFromParent(); disposeVisitorModel(model); root.clear(); },
  };
}

export function disposeVisitorModel(model: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  const textures = new Set<T.Texture>(), skeletons = new Set<T.Skeleton>();
  model.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof T.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  skeletons.forEach(skeleton => skeleton.dispose());
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  textures.forEach(texture => {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.source?.data instanceof ImageBitmap) texture.source.data.close();
  });
  model.clear();
}
