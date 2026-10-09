import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCCInteriors, CCRoomVisit } from './cc-interiors';

type Point = [number, number];
export interface InteriorHall {
  id: string;
  label: string;
  center: T.Vector3;
  angle: number;
  width: number;
  depth: number;
  height: number;
  outline: Point[];
  entrance: Point;
  roofs: T.Object3D[];
  level?: number;
  rooms?: CCRoomVisit[];
  route?: Point[];
  elevation?: (x: number, z: number) => number;
}
export interface InteriorState {
  hall: string;
  walking: boolean;
  touring: boolean;
  paused: boolean;
  preview?: boolean;
}
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function hull(points: Point[]): Point[] {
  const sorted = [
    ...new Map(points.map((p) => [p.map((v) => v.toFixed(3)).join(','), p])).values(),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const side = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...side(sorted), ...side([...sorted].reverse())];
}
function pointsOf(object: T.Object3D): T.Vector3[] {
  const points: T.Vector3[] = [];
  object.traverse((o) => {
    if (o instanceof T.Mesh) {
      const p = o.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++)
        points.push(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
    }
  });
  return points;
}
/** Fit to the incumbent roof geometry, never to the reference building coordinates. */
export function measureInteriorHalls(root: T.Object3D): InteriorHall[] {
  root.updateMatrixWorld(true);
  const halls: InteriorHall[] = [];
  const named = (name: string) => {
    let found: T.Object3D | undefined;
    root.traverse((o) => {
      if (o.name.replace(/_/g, ' ') === name.replace(/_/g, ' ')) found = o;
    });
    return found;
  };
  for (const id of ['1', '2', '3', '4', '5', '14']) {
    const roof = named(
      `PHOTO_HALL_${id} ${['1', '14'].includes(id) ? 'standing seam roof' : 'roof'}`,
    );
    if (!roof) continue;
    const points = pointsOf(roof),
      outline = hull(points.map((p) => [p.x, p.z]));
    if (outline.length < 3) continue;
    let best:
      | { area: number; angle: number; minX: number; maxX: number; minZ: number; maxZ: number }
      | undefined;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length],
        angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
        c = Math.cos(angle),
        s = Math.sin(angle);
      const x = outline.map((p) => p[0] * c + p[1] * s),
        z = outline.map((p) => -p[0] * s + p[1] * c);
      const minX = Math.min(...x),
        maxX = Math.max(...x),
        minZ = Math.min(...z),
        maxZ = Math.max(...z),
        area = (maxX - minX) * (maxZ - minZ);
      if (!best || area < best.area) best = { area, angle, minX, maxX, minZ, maxZ };
    }
    const b = best!,
      c = Math.cos(b.angle),
      s = Math.sin(b.angle),
      u = (b.minX + b.maxX) / 2,
      v = (b.minZ + b.maxZ) / 2;
    const center = new T.Vector3(u * c - v * s, 0.26, u * s + v * c),
      width = b.maxX - b.minX - 4,
      depth = b.maxZ - b.minZ - 4;
    const localOutline = outline.map(
      (p) =>
        [
          (p[0] - center.x) * c + (p[1] - center.z) * s,
          -(p[0] - center.x) * s + (p[1] - center.z) * c,
        ] as Point,
    );
    const glass = named(`PHOTO_HALL_${id} glass entrance`);
    const entranceCenter = glass
      ? new T.Box3().setFromObject(glass).getCenter(new T.Vector3())
      : new T.Vector3(center.x, 0, center.z);
    const entrance: Point = [
      (entranceCenter.x - center.x) * c + (entranceCenter.z - center.z) * s,
      -(entranceCenter.x - center.x) * s + (entranceCenter.z - center.z) * c,
    ];
    roof.userData['interiorRoof'] = `hall${id}`;
    halls.push({
      id: `hall${id}`,
      label: `Hall ${id}`,
      center,
      angle: b.angle,
      width,
      depth,
      height: Math.min(...points.map((p) => p.y)) - 0.7,
      outline: localOutline,
      entrance,
      roofs: [roof],
    });
  }
  return halls;
}
export function insideHall(hall: InteriorHall, x: number, z: number, margin = 0.5): boolean {
  return hall.outline.every((a, i) => {
    const b = hall.outline[(i + 1) % hall.outline.length];
    return cross(a, b, [x, z]) >= margin * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}
function insetOutline(points: Point[], distance: number): Point[] {
  return points.map((p, i) => {
    const previous = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length];
    const a = new T.Vector2(p[0] - previous[0], p[1] - previous[1]).normalize(),
      b = new T.Vector2(next[0] - p[0], next[1] - p[1]).normalize();
    const n = new T.Vector2(-a.y - b.y, a.x + b.x).normalize(),
      denom = n.dot(new T.Vector2(-a.y, a.x));
    return [
      p[0] + (n.x * distance) / Math.max(0.1, denom),
      p[1] + (n.y * distance) / Math.max(0.1, denom),
    ] as Point;
  });
}
export function hallToWorld(hall: InteriorHall, x: number, y: number, z: number): T.Vector3 {
  const c = Math.cos(hall.angle),
    s = Math.sin(hall.angle);
  return new T.Vector3(
    hall.center.x + x * c - z * s,
    hall.center.y + y,
    hall.center.z + x * s + z * c,
  );
}
export function worldToHall(hall: InteriorHall, p: T.Vector3): T.Vector3 {
  const c = Math.cos(hall.angle),
    s = Math.sin(hall.angle),
    x = p.x - hall.center.x,
    z = p.z - hall.center.z;
  return new T.Vector3(x * c + z * s, p.y - hall.center.y, -x * s + z * c);
}
export interface InteriorObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export function walkable(
  hall: InteriorHall,
  obstacles: InteriorObstacle[],
  x: number,
  z: number,
): boolean {
  return (
    insideHall(hall, x, z, 1.4) &&
    !obstacles.some(
      (b) => x > b.minX - 0.45 && x < b.maxX + 0.45 && z > b.minZ - 0.45 && z < b.maxZ + 0.45,
    )
  );
}

/** An independent scene layer; no planner stall, layout or persistence objects are changed. */
export async function createVenueInteriors(options: {
  root: T.Group;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  asset: (s: string) => string;
  signal: AbortSignal;
  invalidate: () => void;
  shadowsChanged: () => void;
  exit: () => void;
  state: (state: InteriorState) => void;
  daylight: () => boolean;
}) {
  const { root, scene, camera, canvas, signal, invalidate } = options;
  const halls = measureInteriorHalls(root),
    layer = new T.Group();
  layer.name = 'Reference interiors';
  layer.userData = {
    source: 'bharat-mandapam-default.glb',
    sourceSha256: '69b16158f53d49d1288376523e17fc2df3504f247efdbcb93628d88b7ddeea94',
    adaptation:
      'Reusable components fitted to existing roof footprints; illustrative furnishing, not a surveyed plan',
  };
  const names = [
    'stand-island',
    'reception-counter',
    'ceiling-light',
    'steel-beam',
    'stone-column',
    'floor-deck',
    'ceiling-deck',
    'linear-light',
    'hall-point-light',
  ];
  const loaded = await Promise.allSettled(
    names.map(async (n) => {
      const response = await fetch(options.asset(`interiors/${n}.glb`), { signal });
      if (!response.ok) throw new Error(`Interior asset ${n}: ${response.status}`);
      return new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
    }),
  );
  const sources = loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const groups = new Map<string, T.Group>(),
    obstacles = new Map<string, InteriorObstacle[]>(),
    pointLights = new Map<string, T.PointLight[]>();
  const emissive = new Set<T.MeshStandardMaterial>();
  const adaptedGeometries = new Set<T.BufferGeometry>();
  const sourceResources = () => {
    const geoms = new Set<T.BufferGeometry>(),
      mats = new Set<T.Material>(),
      maps = new Set<T.Texture>();
    for (const g of sources)
      g.scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          geoms.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            mats.add(m);
            Object.values(m).forEach((v) => {
              if (v instanceof T.Texture) maps.add(v);
            });
          }
        }
      });
    geoms.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    maps.forEach((t) => {
      t.dispose();
      if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap)
        t.source.data.close();
    });
  };
  const failed = loaded.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    sourceResources();
    throw failed.reason;
  }
  if (signal.aborted) {
    sourceResources();
    signal.throwIfAborted();
  }
  const kit = new Map(names.map((n, i) => [n, sources[i].scene]));
  for (const hall of halls) {
    const group = new T.Group();
    group.name = `Interior_${hall.id}`;
    group.position.copy(hall.center);
    group.rotation.y = -hall.angle;
    group.userData = { hall: hall.id.slice(4), referenceInterior: true };
    layer.add(group);
    groups.set(hall.id, group);
    const blocks: InteriorObstacle[] = [];
    obstacles.set(hall.id, blocks);
    group.userData['adaptedLayout'] = {
      width: hall.width,
      depth: hall.depth,
      ceiling: hall.height,
      outline: hall.outline,
      obstacles: blocks,
      clearance: 3,
      centralAisleX: 0,
    };
    function place(
      name: string,
      x: number,
      y: number,
      z: number,
      scale: T.Vector3 = new T.Vector3(1, 1, 1),
      collision = false,
    ) {
      const object = kit.get(name)!.clone(true);
      object.position.set(x, y, z);
      object.scale.copy(scale);
      object.name = `${hall.id}_${name}`;
      const b = new T.Box3().setFromObject(object);
      if (collision) {
        const corners = [
          [b.min.x, b.min.z],
          [b.min.x, b.max.z],
          [b.max.x, b.min.z],
          [b.max.x, b.max.z],
        ];
        if (!corners.every(([a, b]) => insideHall(hall, a, b, 3))) return;
        if (
          blocks.some(
            (other) =>
              b.min.x < other.maxX + 0.6 &&
              b.max.x > other.minX - 0.6 &&
              b.min.z < other.maxZ + 0.6 &&
              b.max.z > other.minZ - 0.6,
          )
        )
          return;
        blocks.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
      }
      object.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = false;
          o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (m.map) m.map.anisotropy = 4;
            if (m.emissive?.getHex()) emissive.add(m);
          }
        }
      });
      group.add(object);
      return object;
    }
    // Keep furniture at its authored scale and reserve the central and perimeter aisles.
    for (const x of [-21, -9, 9, 21])
      if (Math.abs(x) + 3.2 < hall.width / 2 - 3 && hall.depth > 47)
        place('stand-island', x, 0.02, 0, new T.Vector3(1, 1, 1), true);
    for (const x of [-9, 9])
      place('reception-counter', x, 0, hall.depth / 2 - 6, new T.Vector3(1, 1, 1), true);
    // Only the architectural panels change dimensions; all texture coordinates are retained.
    let w = hall.width,
      d = hall.depth;
    for (
      let i = 0;
      i < 20 &&
      ![
        [w / 2, d / 2],
        [-w / 2, d / 2],
        [w / 2, -d / 2],
        [-w / 2, -d / 2],
      ].every(([x, z]) => insideHall(hall, x, z, 1));
      i++
    ) {
      w *= 0.97;
      d *= 0.97;
    }
    // Rebuild only the plain, untextured decks to the actual polygon. A stretched
    // rectangular source slab would leave a raised platform inside curved halls.
    function deck(name: string, y: number) {
      let material: T.Material | T.Material[] | undefined;
      kit.get(name)!.traverse((o) => {
        if (o instanceof T.Mesh) material = o.material;
      });
      const shape = new T.Shape(
        insetOutline(hall.outline, 1.6).map(([x, z]) => new T.Vector2(x, z)),
      );
      const geometry = new T.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }).rotateX(
        Math.PI / 2,
      );
      adaptedGeometries.add(geometry);
      const mesh = new T.Mesh(geometry, material);
      mesh.position.y = y;
      mesh.name = `${hall.id}_adapted_${name}`;
      mesh.receiveShadow = true;
      mesh.userData = { sourceComponent: name, adaptedFootprint: true };
      group.add(mesh);
      return mesh;
    }
    deck('floor-deck', 0);
    const ceiling = deck('ceiling-deck', hall.height);
    ceiling.userData['interiorCeiling'] = true;
    for (let z = -d / 2 + 7; z < d / 2 - 4; z += 12) {
      const beam = place('steel-beam', 0, hall.height - 1, z, new T.Vector3(1, 1, w / 99.5));
      if (beam) beam.rotation.y = Math.PI / 2;
      place('linear-light', 0, hall.height - 1.7, z, new T.Vector3((w - 4) / 112, 1, 0.5));
    }
    for (const x of [-w / 2 + 1, w / 2 - 1])
      for (let z = -d / 2 + 6; z < d / 2 - 4; z += 15)
        place('stone-column', x, 0, z, new T.Vector3(0.7, hall.height / 9.5, 0.7), true);
    for (const x of [-w / 4, w / 4])
      for (const z of [-d / 4, d / 4]) place('ceiling-light', x, hall.height - 1.5, z);
    // Source light #5 uses this linear RGB and 24.5 cd. Repositioned, then supplemented
    // at runtime because glTF emissive surfaces do not illuminate neighbouring meshes.
    let sourceLight: T.PointLight | undefined;
    kit.get('hall-point-light')!.traverse((o) => {
      if (o instanceof T.PointLight) sourceLight = o;
    });
    const lights = [sourceLight!.clone()];
    lights[0].position.set(0, hall.height * 0.65, 0);
    lights[0].userData = { sourceLight: 5 };
    for (const z of [-d / 3, 0, d / 3]) {
      const l = new T.PointLight(0xffdfb5, 140, Math.max(w, d), 2);
      l.position.set(0, 7, z);
      l.userData = { runtimeInteriorFill: true };
      lights.push(l);
    }
    for (const light of lights) {
      light.visible = false;
      group.add(light);
    }
    pointLights.set(hall.id, lights);
  }
  const cc = buildCCInteriors(root, kit);
  for (const item of cc.levels) {
    halls.push(item.hall);
    layer.add(item.group);
    groups.set(item.hall.id, item.group);
    obstacles.set(item.hall.id, item.blocks);
    pointLights.set(item.hall.id, item.lights);
  }
  scene.add(layer);
  let active: InteriorHall | undefined,
    preview: InteriorHall | undefined,
    touring = false,
    paused = false,
    last = 0,
    routeIndex = 0,
    route: Point[] = [],
    yaw = 0,
    pitch = 0;
  const keys = new Set<string>();
  let pointer: { x: number; y: number } | undefined;
  const initial = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    near: camera.near,
    fov: camera.fov,
  };
  const state = () =>
    options.state({
      hall: active?.id ?? preview?.id ?? '',
      walking: !!active,
      touring,
      paused,
      preview: !!preview && !active,
    });
  function ccVisibility() {
    const selected = active?.level ? active : preview;
    if (cc.cutaway(!!selected)) options.shadowsChanged();
    for (const item of cc.levels) item.group.visible = item.hall === selected;
  }
  function look() {
    const c = Math.cos(pitch);
    camera.lookAt(
      camera.position
        .clone()
        .add(new T.Vector3(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c)),
    );
  }
  function restoreRoofs() {
    for (const h of halls) h.roofs.forEach((o) => (o.visible = true));
  }
  function leave() {
    if (!active && !preview) return;
    active = undefined;
    preview = undefined;
    touring = false;
    paused = false;
    keys.clear();
    pointer = undefined;
    restoreRoofs();
    ccVisibility();
    camera.near = initial.near;
    camera.fov = initial.fov;
    camera.updateProjectionMatrix();
    state();
    invalidate();
  }
  function enter(id: string, guided = false) {
    const h = halls.find((h) => h.id === id);
    if (!h) return;
    active = h;
    preview = undefined;
    touring = guided;
    paused = false;
    keys.clear();
    restoreRoofs();
    const edge = Math.min(h.depth / 2 - 4, Math.max(22, h.depth / 2 - 4));
    route = h.route ?? [
      [0, edge],
      [0, edge * 0.35],
      [0, -edge * 0.35],
      [0, -edge],
      [0, 0],
      [0, edge],
    ];
    const entry = h.level ? h.entrance : [0, edge];
    camera.position.copy(
      hallToWorld(h, entry[0], 1.7 + (h.elevation?.(entry[0], entry[1]) ?? 0), entry[1]),
    );
    yaw = Math.PI - h.angle;
    if (h.level && route.length > 1)
      yaw = Math.atan2(route[1][0] - entry[0], route[1][1] - entry[1]) - h.angle;
    pitch = 0;
    look();
    camera.near = 0.08;
    camera.fov = 65;
    camera.updateProjectionMatrix();
    routeIndex = 1;
    ccVisibility();
    last = 0;
    state();
    canvas.focus({ preventScroll: true });
    invalidate();
  }
  function move(dx: number, dz: number) {
    if (!active) return;
    const p = worldToHall(active, camera.position),
      blocks = obstacles.get(active.id)!;
    if (walkable(active, blocks, p.x + dx, p.z)) p.x += dx;
    if (walkable(active, blocks, p.x, p.z + dz)) p.z += dz;
    camera.position.copy(hallToWorld(active, p.x, 1.7 + (active.elevation?.(p.x, p.z) ?? 0), p.z));
    look();
  }
  const keyboard = (e: KeyboardEvent, down: boolean) => {
    const k = e.key.toLowerCase();
    // Key release must still clear movement if focus moved into the menu.
    if (!down) keys.delete(k);
    if (!active) return;
    const target = e.composedPath()[0];
    const element = target instanceof HTMLElement ? target : undefined;
    if (element?.closest('dialog[open]')) return;
    if (down && k === 'escape') {
      options.exit();
      return;
    }
    if (element?.closest('input,select,textarea,button,[contenteditable="true"]')) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
      if (down) {
        keys.add(k);
        if (touring) {
          touring = false;
          paused = false;
          state();
        }
      } else keys.delete(k);
      invalidate();
    }
  };
  window.addEventListener('keydown', (e) => keyboard(e, true), { signal });
  window.addEventListener('keyup', (e) => keyboard(e, false), { signal });
  canvas.addEventListener('blur', () => keys.clear(), { signal });
  window.addEventListener(
    'blur',
    () => {
      keys.clear();
      pointer = undefined;
    },
    { signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      keys.clear();
      last = 0;
    },
    { signal },
  );
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '3D venue. Inside a hall: W A S D to move, arrow keys to turn, drag to look, Escape to leave.',
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!active) return;
      pointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!active || !pointer) return;
      yaw -= (e.clientX - pointer.x) * 0.004;
      pitch = T.MathUtils.clamp(pitch - (e.clientY - pointer.y) * 0.003, -1.15, 1.15);
      pointer = { x: e.clientX, y: e.clientY };
      if (touring) {
        touring = false;
        state();
      }
      look();
      invalidate();
    },
    { signal },
  );
  for (const event of ['pointerup', 'pointercancel'] as const)
    canvas.addEventListener(event, () => (pointer = undefined), { signal });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!active) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? -1 : 1;
      const direction = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        active.angle,
      );
      move(direction.x * step, direction.z * step);
      if (touring) {
        touring = false;
        state();
      }
      invalidate();
    },
    { signal, passive: false },
  );
  function update(now: number) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    let moving = false;
    if (active) {
      if (keys.has('arrowleft')) yaw += dt * 1.4;
      if (keys.has('arrowright')) yaw -= dt * 1.4;
      const forward =
          Number(keys.has('w') || keys.has('arrowup')) -
          Number(keys.has('s') || keys.has('arrowdown')),
        right = Number(keys.has('d')) - Number(keys.has('a'));
      if (keys.size) {
        const a = yaw + active.angle,
          n = Math.max(1, Math.hypot(forward, right));
        move(
          ((Math.sin(a) * forward - Math.cos(a) * right) * dt * 4) / n,
          ((Math.cos(a) * forward + Math.sin(a) * right) * dt * 4) / n,
        );
        moving = true;
      }
      if (touring && !paused) {
        const p = worldToHall(active, camera.position),
          target = route[routeIndex],
          delta = new T.Vector2(target[0] - p.x, target[1] - p.z);
        if (delta.length() < 0.2) {
          routeIndex++;
          if (routeIndex >= route.length) {
            touring = false;
            state();
          }
        } else {
          delta.setLength(Math.min(delta.length(), dt * 3));
          move(delta.x, delta.y);
          const desired = active.level
            ? Math.atan2(delta.x, delta.y) - active.angle
            : routeIndex < 4
              ? Math.PI - active.angle
              : -active.angle;
          yaw += Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw)) * Math.min(1, dt * 2);
          look();
        }
        moving = true;
      }
    }
    let near = active ?? preview;
    if (!near)
      near = halls.find((h) => {
        const p = worldToHall(h, camera.position);
        return !h.level && p.y < h.height + 35 && insideHall(h, p.x, p.z, 0);
      });
    for (const h of halls) {
      const local = worldToHall(h, camera.position),
        cut = h === near && (local.y > h.height - 2 || (!!preview && h === preview));
      h.roofs.forEach((o) => {
        if (o.visible === cut) options.shadowsChanged();
        o.visible = !cut;
      });
      groups.get(h.id)!.traverse((o) => {
        if (o.userData['interiorCeiling']) o.visible = !cut;
        if (o.userData['planLabel']) o.visible = !!preview;
      });
      pointLights.get(h.id)!.forEach((l) => {
        l.visible = h === near;
        if (l.userData['runtimeInteriorFill'])
          l.intensity = l.userData['ccLevel']
            ? options.daylight()
              ? 120
              : 300
            : options.daylight()
              ? 70
              : 140;
      });
    }
    for (const m of emissive) m.emissiveIntensity = options.daylight() ? 0.7 : 2.2;
    return moving;
  }
  return {
    halls,
    layer,
    obstacles,
    enter,
    leave,
    preview(id: string) {
      leave();
      preview = halls.find((h) => h.id === id && !!h.level);
      ccVisibility();
      state();
      invalidate();
      return preview;
    },
    visit(id: string, roomId: string) {
      enter(id);
      const r = active?.rooms?.find((r) => r.id === roomId);
      if (!active || !r) return;
      let p = r.position;
      // A raster door can be crowded by illustrative furniture; find the nearest safe
      // floor point in the same room neighbourhood instead of placing the camera in it.
      if (!walkable(active, obstacles.get(id)!, ...p)) {
        const candidates: Point[] = [];
        for (let radius = 0.3; radius < 4; radius += 0.3)
          for (let i = 0; i < 16; i++)
            candidates.push([
              p[0] + Math.cos((i / 8) * Math.PI) * radius,
              p[1] + Math.sin((i / 8) * Math.PI) * radius,
            ]);
        p = candidates.find((q) => walkable(active!, obstacles.get(id)!, ...q)) ?? active.entrance;
      }
      camera.position.copy(hallToWorld(active, p[0], 1.7 + (active.elevation?.(...p) ?? 0), p[1]));
      yaw = Math.atan2(r.target[0] - p[0], r.target[1] - p[1]) - active.angle;
      pitch = 0;
      look();
      invalidate();
    },
    update,
    get active() {
      return !!active;
    },
    get hall() {
      return active;
    },
    pause() {
      paused = !paused;
      state();
      invalidate();
    },
    step(forward: number, turn = 0) {
      if (!active) return;
      yaw += turn;
      const a = yaw + active.angle;
      move(Math.sin(a) * forward, Math.cos(a) * forward);
      if (touring) {
        touring = false;
        state();
      }
      invalidate();
    },
    dispose() {
      layer.removeFromParent();
      sourceResources();
      cc.dispose();
      adaptedGeometries.forEach((g) => g.dispose());
      pointLights.clear();
      groups.clear();
    },
    restoreCamera() {
      camera.position.copy(initial.position);
      camera.quaternion.copy(initial.quaternion);
    },
  };
}
