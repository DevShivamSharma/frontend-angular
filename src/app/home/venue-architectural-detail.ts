import * as T from 'three';
import { createSurfaceMaps, SurfaceMaps, SurfaceTexture } from './architectural-textures';
import { createHall14EntranceDetail } from './hall14-detail';

type Finish = SurfaceTexture | 'glass' | 'steel';
const DETAIL_KEY = 'venueDetailFinish';
const buildingName = /HALL|^PHOTO_CC|^PHOTO_ITPO|office|kiosk|pavilion|shelter|service.*(?:building|room)|hangar|canopy|checkpoint/i;
const protectedName = /label|sign|lettering|floor[ _]plan|floor[ _]plate|ground|paving|apron|kerb|road|path|pool|fountain|basin|sculpture|parking|garden|planting|tree|lawn/i;

function finishFor(material: T.MeshStandardMaterial): Finish | null {
  const category = material.userData['architecturalCategory'];
  if (category === 'glazing' || category === 'transparent_canopy') return 'glass';
  if (category === 'structure') return 'steel';
  if (category === 'cc_shell') return 'copper';
  if (category === 'facade') return 'stone';
  if (category === 'roof') return /grass|green|turf/i.test(material.name) ? null : 'metal';
  if (category === 'stone' || category === 'plinth') return /render|plinth/i.test(material.name) ? 'render' : 'stone';
  return null;
}

/** Prepare only architecture, before batching. UV0, indices and positions remain
 * byte-identical; a second UV channel carries metre-scaled detail in both palettes.
 * Shared source materials are isolated from signs, ground and reference plans.
 */
export function prepareVenueArchitecturalDetail(root: T.Group): void {
  if (root.userData['architecturalDetailPrepared']) return;
  root.userData['architecturalDetailPrepared'] = true;
  root.updateMatrixWorld(true);
  const variants = new Map<T.Material, Map<Finish, T.MeshStandardMaterial>>();
  const replacedGeometry = new Set<T.BufferGeometry>(), replacedMaterials = new Set<T.Material>();
  const coverage = new Map<string, number>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let names = '', hall: string | undefined;
    for (let n: T.Object3D | null = object; n && n !== root; n = n.parent) {
      if (n.userData['cc_level'] || n.userData['detailAccents']) return;
      names += ' ' + n.name;
      hall ??= n.userData['hall'] ? String(n.userData['hall']) : undefined;
    }
    if (protectedName.test(names) || (!hall && !buildingName.test(names.trim()))) return;
    let detailed = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const next = materials.map(material => {
      if (!(material instanceof T.MeshStandardMaterial)) return material;
      const kind = finishFor(material); if (!kind) return material;
      detailed = true;
      const choices = variants.get(material) ?? new Map<Finish, T.MeshStandardMaterial>();
      let result = choices.get(kind);
      if (!result) {
        result = material.clone(); result.userData[DETAIL_KEY] = kind;
        choices.set(kind, result); variants.set(material, choices);
      }
      replacedMaterials.add(material);
      return result;
    });
    if (!detailed) return;
    object.material = Array.isArray(object.material) ? next : next[0];
    const source = object.geometry as T.BufferGeometry;
    const geometry = object.geometry = source.clone(); replacedGeometry.add(source);
    geometry.setAttribute('uv1', detailCoordinates(geometry, object.matrixWorld));
    const identity = hall ? 'hall' + hall : /HALL_(12A|\d+)/.exec(names)?.[0].toLowerCase().replace('_', '') ??
      (/PHOTO_CC/.test(names) ? 'cc' : /office|ITPO/i.test(names) ? 'office' : 'ancillary');
    coverage.set(identity, (coverage.get(identity) ?? 0) + 1);
  });
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    replacedGeometry.delete(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) replacedMaterials.delete(material);
  });
  replacedGeometry.forEach(g => g.dispose()); replacedMaterials.forEach(m => m.dispose());
  // Hall 14's approved sample now lives at its actual position in the venue.
  if (coverage.has('hall14')) {
    const entrance = createHall14EntranceDetail();
    entrance.position.set(-223.60107421875, 0, 4.908121585845947);
    entrance.rotation.y = Math.PI / 3; root.add(entrance);
  }
  root.userData['architecturalDetailCoverage'] = Object.fromEntries(coverage);
}

function detailCoordinates(geometry: T.BufferGeometry, world: T.Matrix4): T.BufferAttribute {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const values = new Float32Array(positions.count * 2);
  const point = new T.Vector3(), normal = new T.Vector3(), normalMatrix = new T.Matrix3().getNormalMatrix(world);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(world);
    normal.set(0, 1, 0);
    if (normals) normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    // Match the campus's surveyed axes, with 1.5 m panels / 0.75 m roof seams.
    const s = .5 * point.x - .8660254038 * point.z;
    const t = .8660254038 * point.x + .5 * point.z;
    const nx = .5 * normal.x - .8660254038 * normal.z;
    const nz = .8660254038 * normal.x + .5 * normal.z;
    values[i * 2] = (Math.abs(normal.y) > .65 || Math.abs(nz) >= Math.abs(nx) ? s : t) / 6;
    values[i * 2 + 1] = (Math.abs(normal.y) > .65 ? t : point.y) / 6.2;
  }
  return new T.BufferAttribute(values, 2);
}

/** A single texture set per surface family, shared by the whole campus. */
export function createArchitecturalFinishes(anisotropy: number) {
  const maps = new Map<SurfaceTexture, SurfaceMaps>();
  const textures = new Set<T.Texture>();
  function apply(material: T.MeshStandardMaterial, natural: boolean, finish = material.userData[DETAIL_KEY] as Finish | undefined) {
    if (!finish) return;
    material.userData[DETAIL_KEY] = finish;
    if (finish === 'glass') {
      material.roughness = .13; material.metalness = .48; material.envMapIntensity = 1.7;
      if (natural && !material.map) material.color.set('#3b575c');
    } else if (finish === 'steel') {
      material.roughness = .32; material.metalness = .72;
    } else {
      let set = maps.get(finish);
      if (!set) { set = createSurfaceMaps(finish, 1, anisotropy); maps.set(finish, set); Object.values(set).forEach(t => textures.add(t)); }
      // Keep any supplied photographic / colour texture on UV0.
      material.map ??= set.color; material.bumpMap ??= set.height; material.roughnessMap ??= set.roughness;
      material.bumpScale = finish === 'render' ? .014 : finish === 'metal' ? .045 : .03;
      material.roughness = finish === 'metal' || finish === 'copper' ? .68 : .88;
      material.metalness = finish === 'metal' || finish === 'copper' ? .56 : .06;
      if (natural) {
        if (finish === 'metal') material.color.set(/pale|white/i.test(material.name) ? '#b8b9b0' : /oxide/i.test(material.name) ? '#696955' : '#58635f');
        if (finish === 'copper') material.color.set('#ab8968');
        if (finish === 'stone') {
          const variation = Number(/Cladding (\d)/.exec(material.name)?.[1] ?? 3);
          material.color.set(/sandstone|terracotta/i.test(material.name) ? '#bca28b' : '#bbb5a4').multiplyScalar(.94 + variation * .018);
        }
        if (finish === 'render') material.color.set(/plinth/i.test(material.name) ? '#898a7e' : '#cac5b5');
      }
    }
    material.needsUpdate = true;
  }
  return { apply, textures, finishOf: (material: T.Material) => material.userData[DETAIL_KEY] as Finish | undefined };
}
