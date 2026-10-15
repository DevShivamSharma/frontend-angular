import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { VisitorState } from './venue-visitor';
import { trimGate9Context } from './venue-gate9-trim';

export interface Gate9Light { kind: 'lamp' | 'flood' | 'canopy' | 'kiosk' | 'cabin'; position: [number, number, number]; aim?: [number, number, number]; }
export interface Gate9Guard { id: string; position: [number, number, number]; facing: [number, number, number]; }
interface Gate9Registration {
  status: string;
  gateCenter: [number, number, number];
  slideDirection: [number, number, number];
  slideDistance: number;
  views: Record<string, { position: [number, number, number]; target: [number, number, number]; label: string }>;
  /** 2026-10-15 additions: lamp positions for night lighting, hinged boom arms and staff positions. */
  lights?: Gate9Light[];
  barriers?: { name: string; hinge: [number, number, number]; axis: [number, number, number]; length: number }[];
  guards?: Gate9Guard[];
}
const BARRIER_LIFT = T.MathUtils.degToRad(82);

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
  const arms: { object: T.Object3D; rest: T.Quaternion; raised: T.Quaternion }[] = [];
  scene.traverse(object => {
    if (object.name.startsWith('GATE9_moving_leaf_')) {
      object.userData['dynamicGate9'] = true;
      leaves.push({ object, origin: object.position.clone(), sign: object.name.endsWith('left') ? -1 : 1 });
    }
    const barrier = registration.barriers?.find(b => object.name === b.name || object.name.startsWith(b.name + '.'));
    if (barrier) {
      // The arm mesh sits at its hinge; it swings about the gate's inward axis.
      // Pick the rotation sense that lifts the arm's tip rather than burying it.
      object.userData['dynamicGate9'] = true;
      const axis = new T.Vector3(...barrier.axis).normalize();
      object.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(object), tip = bounds.getCenter(new T.Vector3()).sub(object.getWorldPosition(new T.Vector3()));
      const lifted = tip.clone().applyAxisAngle(axis, BARRIER_LIFT);
      const sense = lifted.y >= tip.y ? 1 : -1;
      const rest = object.quaternion.clone();
      arms.push({ object, rest, raised: new T.Quaternion().setFromAxisAngle(axis, sense * BARRIER_LIFT).multiply(rest) });
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
  // The arm meshes are not batched (dynamicGate9), so the hinge transform stays live.
  const arrival = new T.Vector3(...registration.views['gate9-approach'].position);
  arrival.y = center.y;
  let target = 0, opening = 0, previous = 0, visitorNear = false, visitorActive = false;
  const near = (x: number, z: number, open: boolean, inside = 24, outside = 32) =>
    Math.hypot(x - center.x, z - center.z) < (open ? outside : inside);
  return {
    views: registration.views,
    lights: registration.lights ?? [],
    guards: registration.guards ?? [],
    arrival: { position: arrival, heading: Math.atan2(center.x - arrival.x, center.z - arrival.z), label: 'Gate 9' },
    visitorChanged(state: VisitorState) {
      // Open well before even fast movement reaches the leaf; retain hysteresis.
      visitorActive = state.active;
      visitorNear = state.active && near(state.position[0], state.position[2], target === 1);
    },
    /** Camera-driven opening when no visitor walks: orbiting close to the gate opens it too. */
    update(now: number, reducedMotion: boolean, camera?: T.Vector3) {
      const cameraNear = !visitorActive && !!camera && camera.y < 40 && near(camera.x, camera.z, target === 1, 30, 38);
      target = visitorNear || cameraNear ? 1 : 0;
      const dt = previous ? Math.min(.05, (now - previous) / 1000) : 0;
      previous = now;
      if (opening === target) return false;
      opening = reducedMotion ? target : T.MathUtils.clamp(opening + Math.sign(target - opening) * dt * 1.5, 0, 1);
      const eased = opening * opening * (3 - 2 * opening);
      for (const leaf of leaves) leaf.object.position.copy(leaf.origin).addScaledVector(direction, leaf.sign * eased * registration.slideDistance);
      // Boom arms lead the leaves slightly, as staff raise them while the gate still slides.
      const lift = T.MathUtils.clamp(opening * 1.3, 0, 1), armEased = lift * lift * (3 - 2 * lift);
      for (const arm of arms) arm.object.quaternion.slerpQuaternions(arm.rest, arm.raised, armEased);
      return true;
    },
  };
}
