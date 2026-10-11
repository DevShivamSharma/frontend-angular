import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VisitorNavigation } from './visitor-navigation';
import { planEntranceGuards } from './venue-security-placement';

export const SECURITY_GUARD_HEIGHT = 1.85;
export const SECURITY_GUARD_RADIUS = .42;
const DETAIL_PIXELS = 65;

/** Static staff share geometry, PBR textures and two instanced draw batches.
 * Only nearby people need the detailed mesh; there is no animation clock. */
export async function createVenueSecurityGuards(options: {
  renderer: T.WebGLRenderer;
  navigation: VisitorNavigation;
  asset: (path: string) => string;
  signal: AbortSignal;
}) {
  const { renderer, navigation, asset, signal } = options;
  const response = await fetch(asset('characters/security-guard.glb'), { signal });
  if (!response.ok) throw new Error(`Security model could not load (${response.status})`);
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  gltf.scene.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  const group = new T.Group(); group.name = 'Hall entrance security';
  const batches: T.InstancedMesh[] = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent(); group.clear(); gltf.scene.clear();
    for (const batch of batches) batch.dispose();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => {
      texture.dispose();
      const image = texture.source?.data;
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    });
    if (navigation.guards === placements) navigation.guards = [];
  }
  let placements: ReturnType<typeof planEntranceGuards> = [];
  try {
    signal.throwIfAborted();
    gltf.scene.updateMatrixWorld(true);
    const highRoot = gltf.scene.getObjectByName('Guard_High');
    const lowRoot = gltf.scene.getObjectByName('Guard_Low');
    if (!highRoot || !lowRoot) throw new Error('Security model is missing its detail levels');
    const bounds = new T.Box3().setFromObject(highRoot), size = bounds.getSize(new T.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Security model has invalid bounds');
    const center = bounds.getCenter(new T.Vector3()), scale = SECURITY_GUARD_HEIGHT / size.y;
    // The supplied person faces +X. Normalize to +Z, the navigation heading,
    // with feet at zero before placing the shared geometry at campus grade.
    const normalization = new T.Matrix4().makeRotationY(-Math.PI / 2)
      .multiply(new T.Matrix4().makeScale(scale, scale, scale))
      .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    placements = planEntranceGuards(navigation, { radius: SECURITY_GUARD_RADIUS, height: SECURITY_GUARD_HEIGHT });
    if (placements.length !== navigation.portals.length * 2)
      throw new Error('Security placement must keep two clear positions per entrance');
    const transforms = placements.map(guard => new T.Matrix4().compose(guard.position,
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), guard.heading), new T.Vector3(1, 1, 1)));
    const detailBatches: T.InstancedMesh[][] = [[], []];
    for (const [detail, source] of [lowRoot, highRoot].entries()) source.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      if (object instanceof T.SkinnedMesh) throw new Error('The supplied security model must have its standing pose baked');
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(normalization);
      geometries.add(geometry);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const batch = new T.InstancedMesh(geometry, object.material, placements.length);
      batch.name = detail ? 'Security guards · near detail' : 'Security guards · distance detail';
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      batch.castShadow = true; batch.receiveShadow = true;
      batch.count = 0; batch.visible = false;
      // Character collision uses the small body cylinders, never these triangles.
      batch.raycast = () => {};
      batches.push(batch); detailBatches[detail].push(batch); group.add(batch);
    });
    for (const texture of textures) texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    // Campus shadow bias is sized for buildings. A shared, feathered contact
    // patch anchors shoes without increasing shadow resolution or per-frame work.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,.30)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const contactTexture = new T.CanvasTexture(canvas); textures.add(contactTexture);
    const contactMaterial = new T.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false });
    materials.add(contactMaterial);
    const contactGeometry = new T.PlaneGeometry(.95, .70).rotateX(-Math.PI / 2); geometries.add(contactGeometry);
    const contact = new T.InstancedMesh(contactGeometry, contactMaterial, placements.length);
    contact.name = 'Security guards · contact shadows'; contact.raycast = () => {};
    placements.forEach((guard, index) => contact.setMatrixAt(index, new T.Matrix4().compose(
      guard.position.clone().add(new T.Vector3(0, .012, 0)),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), guard.heading), new T.Vector3(1, 1, 1))));
    contact.computeBoundingSphere(); batches.push(contact); group.add(contact);
    group.userData = { securityGuards: placements.map(guard => ({ id: guard.id, portalId: guard.portalId,
      position: guard.position.toArray(), heading: guard.heading, height: guard.height, radius: guard.radius })),
      source: 'Supplied security-person GLB', guardCount: placements.length, animated: false };
    navigation.guards = placements;
    const previous = new Int8Array(placements.length).fill(-1);
    const membership = [[], []] as number[][];
    return { group, placements, dispose,
      /** Returns true only when a static shadow map needs the new detail batches. */
      update(camera: T.PerspectiveCamera, viewportHeight: number, visible = true): boolean {
        if (disposed) return false;
        const visibilityChanged = group.visible !== visible;
        group.visible = visible;
        if (!visible) return visibilityChanged;
        const pixelsPerMeter = viewportHeight / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
        let changed = false;
        membership[0].length = membership[1].length = 0;
        placements.forEach((guard, index) => {
          const pixels = SECURITY_GUARD_HEIGHT * pixelsPerMeter / Math.max(1, camera.position.distanceTo(guard.position));
          // Hysteresis prevents a person/shadow alternating at the detail boundary.
          const detailed = pixels > DETAIL_PIXELS * (previous[index] === 1 ? .88 : 1.08);
          const detail = detailed ? 1 : 0;
          if (previous[index] !== detail) { previous[index] = detail; changed = true; }
          membership[detail].push(index);
        });
        if (!changed) return visibilityChanged;
        for (const [detail, members] of membership.entries()) for (const batch of detailBatches[detail]) {
          batch.count = members.length; batch.visible = members.length > 0;
          members.forEach((guardIndex, instanceIndex) => batch.setMatrixAt(instanceIndex, transforms[guardIndex]));
          batch.instanceMatrix.needsUpdate = true;
          batch.computeBoundingSphere();
        }
        return true;
      }
    };
  } catch (error) { dispose(); throw error; }
}
