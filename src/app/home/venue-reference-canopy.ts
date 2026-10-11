import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PREPARED = 'referenceCanopiesPrepared';
const STEEL = /^(?:PHOTO_(CENTRAL_SPINE_continuous|GARDEN_TO_FOUNTAIN_cross)_canopy|PHOTO_HALLS_corrected_covered_approach)_columns_trusses_and_gutters$/;
const PANELS = new Set(['PHOTO_GARDEN_TO_FOUNTAIN_cross_canopy_roof_panels',
  'PHOTO_HALLS_corrected_covered_approach_roof_panels']);
const S = new T.Vector3(.5, 0, -Math.sqrt(3) / 2);
const U = new T.Vector3(Math.sqrt(3) / 2, 0, .5);
type Quad = [T.Vector3, T.Vector3, T.Vector3, T.Vector3];

/** 0015 00:28 / 0016 00:24: open patterned metal infill and a rectangular
 * structural grid. Dimensions are retained from the shipped model, not surveyed
 * from footage. Apply before navigation capture, batching and material cloning. */
export function prepareReferenceCanopies(root: T.Group): void {
  if (root.userData[PREPARED]) return;
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const steel: T.Mesh[] = [], panels: T.Mesh[] = [];
  root.traverse(object => {
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh || Array.isArray(object.material)) return;
    const names = [object.name, object.parent?.name ?? ''].map(name => name.replace(/ /g, '_'));
    if (names.some(name => STEEL.test(name))) steel.push(object);
    if (names.some(name => PANELS.has(name))) panels.push(object);
  });
  if (!steel.length && !panels.length) return;

  const quads: Quad[] = [];
  const localPoints = (mesh: T.Mesh) => {
    const transform = new T.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    return Array.from({ length: position.count }, (_, index) =>
      new T.Vector3().fromBufferAttribute(position, index).applyMatrix4(transform));
  };
  const central = steel.find(mesh => /CENTRAL_SPINE/.test(mesh.name + mesh.parent?.name));
  if (central) {
    // In the source GLB the long spine has registered trusses but no infill.
    // Fill only their existing overhead envelope; do not move/add any supports.
    const points = localPoints(central).filter(point => point.y > 6.7);
    const s = points.map(point => point.dot(S)), u = points.map(point => point.dot(U));
    if (points.length) {
      const s0 = Math.min(...s), s1 = Math.max(...s), u0 = Math.min(...u), u1 = Math.max(...u);
      const at = (across: number, along: number) => {
        const heights = points.filter((_, i) => Math.abs(s[i] - across) < .3).map(point => point.y);
        const height = heights.length ? Math.max(...heights) - .04 : 6.96;
        return S.clone().multiplyScalar(across).addScaledVector(U, along).setY(height);
      };
      for (let strip = 0; strip < 4; strip++) {
        const a = T.MathUtils.lerp(s0, s1, strip / 4), b = T.MathUtils.lerp(s0, s1, (strip + 1) / 4);
        quads.push([at(a, u0), at(b, u0), at(b, u1), at(a, u1)]);
      }
    }
  }

  // The source alternates graphite and pale sloping strips. Preserve every
  // strip's registered corners and pitch while replacing its opaque surface.
  const sourcePanels = panels.map(mesh => ({ mesh, points: localPoints(mesh) }));
  const recoveredPanels = new Set<T.Mesh>();
  for (const { mesh, points } of sourcePanels) {
    const recovered = topQuads(mesh.geometry, points);
    if (recovered.length) { quads.push(...recovered); recoveredPanels.add(mesh); }
  }
  if (!quads.length) return;

  const perforation = perforationTexture();
  const infill = new T.MeshStandardMaterial({ color: 0x898570, metalness: .32, roughness: .68,
    side: T.DoubleSide, alphaMap: perforation, alphaTest: .22 });
  infill.name = 'REFERENCE perforated olive bronze canopy';
  infill.userData = { referenceMaterial: true, architecturalCategory: 'roof' };
  const frame = new T.MeshStandardMaterial({ color: 0x74725f, metalness: .4, roughness: .57 });
  frame.name = 'REFERENCE olive bronze canopy framing';
  frame.userData = { referenceMaterial: true, architecturalCategory: 'structure' };
  const group = new T.Group(); group.name = 'REFERENCE_covered_spine_infill';
  group.userData = { referenceCanopy: true, reference: 'DJI_20250217154154_0015_D 00:28; DJI_20250217154322_0016_D 00:24',
    dimensionalStatus: 'Existing registered source envelopes; pattern spacing estimated from video' };

  const positions: number[] = [], uv: number[] = [], index: number[] = [];
  const beams: T.BufferGeometry[] = [], beamKeys = new Set<string>();
  const cube = new T.BoxGeometry(1, 1, 1);
  const addBeam = (a: T.Vector3, b: T.Vector3) => {
    const key = [a, b].map(p => p.toArray().map(v => v.toFixed(3)).join(',')).sort().join('|');
    if (beamKeys.has(key) || a.distanceTo(b) < .01) return;
    beamKeys.add(key);
    const midpoint = a.clone().add(b).multiplyScalar(.5).add(new T.Vector3(0, -.055, 0));
    const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), b.clone().sub(a).normalize());
    beams.push(cube.clone().applyMatrix4(new T.Matrix4().compose(midpoint, rotation,
      new T.Vector3(a.distanceTo(b), .11, .085))));
  };
  for (const quad of quads) {
    const offset = positions.length / 3;
    for (const point of quad) { positions.push(...point.toArray()); uv.push(point.dot(S) / 2, point.dot(U) / 2); }
    index.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
    const divisionsA = Math.ceil(quad[0].distanceTo(quad[1]) / 3);
    const divisionsB = Math.ceil(quad[0].distanceTo(quad[3]) / 3);
    for (let i = 0; i <= divisionsA; i++) addBeam(quad[0].clone().lerp(quad[1], i / divisionsA),
      quad[3].clone().lerp(quad[2], i / divisionsA));
    for (let i = 0; i <= divisionsB; i++) addBeam(quad[0].clone().lerp(quad[3], i / divisionsB),
      quad[1].clone().lerp(quad[2], i / divisionsB));
  }
  cube.dispose();
  const sheet = new T.BufferGeometry();
  sheet.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  sheet.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); sheet.setIndex(index); sheet.computeVertexNormals();
  sheet.computeBoundingBox(); sheet.computeBoundingSphere();
  const screen = new T.Mesh(sheet, infill); screen.name = 'REFERENCE_canopy_perforated_infill';
  screen.castShadow = screen.receiveShadow = true;
  group.add(screen);
  const lattice = mergeGeometries(beams, false)!;
  beams.forEach(geometry => geometry.dispose()); lattice.computeBoundingBox(); lattice.computeBoundingSphere();
  const grid = new T.Mesh(lattice, frame); grid.name = 'REFERENCE_canopy_panel_frames';
  grid.castShadow = grid.receiveShadow = true; group.add(grid);
  root.add(group);

  const removedGeometries = new Set<T.BufferGeometry>(), removedMaterials = new Set<T.Material>();
  for (const mesh of steel) { removedMaterials.add(mesh.material as T.Material); mesh.material = frame; }
  // Only remove a source surface when its own geometry was successfully recovered.
  for (const mesh of recoveredPanels) {
    removedGeometries.add(mesh.geometry); removedMaterials.add(mesh.material as T.Material); mesh.removeFromParent();
  }
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    removedGeometries.delete(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) removedMaterials.delete(material);
  });
  removedGeometries.forEach(geometry => geometry.dispose()); removedMaterials.forEach(material => material.dispose());
  root.userData[PREPARED] = true;
  root.userData['referenceCanopyCoverage'] = { supportMeshes: steel.length, sourceRoofMeshes: panels.length,
    sourceFamilies: [...new Set([...steel, ...panels].map(mesh =>
      /PHOTO_(CENTRAL_SPINE|GARDEN_TO_FOUNTAIN|HALLS)/.exec(mesh.name + mesh.parent?.name)?.[1]).filter(Boolean))],
    infillQuads: quads.length, frameMembers: beamKeys.size, alphaTextureSize: 256, newGroundSupports: 0 };
  root.updateMatrixWorld(true);
}

