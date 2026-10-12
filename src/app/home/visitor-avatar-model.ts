import * as T from 'three';
import { disposeVisitorModel } from './visitor-avatar-rig';

/** The supplied Meshy asset is a static mesh, with no skeleton or animation clips. */
export function createVisitorAvatarModel(model: T.Group) {
  const root = new T.Group();
  root.name = 'Supplied Meshy visitor';
  root.add(model);
  model.traverse(object => {
    if (object instanceof T.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(model, true);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Visitor model has invalid dimensions.');
  const center = bounds.getCenter(new T.Vector3());
  const scale = 1.8 / height;
  root.scale.setScalar(scale);
  model.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
  root.updateMatrixWorld(true);
  return {
    root,
    dispose() { root.removeFromParent(); disposeVisitorModel(model); root.clear(); },
  };
}
