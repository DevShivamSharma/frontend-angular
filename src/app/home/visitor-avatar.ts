import * as T from 'three';

/** An original, metre-scale character. No remote model, skeleton or texture downloads. */
export function createVisitorAvatar() {
  const root = new T.Group();
  root.name = 'Visitor';
  const body = new T.Group();
  root.add(body);
  const materials = {
    shirt: new T.MeshStandardMaterial({ color: '#376b88', roughness: .88 }),
    trousers: new T.MeshStandardMaterial({ color: '#d3c5ab', roughness: .95 }),
    skin: new T.MeshStandardMaterial({ color: '#b87a50', roughness: .86 }),
    hair: new T.MeshStandardMaterial({ color: '#29221e', roughness: 1 }),
    shoes: new T.MeshStandardMaterial({ color: '#eee9db', roughness: .9 }),
    dark: new T.MeshStandardMaterial({ color: '#27313a', roughness: .9 }),
    badge: new T.MeshStandardMaterial({ color: '#f8f4e9', roughness: .8 }),
  };
  const geometries = new Set<T.BufferGeometry>();
  function mesh(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material,
    x: number, y: number, z: number) {
    geometries.add(geometry);
    const object = new T.Mesh(geometry, material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  const capsule = (r: number, h: number) => new T.CapsuleGeometry(r, h, 4, 10);
  const torso = mesh(body, capsule(.19, .34), materials.shirt, 0, 1.17, 0);
  torso.scale.set(1.2, 1, .65);
  mesh(body, new T.CylinderGeometry(.065, .07, .12, 10), materials.skin, 0, 1.49, 0);
  const head = mesh(body, new T.SphereGeometry(.13, 16, 12), materials.skin, 0, 1.65, .005);
  head.scale.set(.84, 1.15, .9);
  const hair = mesh(body, new T.SphereGeometry(.132, 16, 10, 0, Math.PI * 2, 0, 1.7),
    materials.hair, 0, 1.68, -.014);
  hair.scale.set(.9, 1, .94);
  mesh(body, new T.SphereGeometry(.025, 8, 6), materials.skin, 0, 1.635, .116);
  for (const x of [-.043, .043])
    mesh(body, new T.SphereGeometry(.009, 6, 4), materials.dark, x, 1.67, .109);
  for (const x of [-.055, .055]) {
    const strap = mesh(body, new T.BoxGeometry(.013, .25, .012), materials.dark, x, 1.30, .133);
    strap.rotation.z = x < 0 ? -.2 : .2;
  }
  mesh(body, new T.BoxGeometry(.088, .12, .015), materials.badge, 0, 1.13, .144);
  mesh(body, new T.BoxGeometry(.056, .014, .018), materials.shirt, 0, 1.15, .149);
  const arms: T.Group[] = [], forearms: T.Group[] = [], legs: T.Group[] = [], knees: T.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new T.Group(); arm.position.set(side * .265, 1.38, 0); body.add(arm); arms.push(arm);
    mesh(arm, capsule(.066, .15), materials.shirt, 0, -.12, 0);
    const forearm = new T.Group(); forearm.position.y = -.27; arm.add(forearm); forearms.push(forearm);
    mesh(forearm, capsule(.048, .16), materials.skin, 0, -.1, 0);
    mesh(forearm, capsule(.048, .045), materials.skin, 0, -.24, .01);
    const leg = new T.Group(); leg.position.set(side * .115, .94, 0); body.add(leg); legs.push(leg);
    mesh(leg, capsule(.095, .25), materials.trousers, 0, -.19, 0);
    const knee = new T.Group(); knee.position.y = -.41; leg.add(knee); knees.push(knee);
    mesh(knee, capsule(.075, .27), materials.trousers, 0, -.19, 0);
    const shoe = mesh(knee, new T.BoxGeometry(.15, .1, .29), materials.shoes, 0, -.44, .065);
    mesh(shoe, new T.BoxGeometry(.15, .025, .29), materials.dark, 0, -.045, 0);
  }
  // Contact shadow stays with the feet without forcing a campus-wide shadow render per step.
  const shadowMaterial = new T.MeshBasicMaterial({ color: '#17232b', transparent: true, opacity: .18, depthWrite: false });
  const shadow = mesh(root, new T.CircleGeometry(.37, 24), shadowMaterial, 0, .018, 0);
  shadow.rotation.x = -Math.PI / 2; shadow.scale.y = .7;
  let stride = 0, blend = 0;
  return {
    root,
    update(dt: number, speed: number, reducedMotion: boolean) {
      blend = T.MathUtils.damp(blend, Math.min(1, speed / 1.5), 12, dt);
      stride += dt * speed * 4.5;
      const swing = Math.sin(stride) * .55 * blend;
      legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
      knees[0].rotation.x = Math.max(0, -swing) * 1.25;
      knees[1].rotation.x = Math.max(0, swing) * 1.25;
      arms[0].rotation.x = -swing * .7; arms[1].rotation.x = swing * .7;
      forearms.forEach(a => a.rotation.x = -.12 - blend * .16);
      body.position.y = reducedMotion ? 0 : Math.abs(Math.cos(stride)) * .028 * blend;
      return blend > .002;
    },
    dispose() {
      root.removeFromParent();
      geometries.forEach(g => g.dispose());
      Object.values(materials).forEach(m => m.dispose());
      shadowMaterial.dispose();
    },
  };
}
