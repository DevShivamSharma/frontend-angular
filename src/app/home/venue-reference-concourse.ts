import * as T from 'three';

type Finish = 'paving' | 'sandstone';
const KEY = 'referenceConcourse';
const ROOT_KEY = 'referenceConcoursePrepared';
const routes = new Set([
  'photo path cc to central garden covered walk',
  'photo path central covered promenade paving',
  'photo path central promenade junction',
  'photo path gate 6 entry to garden cross promenade',
  'photo path hall 1 to hall 6 covered promenade paving',
  'photo path hall 6 entry approach'
]);
const pavilions = new Set([
  'photo central plaza sandstone kiosks',
  'photo central garden sandstone display portals'
]);
const sources = [
  'User ground photographs 2026-10-14: Hall 2/4/5 entrances and covered concourse',
  'DJI_20250217163819_0039_D.MP4 @00:09,00:40.5',
  'DJI_20250217163917_0040_D.MP4 @00:00,00:33'
];
const normalized = (name: string) => name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Reference finishes only: the authored route boundaries, elevations, portals
 * and collision surfaces are unchanged. Ground-photo accents are prepared
 * separately by prepareGroundPhotoDetails.
 * Call after the existing surface/architecture preparation and before batching.
 */
export function prepareReferenceConcourse(root: T.Group): void {
  if (root.userData[ROOT_KEY]) return;
  root.updateMatrixWorld(true);
  const textures = new Map<Finish, T.DataTexture>();
  const variants = new Map<T.Material, Map<Finish, T.MeshStandardMaterial>>();
  const replacedGeometry = new Set<T.BufferGeometry>(), replacedMaterials = new Set<T.Material>();
  const coverage = { paving: 0, sandstone: 0 };
  root.traverse(object => {
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
    let family: Finish | undefined;
    for (let parent: T.Object3D | null = object; parent && parent !== root; parent = parent.parent) {
      const name = normalized(parent.name);
      if (routes.has(name)) { family = 'paving'; break; }
      if (pavilions.has(name)) { family = 'sandstone'; break; }
    }
    if (!family) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // glTF already separates the individual finishes into primitives. Never
    // reproject a mixed primitive containing an inset, sign or unrelated finish.
    if (materials.length !== 1 || !(materials[0] instanceof T.MeshStandardMaterial)) return;
    const source = materials[0];
    if (family === 'sandstone' && !/sandstone/i.test(source.name)) return;
    if (family === 'paving' && source.userData['architecturalCategory'] !== 'stone') return;
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    let material = variants.get(source)?.get(family);
    if (!material) {
      const texture = textures.get(family) ?? createFinishTexture(family);
      textures.set(family, texture);
      material = source.clone();
      material.name = `VIDEO_REFERENCE_concourse_${family}_${source.name}`;
      material.userData = { ...source.userData, referenceMaterial: true, architecturalCategory: `reference_concourse_${family}`,
        [KEY]: { sources, registration: 'Existing authored footprint; visual surface match, dimensions approximate' } };
      delete material.userData['venueDetailFinish'];
      material.map = texture; material.color.set(0xffffff);
      material.normalMap = material.bumpMap = material.roughnessMap = material.metalnessMap = null;
      material.roughness = family === 'paving' ? .38 : .85;
      material.metalness = .025; material.envMapIntensity = family === 'paving' ? .7 : .35;
      material.needsUpdate = true;
      const choices = variants.get(source) ?? new Map<Finish, T.MeshStandardMaterial>();
      choices.set(family, material); variants.set(source, choices);
    }
    const oldGeometry = object.geometry as T.BufferGeometry;
    const geometry = oldGeometry.clone();
    geometry.setAttribute('uv1', finishCoordinates(geometry, object.matrixWorld, family));
    object.geometry = geometry; object.material = material;
    object.userData[KEY] = { finish: family, sources, geometryChanged: false };
    replacedGeometry.add(oldGeometry); replacedMaterials.add(source); coverage[family]++;
  });
  // A shared source can still serve a different part of the venue.
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    replacedGeometry.delete(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) replacedMaterials.delete(material);
  });
  replacedGeometry.forEach(geometry => geometry.dispose());
  replacedMaterials.forEach(material => material.dispose());
  root.userData[ROOT_KEY] = true;
  root.userData[KEY] = { coverage, sources, textureCount: textures.size,
    registration: 'Source-model covered routes and sandstone pavilion footprints retained',
    uncertainties: ['Absolute dimensions remain approximate', 'Ground-photo detail placement follows the authored model',
      'References do not verify every existing pavilion location'] };
}

/** Some canopy runs cross a broad plaza instead of a separately named path.
 * Project the actual registered infill footprint to grade so those sections
 * receive exactly the same world-aligned pattern, including all bends. */
