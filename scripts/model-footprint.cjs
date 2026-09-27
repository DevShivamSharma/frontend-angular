// Offline footprint extraction from actual transformed GLB top surfaces.
const T = require('three');
const clip = require('polygon-clipping');
function campusFootprint(bytes) {
  const length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + length));
  const offset = 28 + length;
  const matrices = new Map();
  function visit(index, parent) {
    const n = gltf.nodes[index];
    const local = n.matrix ? new T.Matrix4().fromArray(n.matrix) : new T.Matrix4().compose(
      new T.Vector3(...(n.translation || [0, 0, 0])),
      new T.Quaternion(...(n.rotation || [0, 0, 0, 1])), new T.Vector3(...(n.scale || [1, 1, 1])));
    const world = parent.clone().multiply(local); matrices.set(index, world);
    for (const child of n.children || []) visit(child, world);
  }
  for (const index of gltf.scenes[gltf.scene || 0].nodes) visit(index, new T.Matrix4());
  function accessor(index) {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const size = a.type === 'VEC3' ? 3 : 1;
    const component = {5121:[1,'readUInt8'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']}[a.componentType];
    if (!component || a.sparse) throw Error('Unsupported footprint accessor');
    return Array.from({length:a.count}, (_,i) => Array.from({length:size}, (_,j) =>
      bytes[component[1]](offset + (view.byteOffset || 0) + (a.byteOffset || 0) + i*(view.byteStride || size*component[0]) + j*component[0])));
  }
  const surfaces = [];
  for (const [index, matrix] of matrices) {
    const n = gltf.nodes[index];
    if (n.mesh === undefined) continue;
    const site = n.name === 'SITE_GROUND';
    const path = n.extras?.kind === 'campus_path';
    const entry = n.extras?.kind === 'gate_entry_steps';
    const admin = n.extras?.kind === 'admin_precinct_revision';
    if (!site && !path && !admin && !entry) continue;
    const triangles = [];
    for (const primitive of gltf.meshes[n.mesh].primitives) {
      const positions = accessor(primitive.attributes.POSITION).map(p => new T.Vector3(...p).applyMatrix4(matrix));
      // Only ground slabs, lawns, kerbs and paving; never office buildings/trees.
      if (admin && positions.some(p => p.y > 1)) continue;
      const indices = primitive.indices === undefined ? positions.map((_,i) => i) : accessor(primitive.indices).flat();
      for (let i=0; i<indices.length; i+=3) {
        const p = indices.slice(i,i+3).map(j => positions[j]);
        const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
        if (normal.y <= .00001 || (site && !p.every(v => Math.abs(v.y) < .001))) continue;
        const ring = p.map(v => [Math.round(v.x*100)/100,Math.round(v.z*100)/100]); ring.push(ring[0]);
        triangles.push([ring]);
      }
    }
    if (triangles.length) surfaces.push(clip.union(...triangles));
  }
  if (!surfaces.length) throw Error('No authored campus ground surfaces');
  return clip.union(...surfaces);
}
module.exports = {campusFootprint};
