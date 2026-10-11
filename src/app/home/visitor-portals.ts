import * as T from 'three';
import { VisitorPortal, portalCoordinates } from './visitor-navigation';
import { VISITOR_ENTRANCE_LINING, VISITOR_RAMP_LANDING } from './visitor-doorway';
import { createVisitorOpeningEffect } from './visitor-opening-effect';

/** Door markers and local facade openings exist only during a visit. */
export function createVisitorPortals(root: T.Group, portals: VisitorPortal[], scene: T.Scene, interiorLayer?: T.Group) {
  const group = new T.Group(); group.name = 'Visitor entrances'; group.visible = false; scene.add(group);
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures: T.Texture[] = [];
  const frames = new Map<VisitorPortal, { doors: T.Mesh[]; amount: number; open: boolean }>();
  const trim = new T.MeshStandardMaterial({ color: '#decdb0', roughness: .85 }); materials.add(trim);
  const glass = new T.MeshStandardMaterial({ color: '#4b7380', roughness: .25, metalness: .2, transparent: true, opacity: .6 }); materials.add(glass);
  const rampMaterial = new T.MeshStandardMaterial({ color: '#a39d8e', roughness: .95 }); materials.add(rampMaterial);
  function box(parent: T.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material) {
    const geometry = new T.BoxGeometry(w, h, d); geometries.add(geometry);
    const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  for (const portal of portals) {
    const entry = new T.Group(); entry.position.copy(portal.position);
    entry.rotation.y = Math.atan2(portal.outward.x, portal.outward.z); group.add(entry);
    for (const side of [-1, 1]) box(entry, .18, 3.8, .3, side * (portal.width / 2 + .09), 1.9, 0, trim);
    box(entry, portal.width + .36, .24, .3, 0, 3.8, 0, trim);
    const doors = [-1, 1].map(side => box(entry, portal.width / 2, 3.65, .07, side * portal.width / 4, 1.825, 0, glass));
    frames.set(portal, { doors, amount: 0, open: false });
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#283b36'; ctx.fillRect(0, 0, 512, 112);
    ctx.fillStyle = '#f8f4e9'; ctx.font = '600 34px Arial'; ctx.textAlign = 'center';
    ctx.fillText(portal.hall.level ? 'Convention Centre' : portal.hall.label, 256, 46);
    ctx.font = '22px Arial'; ctx.fillText('VISITOR ENTRANCE', 256, 86);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; textures.push(texture);
    const signMaterial = new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }); materials.add(signMaterial);
    box(entry, 4.8, 1.05, .08, 0, 4.48, .02, signMaterial);
    if (portal.hall.level) {
      // The ground-floor plan sits on the model's 6.4 m podium. A visibly modelled
      // approach joins it to campus level rather than teleporting the visitor upward.
      const height = portal.position.y - .24;
      // A level landing gives the whole body room to clear the floor slab edge.
      box(entry, portal.width, .18, VISITOR_RAMP_LANDING, 0, -.09, VISITOR_RAMP_LANDING / 2, rampMaterial);
      const run = portal.approach - VISITOR_RAMP_LANDING;
      const ramp = box(entry, portal.width, .18, Math.hypot(run, height),
        0, -height / 2 - .09, VISITOR_RAMP_LANDING + run / 2, rampMaterial);
      ramp.rotation.x = Math.atan2(height, run);
    }
  }
  const gateObjects = new Map<T.Object3D, boolean>();
  const surfaces: T.Mesh[] = [];
  root.traverse(o => {
    if (o instanceof T.Mesh) surfaces.push(o);
    const names = o.name + ' ' + ((o.userData['batchSources'] as string[] | undefined)?.join(' ') ?? '');
    if (/PHOTO_GATE_6.*(?:fence_panels|pickets_and_rails)/i.test(names)) gateObjects.set(o, o.visible);
  });
  interiorLayer?.traverse(o => {
    if (o instanceof T.Mesh && VISITOR_ENTRANCE_LINING.test(o.name))
      surfaces.push(o);
  });
  const openings = createVisitorOpeningEffect(surfaces, portals);
  let enabled = false;
  return {
    cutsPoint: openings.cutsPoint,
    setEnabled(value: boolean) {
      enabled = value; group.visible = value;
      for (const [object, visible] of gateObjects) object.visible = value ? false : visible;
      openings.setEnabled(value);
    },
    update(position: T.Vector3, dt: number, speed = 0, reducedMotion = false) {
      for (const portal of portals) {
        const p = portalCoordinates(portal, position);
        const frame = frames.get(portal)!;
        const approach = Math.max(14, speed * 1.25 + 4);
        if (!enabled || Math.abs(p.across) > 9 || p.along < -14 || p.along > approach + 6) frame.open = false;
        else if (Math.abs(p.across) < 7 && p.along > -10 && p.along < approach) frame.open = true;
        frame.amount = reducedMotion ? Number(frame.open) : T.MathUtils.damp(frame.amount, Number(frame.open), 8, dt);
        frame.doors.forEach((door, i) => door.position.x = (i ? 1 : -1) * portal.width * (.25 + .49 * frame.amount));
      }
    },
    dispose() {
      this.setEnabled(false); openings.dispose(); group.removeFromParent();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    },
  };
}
