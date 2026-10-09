import * as T from 'three';
import { VisitorPortal, portalCoordinates } from './visitor-navigation';

/** Door markers and local facade openings exist only during a visit. */
export function createVisitorPortals(root: T.Group, portals: VisitorPortal[], scene: T.Scene) {
  const group = new T.Group(); group.name = 'Visitor entrances'; group.visible = false; scene.add(group);
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures: T.Texture[] = [];
  const frames = new Map<VisitorPortal, { doors: T.Mesh[]; amount: number }>();
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
    frames.set(portal, { doors, amount: 0 });
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
      const ramp = box(entry, portal.width, .18, Math.hypot(portal.approach, height),
        0, -height / 2 - .09, portal.approach / 2, rampMaterial);
      ramp.rotation.x = Math.atan2(height, portal.approach);
    }
  }
  const originals = new Map<T.Material, { planes: T.Plane[] | null; intersection: boolean }>();
  const gateObjects = new Map<T.Object3D, boolean>();
  const surfaces: { bounds: T.Box3; materials: T.Material[] }[] = [];
  root.traverse(o => {
    if (o instanceof T.Mesh) surfaces.push({ bounds: new T.Box3().setFromObject(o), materials: Array.isArray(o.material) ? o.material : [o.material] });
    const names = o.name + ' ' + ((o.userData['batchSources'] as string[] | undefined)?.join(' ') ?? '');
    if (/PHOTO_GATE_6.*(?:fence_panels|pickets_and_rails)/i.test(names)) gateObjects.set(o, o.visible);
  });
  let current: VisitorPortal | undefined, enabled = false;
  function cut(portal?: VisitorPortal) {
    if (current === portal) return;
    current = portal;
    for (const [m, original] of originals) {
      m.clippingPlanes = original.planes; m.clipIntersection = original.intersection; m.needsUpdate = true;
    }
    originals.clear();
    if (!portal) return;
    const n = portal.outward, t = new T.Vector3(n.z, 0, -n.x), p = portal.position;
    const planes = [
      new T.Plane(t.clone(), -t.dot(p) - portal.width / 2),
      new T.Plane(t.clone().negate(), t.dot(p) - portal.width / 2),
      new T.Plane(n.clone(), -n.dot(p) - 2),
      new T.Plane(n.clone().negate(), n.dot(p) - 9),
      new T.Plane(new T.Vector3(0, 1, 0), -p.y - 3.7),
      new T.Plane(new T.Vector3(0, -1, 0), p.y + .08),
    ];
    const nearbyMaterials = new Set<T.Material>();
    const doorwayBounds = new T.Box3().setFromCenterAndSize(p.clone().add(new T.Vector3(0, 1.8, 0)), new T.Vector3(24, 4.5, 24));
    for (const surface of surfaces) if (surface.bounds.intersectsBox(doorwayBounds))
      surface.materials.forEach(m => nearbyMaterials.add(m));
    for (const m of nearbyMaterials) {
      originals.set(m, { planes: m.clippingPlanes, intersection: m.clipIntersection });
      m.clippingPlanes = planes; m.clipIntersection = true; m.needsUpdate = true;
    }
  }
  return {
    setEnabled(value: boolean) {
      enabled = value; group.visible = value;
      for (const [object, visible] of gateObjects) object.visible = value ? false : visible;
      if (!value) cut();
    },
    update(position: T.Vector3, dt: number, indoor?: string) {
      let nearest: VisitorPortal | undefined;
      for (const portal of portals) {
        const p = portalCoordinates(portal, position);
        if (Math.abs(p.across) < 7 && Math.abs(p.along) < 15) nearest = portal;
        const frame = frames.get(portal)!;
        const open = enabled && Math.abs(p.across) < 7 && Math.abs(p.along) < 12;
        frame.amount = T.MathUtils.damp(frame.amount, open ? 1 : 0, 8, dt);
        frame.doors.forEach((door, i) => door.position.x = (i ? 1 : -1) * portal.width * (.25 + .49 * frame.amount));
        frame.doors[0].parent!.visible = !indoor || indoor === portal.hall.id;
      }
      cut(enabled ? nearest : undefined);
    },
    dispose() {
      this.setEnabled(false); group.removeFromParent();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    },
  };
}
