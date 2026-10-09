import fs from 'node:fs';
import * as T from 'three';
import { VisitorNavigation, campusWalkable, slideVisitor } from '../src/app/home/visitor-navigation';

export function campusRoute(nav: VisitorNavigation, goal: T.Vector3): T.Vector3[] {
  const step = 5, nodes = [{ p: nav.spawn.clone(), parent: -1 }], seen = new Set(['0,0']);
  for (let index = 0; index < nodes.length; index++) {
    const { p } = nodes[index];
    if (Math.hypot(p.x - goal.x, p.z - goal.z) < 8) {
      const trial = p.clone(); slideVisitor(trial, goal.x - p.x, goal.z - p.z, q => campusWalkable(nav, q));
      if (Math.hypot(trial.x - goal.x, trial.z - goal.z) < .01) {
        const path = [goal.clone()]; let previous = index;
        while (previous >= 0) { path.push(nodes[previous].p); previous = nodes[previous].parent; }
        path.reverse();
        return path.filter((p, i) => !i || i === path.length - 1 ||
          Math.abs((p.x - path[i - 1].x) * (path[i + 1].z - p.z) - (p.z - path[i - 1].z) * (path[i + 1].x - p.x)) > .001);
      }
    }
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = p.clone().add(new T.Vector3(dx, 0, dz));
      const key = `${Math.round((next.x - nav.spawn.x) / step)},${Math.round((next.z - nav.spawn.z) / step)}`;
      if (seen.has(key)) continue; seen.add(key);
      const trial = p.clone(); slideVisitor(trial, dx, dz, q => campusWalkable(nav, q));
      if (trial.distanceTo(next) < .01) nodes.push({ p: next, parent: index });
    }
  }
  throw new Error('No route to the entrance approach');
}

/** The shipped mesh buffers, without loading textures or requiring a WebGL context. */
export function visitorGeometry() {
  const bytes = fs.readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length), root = new T.Group();
  const nodes = json.nodes.map((n: any) => {
    const group = new T.Group(); group.name = (n.name ?? '').replace(/ /g, '_'); group.userData = n.extras ?? {};
    for (const p of json.meshes[n.mesh]?.primitives ?? []) {
      const accessor = json.accessors[p.attributes.POSITION], view = json.bufferViews[accessor.bufferView];
      const values = new Float32Array(accessor.count * 3);
      for (let i = 0; i < accessor.count; i++) for (let k = 0; k < 3; k++)
        values[i * 3 + k] = binary.readFloatLE((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12) + k * 4);
      const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(values, 3));
      if (p.indices !== undefined) {
        const a = json.accessors[p.indices], v = json.bufferViews[a.bufferView];
        const indices = new Uint32Array(a.count), size = a.componentType === 5125 ? 4 : 2;
        for (let i = 0; i < a.count; i++) {
          const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * size;
          indices[i] = size === 4 ? binary.readUInt32LE(offset) : binary.readUInt16LE(offset);
        }
        geometry.setIndex(new T.BufferAttribute(indices, 1));
      }
      group.add(new T.Mesh(geometry, new T.MeshStandardMaterial()));
    }
    if (n.translation) group.position.fromArray(n.translation);
    if (n.rotation) group.quaternion.fromArray(n.rotation);
    if (n.scale) group.scale.fromArray(n.scale);
    if (n.matrix) { group.matrix.fromArray(n.matrix); group.matrix.decompose(group.position, group.quaternion, group.scale); }
    return group;
  });
  json.nodes.forEach((n: any, i: number) => { for (const child of n.children ?? []) nodes[i].add(nodes[child]); });
  for (const id of json.scenes[json.scene ?? 0].nodes) root.add(nodes[id]);
  root.updateMatrixWorld(true);
  return root;
}