export function prepareCoveredConcourseFloor(root: T.Group): void {
  if (root.getObjectByName('PHOTO_covered_walk_continuous_paving')) return;
  const roof = root.getObjectByName('REFERENCE_canopy_perforated_infill') as T.Mesh | undefined;
  let material: T.MeshStandardMaterial | undefined;
  root.traverse(o => {
    if (o instanceof T.Mesh && o.userData[KEY]?.finish === 'paving') material ??= o.material as T.MeshStandardMaterial;
  });
  if (!roof || !material) return;
  root.updateMatrixWorld(true);
  const geometry = roof.geometry.clone();
  geometry.applyMatrix4(root.matrixWorld.clone().invert().multiply(roof.matrixWorld));
  const points = geometry.getAttribute('position');
  for (let i = 0; i < points.count; i++) points.setY(i, .186);
  const positions = Array.from(points.array), indices = Array.from(geometry.index!.array);
  let fountainTriangles = 0;
  // The curved fountain shelter retains its original roof. Include its actual
  // footprint too, without extending the finish across the basin or plaza.
  root.traverse(o => {
    if (!(o instanceof T.Mesh) || !/PHOTO_MUSICAL_FOUNTAIN_outer_curved_shelter_roof_panels/.test(`${o.name} ${o.parent?.name}`)) return;
    const source = o.geometry, attr = source.getAttribute('position');
    const transform = root.matrixWorld.clone().invert().multiply(o.matrixWorld), seen = new Set<string>();
    for (let i = 0; i < (source.index?.count ?? attr.count); i += 3) {
      const triangle = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(attr, source.index ? source.index.getX(i + k) : i + k).applyMatrix4(transform));
      const normal = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).normalize();
      if (Math.abs(normal.y) < .8) continue;
      const key = triangle.map(p => `${p.x.toFixed(4)},${p.z.toFixed(4)}`).sort().join(';');
      if (seen.has(key)) continue;
      seen.add(key);
      const offset = positions.length / 3;
      triangle.forEach(p => positions.push(p.x, .186, p.z));
      indices.push(offset, offset + (normal.y > 0 ? 1 : 2), offset + (normal.y > 0 ? 2 : 1));
      fountainTriangles++;
    }
  });
  geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute('uv1', finishCoordinates(geometry, root.matrixWorld, 'paving'));
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(id => new T.Vector3().fromArray(positions, id * 3));
    if (b.sub(a).cross(c.sub(a)).y < 0) {
      geometry.index!.setX(i, indices[i + 2]); geometry.index!.setX(i + 2, indices[i]);
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const floor = new T.Mesh(geometry, material); floor.name = 'PHOTO_covered_walk_continuous_paving';
  floor.receiveShadow = true; floor.userData['continuousCoveredFloor'] = true;
  root.add(floor);
  root.userData['coveredFloorCoverage'] = { roofQuads: points.count / 4, fountainTriangles, sharedTexture: true, groundHeight: .186 };
}

function finishCoordinates(geometry: T.BufferGeometry, world: T.Matrix4, finish: Finish): T.BufferAttribute {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const values = new Float32Array(positions.count * 2);
  const point = new T.Vector3(), normal = new T.Vector3(), matrix = new T.Matrix3().getNormalMatrix(world);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(world);
    const s = .5 * point.x - Math.sqrt(3) / 2 * point.z;
    const t = Math.sqrt(3) / 2 * point.x + .5 * point.z;
    normal.set(0, 1, 0);
    if (normals) normal.fromBufferAttribute(normals, i).applyMatrix3(matrix).normalize();
    const ns = .5 * normal.x - Math.sqrt(3) / 2 * normal.z;
    const nt = Math.sqrt(3) / 2 * normal.x + .5 * normal.z;
    values[i * 2] = finish === 'paving' ? s / 8 : (Math.abs(nt) >= Math.abs(ns) ? s : t) / 2.4;
    values[i * 2 + 1] = finish === 'paving' ? t / 8 : (Math.abs(normal.y) > .65 ? t : point.y) / 1.6;
  }
  return new T.BufferAttribute(values, 2);
}

/** Two shared 512px atlases, no added meshes or per-frame work. Pattern scale is
 * an explicit visual estimate; the source videos do not provide measurements.
 */
function createFinishTexture(finish: Finish): T.DataTexture {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color: number[];
    if (finish === 'paving') {
      const diagonalA = (x + y) % 256, diagonalB = (x - y + size * 2) % 256;
      const band = diagonalA < 10 || diagonalB < 10;
      const joint = x % 40 < 1 || y % 40 < 1;
      const diamond = (Math.floor((x + y) / 256) + Math.floor((x - y + size * 2) / 256)) % 2;
      const variation = (Math.floor(x / 40) * 13 + Math.floor(y / 40) * 7) % 9 - 4;
      const vein = Math.sin(x * .11 + Math.sin(y * .027) * 3) * 2;
      const stone = diamond ? [157, 140, 113] : [136, 113, 94];
      color = band ? [58, 66, 62] : joint ? [117, 111, 98] : stone.map(c => c + variation + vein);
    } else {
      const course = Math.floor(y / 128), column = Math.floor((x + (course % 2) * 128) / 256);
      const joint = y % 128 < 2 || (x + (course % 2) * 128) % 256 < 2;
      const variation = (course * 5 + column * 3) % 11 - 5;
      color = joint ? [124, 79, 72] : [173 + variation, 114 + variation, 105 + variation];
    }
    // Deterministic low contrast grain avoids flat color without visible noise.
    const grain = ((x * 17 + y * 31 + (x * y) % 23) % 5) - 2;
    const offset = (y * size + x) * 4;
    pixels[offset] = color[0] + grain; pixels[offset + 1] = color[1] + grain;
    pixels[offset + 2] = color[2] + grain; pixels[offset + 3] = 255;
  }
  const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
  texture.name = `Video concourse ${finish}`; texture.colorSpace = T.SRGBColorSpace; texture.channel = 1;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}
