import * as T from 'three';
import { disposeVisitorModel } from './visitor-avatar-rig';

/** Nathan's captured walk, played in place so navigation owns displacement. */
export function createVisitorAvatarModel(model: T.Group, animations: T.AnimationClip[], options: { sharedResources?: boolean; phase?: number } = {}) {
  const source = animations.find(clip => clip.name === 'Walk');
  if (!source) throw new Error('Visitor model is missing its walking animation.');
  const walkClip = source.clone();
  const rootTrack = walkClip.tracks.find(track => track.name.endsWith('_root.position'));
  if (!rootTrack) throw new Error('Visitor walking animation is missing root motion.');
  model.updateMatrixWorld(true);
  const motionRoot = model.getObjectByName(rootTrack.name.slice(0, -'.position'.length));
  if (!motionRoot?.parent) throw new Error('Visitor root motion has no matching bone.');
  const first = new T.Vector3().fromArray(rootTrack.values);
  const last = new T.Vector3().fromArray(rootTrack.values, rootTrack.values.length - 3);
  const distance = first.clone().applyMatrix4(motionRoot.parent.matrixWorld)
    .distanceTo(last.applyMatrix4(motionRoot.parent.matrixWorld));
  // Forward is not necessarily local Z after FBX conversion. Hip tracks retain
  // vertical gait; all displacement on the root belongs to navigation.
  for (let i = 0; i < rootTrack.values.length; i += 3) first.toArray(rootTrack.values, i);
  const start = Math.min(...walkClip.tracks.map(track => track.times[0]));
  walkClip.tracks.forEach(track => track.shift(-start));
  walkClip.resetDuration();

  // The source has only Walk. Average its stride into a relaxed standing pose,
  // aligning quaternion hemispheres to avoid flipped joints.
  const idleTracks = walkClip.tracks.map(track => {
    const size = track.getValueSize(), average = new Array<number>(size).fill(0);
    for (let i = 0; i < track.values.length; i += size) {
      let sign = 1;
      if (track instanceof T.QuaternionKeyframeTrack) {
        let dot = 0;
        for (let j = 0; j < size; j++) dot += track.values[j] * track.values[i + j];
        sign = dot < 0 ? -1 : 1;
      }
      for (let j = 0; j < size; j++) average[j] += sign * track.values[i + j] / track.times.length;
    }
    if (track instanceof T.QuaternionKeyframeTrack) {
      new T.Quaternion().fromArray(average).normalize().toArray(average);
      return new T.QuaternionKeyframeTrack(track.name, [0], average);
    }
    return new T.VectorKeyframeTrack(track.name, [0], average);
  });
  const idleClip = new T.AnimationClip('Standing', 1, idleTracks);
  const root = new T.Group(); root.name = 'Nathan visitor'; root.add(model);
  model.traverse(object => {
    if (object instanceof T.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      if (object instanceof T.SkinnedMesh) object.frustumCulled = false;
    }
  });
  const mixer = new T.AnimationMixer(model);
  const idle = mixer.clipAction(idleClip).play();
  const walk = mixer.clipAction(walkClip).play();
  walk.setEffectiveWeight(0); mixer.update(0); root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(model, true);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Visitor model has invalid dimensions.');
  const center = bounds.getCenter(new T.Vector3());
  const scale = 1.8 / height;
  idle.setEffectiveWeight(0); walk.setEffectiveWeight(1); mixer.update(0);
  root.updateMatrixWorld(true);
  const walkFloor = new T.Box3().setFromObject(model, true).min.y;
  root.scale.setScalar(scale);
  model.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
  const standingY = model.position.y, floorCorrection = bounds.min.y - walkFloor;
  const capturedSpeed = Math.max(.1, distance * scale / walkClip.duration);
  idle.setEffectiveWeight(1); walk.setEffectiveWeight(0); mixer.update(0);
  walk.time = (options.phase ?? 0) * walkClip.duration;
  root.updateMatrixWorld(true);
  let weight = 0;
  return {
    root,
    strideDuration: walkClip.duration,
    capturedSpeed,
    /** Used once to bake shared GPU crowd poses; player motion still uses update. */
    sampleWalk(phase: number, standing = false) {
      idle.setEffectiveWeight(standing ? 1 : 0); walk.setEffectiveWeight(standing ? 0 : 1);
      walk.time = phase * walkClip.duration; mixer.update(0);
      model.position.y = standingY + (standing ? 0 : floorCorrection);
      root.updateMatrixWorld(true);
    },
    update(dt: number, speed: number, reducedMotion: boolean, jumpHeight = 0) {
      const elapsed = T.MathUtils.clamp(dt, 0, .1);
      const target = !reducedMotion && jumpHeight <= .01 && speed > .05 ? 1 : 0;
      weight = reducedMotion ? 0 : T.MathUtils.damp(weight, target, 14, elapsed);
      if (Math.abs(weight - target) < .002) weight = target;
      walk.setEffectiveWeight(weight); idle.setEffectiveWeight(1 - weight);
      // Match captured stride speed during normal walking; cap fast-travel cadence.
      walk.setEffectiveTimeScale(T.MathUtils.clamp(speed / capturedSpeed, 0, 2.5));
      mixer.update(elapsed);
      model.position.y = standingY + floorCorrection * weight;
      return weight > 0;
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      root.removeFromParent();
      if (options.sharedResources) {
        model.traverse(object => { if (object instanceof T.SkinnedMesh) object.skeleton.dispose(); });
        model.clear();
      } else disposeVisitorModel(model);
      root.clear();
    },
  };
}
