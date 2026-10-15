import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { VisitorState } from './venue-visitor';
import { trimGate9Context } from './venue-gate9-trim';

interface Gate9Registration {
  status: string;
  gateCenter: [number, number, number];
  slideDirection: [number, number, number];
  slideDistance: number;
  views: Record<string, { position: [number, number, number]; target: [number, number, number]; label: string }>;
}

/** Independent Blender layer. Existing halls and the source venue remain intact. */
export async function prepareGate9(root: T.Group, asset: (path: string) => string, signal: AbortSignal) {
  const [model, metadata] = await Promise.all([
    fetch(asset('gate9-detail.glb'), { signal }), fetch(asset('gate9-detail.json'), { signal }),
  ]);
  if (!model.ok || !metadata.ok) throw new Error('Gate 9 detail unavailable');
  const [bytes, registration] = await Promise.all([
    model.arrayBuffer(), metadata.json() as Promise<Gate9Registration>,
  ]);
  signal.throwIfAborted();
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '');
  scene.name = 'GATE9 photographic entrance';
  root.add(scene); // Scene ownership includes disposal after an aborted load.
  signal.throwIfAborted();
  trimGate9Context(root, scene);
  const leaves: { object: T.Object3D; origin: T.Vector3; sign: number }[] = [];
  scene.traverse(object => {
    if (object.name.startsWith('GATE9_moving_leaf_')) {
      object.userData['dynamicGate9'] = true;
      leaves.push({ object, origin: object.position.clone(), sign: object.name.endsWith('left') ? -1 : 1 });
    }
    if (object instanceof T.Mesh) {
      object.userData['destinationId'] = 'gate9';
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.side = T.DoubleSide;
      }
    }
  });
  // Hide descendants too: static batching lifts meshes into the root.
  const replaced = new Set<T.Material>();
  root.traverse(object => {
    // The two inferred context masses are retained in the Blender layer with
    // just their canopy-court overlap removed and the resulting cut closed.
    if (/^(PHOTO_GATE_9[ _]|GATE_9_SIGN_|SITE_northwest-office-(courtyard-wing|link)_)/.test(object.name) || object.name === 'SITE_DETAIL_itpo_exterior') {
      object.traverse(child => {
        child.visible = false;
        child.userData['supersededBySiteReference'] = true;
      });
    }
    let officeStructure = false;
    for (let node: T.Object3D | null = object; node; node = node.parent)
      officeStructure ||= /^PHOTO_ITPO[ _]office[ _]sandstone[ _]structure$/.test(node.name);
    if (object instanceof T.Mesh && officeStructure) {
      const tint = (material: T.Material) => {
        const copy = material.clone() as T.MeshStandardMaterial;
        copy.name = 'G9 ITPO red sandstone';
        copy.userData = {};
        if (/sandstone/i.test(material.name)) copy.color.setRGB(.28, .105, .072);
        copy.roughness = .88;
        return copy;
      };
      const old = Array.isArray(object.material) ? object.material : [object.material];
      old.forEach(material => replaced.add(material));
      object.material = Array.isArray(object.material) ? old.map(tint) : tint(old[0]);
      // Source materials can be shared by other buildings; normal root cleanup
      // owns them. Do not dispose a shared hall material here.
    }
  });
  root.traverse(object => {
    if (object instanceof T.Mesh)
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => replaced.delete(material));
  });
  replaced.forEach(material => material.dispose());
  const center = new T.Vector3(...registration.gateCenter);
  const direction = new T.Vector3(...registration.slideDirection).normalize();
  const arrival = new T.Vector3(...registration.views['gate9-approach'].position);
  arrival.y = center.y;
  let target = 0, opening = 0, previous = 0;
  return {
    views: registration.views,
    arrival: { position: arrival, heading: Math.atan2(center.x - arrival.x, center.z - arrival.z), label: 'Gate 9' },
    visitorChanged(state: VisitorState) {
      // Open well before even fast movement reaches the leaf; retain hysteresis.
      const distance = Math.hypot(state.position[0] - center.x, state.position[2] - center.z);
      target = state.active && distance < (target ? 32 : 24) ? 1 : 0;
    },
    update(now: number, reducedMotion: boolean) {
      const dt = previous ? Math.min(.05, (now - previous) / 1000) : 0;
      previous = now;
      if (opening === target) return false;
      opening = reducedMotion ? target : T.MathUtils.clamp(opening + Math.sign(target - opening) * dt * 1.5, 0, 1);
      const eased = opening * opening * (3 - 2 * opening);
      for (const leaf of leaves) leaf.object.position.copy(leaf.origin).addScaledVector(direction, leaf.sign * eased * registration.slideDistance);
      return true;
    },
  };
}
