import * as T from 'three';

/** Separate the scan's fused inner-thigh strip after the bones reach neutral.
 * Reproject into bind space so the repaired cloth still follows the same rig. */
export function separateVisitorThighs(model: T.Group, bones: Map<string, T.Bone>) {
  const left = bones.get('L_Thigh')!.getWorldPosition(new T.Vector3());
  const right = bones.get('R_Thigh')!.getWorldPosition(new T.Vector3());
  const middle = (left.x + right.x) / 2, hipHeight = Math.min(left.y, right.y);
  const vertex = new T.Vector3(), transform = new T.Matrix4(), jointTransform = new T.Matrix4();
  model.traverse(object => {
    if (!(object instanceof T.SkinnedMesh)) return;
    const geometry = object.geometry, positions = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
    const names = object.skeleton.bones.map(bone => bone.name);
    const side = new Int8Array(positions.count), belowCrotch = new Uint8Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      let l = 0, r = 0;
      for (let k = 0; k < 4; k++) {
        const name = names[skinIndex.getComponent(i, k)], weight = skinWeight.getComponent(i, k);
        if (/^L_(Thigh|Calf|Foot)/.test(name)) l += weight;
        if (/^R_(Thigh|Calf|Foot)/.test(name)) r += weight;
      }
      if (l + r < .5) continue;
      object.getVertexPosition(i, vertex).applyMatrix4(object.matrixWorld);
      side[i] = l > r ? -1 : 1;
      belowCrotch[i] = Number(vertex.y < hipHeight - .055);
      const gap = .034 * T.MathUtils.smoothstep(hipHeight - vertex.y, .04, .14);
      const x = side[i] < 0 ? Math.min(vertex.x, middle - gap) : Math.max(vertex.x, middle + gap);
      if (x === vertex.x) continue;
      vertex.x = x;
      transform.elements.fill(0);
      for (let k = 0; k < 4; k++) {
        const joint = skinIndex.getComponent(i, k), weight = skinWeight.getComponent(i, k);
        jointTransform.multiplyMatrices(object.skeleton.bones[joint].matrixWorld, object.skeleton.boneInverses[joint]);
        for (let element = 0; element < 16; element++) transform.elements[element] += jointTransform.elements[element] * weight;
      }
      transform.premultiply(object.bindMatrixInverse).premultiply(object.matrixWorld).multiply(object.bindMatrix).invert();
      vertex.applyMatrix4(transform); positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    const index = geometry.index!;
    const triangles: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const mixed = Math.min(side[a], side[b], side[c]) < 0 && Math.max(side[a], side[b], side[c]) > 0;
      if (mixed && belowCrotch[a] && belowCrotch[b] && belowCrotch[c]) continue;
      triangles.push(a, b, c);
    }
    geometry.setIndex(triangles); positions.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  });
}
