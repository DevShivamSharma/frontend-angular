import * as T from 'three';

type Finish = 'paving' | 'sandstone';
const KEY = 'referenceConcourse';
const ROOT_KEY = 'referenceConcoursePrepared';
const routes = new Set([
  'photo path central covered promenade paving',
  'photo path hall 1 to hall 6 covered promenade paving'
]);
const pavilions = new Set([
  'photo central plaza sandstone kiosks',
  'photo central garden sandstone display portals'
]);
const sources = [
  'DJI_20250217163819_0039_D.MP4 @00:09,00:40.5',
  'DJI_20250217163917_0040_D.MP4 @00:00,00:33'
];
const normalized = (name: string) => name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Reference finishes only: the authored route boundaries, elevations, portals
 * and collision surfaces are unchanged. Exact tactile alignment is not surveyed,
 * so the video does not justify adding new strips, paths or pavilion geometry.
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
      material.roughness = family === 'paving' ? .52 : .85;
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
    uncertainties: ['Absolute dimensions remain approximate', 'Tactile-strip placement is not registered; no strips added',
      'Event booths, banners and service equipment excluded', 'Video references do not verify every existing pavilion location'] };
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
      const band = x < 20 || y < 20;
      const joint = x % 64 < 1 || y % 64 < 1;
      const variation = (Math.floor(x / 64) * 13 + Math.floor(y / 64) * 7) % 9 - 4;
      color = band ? [158, 161, 154] : joint ? [116, 119, 114] : [76 + variation, 82 + variation, 80 + variation];
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