/** Recover disjoint indexed top faces, preserving bends in the source route. */
function topQuads(geometry: T.BufferGeometry, points: T.Vector3[]): Quad[] {
  const triangles: number[][] = [], index = geometry.index;
  for (let i = 0; i < (index?.count ?? points.length); i += 3) {
    const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
    const normal = points[ids[1]].clone().sub(points[ids[0]])
      .cross(points[ids[2]].clone().sub(points[ids[0]])).normalize();
    if (Math.abs(normal.y) > .9) triangles.push(ids);
  }
  const quads: Quad[] = [];
  while (triangles.length) {
    const vertices = new Set(triangles.shift()!);
    let joined = true;
    while (joined) {
      joined = false;
      for (let i = triangles.length - 1; i >= 0; i--) if (triangles[i].some(id => vertices.has(id))) {
        triangles.splice(i, 1)[0].forEach(id => vertices.add(id)); joined = true;
      }
    }
    const distinct = [...new Map([...vertices].map(id => [points[id].toArray().join(','), points[id]])).values()];
    if (distinct.length !== 4) continue;
    const center = distinct.reduce((sum, point) => sum.add(point), new T.Vector3()).multiplyScalar(.25);
    distinct.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
    quads.push(distinct as Quad);
  }
  return quads;
}

/** A small reusable alpha tile gives genuine openings without thousands of
 * tiny holes/triangles. Mipmaps and a low threshold retain distant coverage. */
function perforationTexture(): T.DataTexture {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / 16), px = ((x + (row % 2) * 8) % 16) - 8;
    const py = y % 16 - 8;
    const hexDistance = Math.max(Math.abs(px) * .866 + Math.abs(py) * .5, Math.abs(py));
    const metal = hexDistance > 5.5;
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = metal ? 255 : 0; data[offset + 3] = 255;
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.name = 'REFERENCE canopy hex perforation'; texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
