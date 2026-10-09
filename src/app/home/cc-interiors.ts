import * as T from 'three';
import { CC_PLANS, CCPlan, CCRoom, PlanPoint } from './cc-plan-data';
import type { InteriorHall, InteriorObstacle } from './venue-interiors';

export interface CCRoomVisit {
  id: string;
  label: string;
  position: PlanPoint;
  target: PlanPoint;
}
const angle = -Math.PI / 3;
const normalName = (o: T.Object3D) => o.name.replace(/_/g, ' ');

/** Register each drawing to its existing floor plate, including the existing Y elevation. */
export function measureCCLevels(root: T.Object3D): InteriorHall[] {
  root.updateMatrixWorld(true);
  return CC_PLANS.flatMap((plan) => {
    let plate: T.Object3D | undefined;
    root.traverse((o) => {
      if (normalName(o) === `PHOTO CC LEVEL ${plan.level} floor plate`) plate = o;
    });
    if (!plate) return [];
    const bounds = new T.Box3();
    plate.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        bounds.expandByPoint(
          new T.Vector3(
            0.5 * v.x - (Math.sqrt(3) / 2) * v.z,
            v.y,
            (Math.sqrt(3) / 2) * v.x + 0.5 * v.z,
          ),
        );
      }
    });
    const c = bounds.getCenter(new T.Vector3());
    const width = bounds.max.x - bounds.min.x,
      depth = bounds.max.z - bounds.min.z;
    const center = new T.Vector3(
      0.5 * c.x + (Math.sqrt(3) / 2) * c.z,
      bounds.max.y + 0.08,
      (-Math.sqrt(3) / 2) * c.x + 0.5 * c.z,
    );
    const h: InteriorHall = {
      id: `cc-level${plan.level}`,
      label: `CC · Level ${plan.level}`,
      center,
      angle,
      width,
      depth,
      height: [0, 7.1, 9.5, 16.8][plan.level],
      outline: [],
      entrance: [0, 0],
      roofs: [],
      level: plan.level,
    };
    // A convex boundary is used for navigation; the visible slab keeps the traced contour.
    const outline = plan.outline.map((p) => planPoint(plan, h, p));
    h.outline = convex(outline);
    h.entrance = planPoint(plan, h, plan.entry);
    h.route = plan.route.map((p) => planPoint(plan, h, p));
    return [h];
  });
}
function convex(points: PlanPoint[]): PlanPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const side = (points: PlanPoint[]) => {
    const result: PlanPoint[] = [];
    for (const p of points) {
      while (result.length > 1) {
        const a = result[result.length - 2],
          b = result[result.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break;
        result.pop();
      }
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...side(sorted), ...side([...sorted].reverse())];
}
export function planPoint(plan: CCPlan, hall: InteriorHall, point: PlanPoint): PlanPoint {
  const [x0, z0, x1, z1] = plan.bounds;
  return [
    ((point[0] - (x0 + x1) / 2) / (x1 - x0)) * hall.width,
    ((point[1] - (z0 + z1) / 2) / (z1 - z0)) * hall.depth,
  ];
}

export function buildCCInteriors(root: T.Object3D, kit: Map<string, T.Group>) {
  const halls = measureCCLevels(root),
    geoms = new Set<T.BufferGeometry>(),
    mats = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  const ownGeometry = <G extends T.BufferGeometry>(g: G) => {
    geoms.add(g);
    return g;
  };
  const material = (color: string, roughness = 0.7, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness });
    mats.add(m);
    return m;
  };
  const stone = material('#d8cfba'),
    wallMat = material('#ede6d9'),
    trim = material('#775c37', 0.38, 0.5),
    carpet = material('#174e53'),
    upholstery = material('#287078'),
    wood = material('#91683d'),
    metal = material('#4f5659', 0.35, 0.65),
    foliage = material('#497b48'),
    gardenMat = material('#93a776'),
    serviceMat = material('#adb6b3'),
    stageMat = material('#b48145');
  const lightMat = material('#fff5dc');
  lightMat.emissive.set('#ffe7b7');
  lightMat.emissiveIntensity = 1.5;
  const glazing = material('#587a7b', 0.2, 0.15);
  glazing.transparent = true;
  glazing.opacity = 0.55;
  const box = ownGeometry(new T.BoxGeometry(1, 1, 1)),
    chairSeat = ownGeometry(new T.BoxGeometry(0.53, 0.11, 0.52)),
    chairBack = ownGeometry(new T.BoxGeometry(0.53, 0.62, 0.09)),
    roundTable = ownGeometry(new T.CylinderGeometry(0.75, 0.75, 0.07, 12)),
    leg = ownGeometry(new T.CylinderGeometry(0.055, 0.07, 0.72, 6));
  const shell: T.Object3D[] = [];
  root.traverse((o) => {
    const n = normalName(o);
    if (
      /^PHOTO CC (shell$|roof panelwork$|recessed glazing$|V columns and mullions$|photo horizontal end fins$|photographic upper curtain wall$|ITPO side curved stone drum$|ITPO side ribbon windows and joints$|architectural cornice lights$)|^PHOTO ROOF SIGN BOARD CC$|^ROOF LABEL CC$|^ARCH CC SIGN$|^DETAIL CC UNDERSIDE LIGHT/.test(
        n,
      )
    ) {
      o.userData['interiorRoof'] = 'cc';
      shell.push(o);
    }
  });
  const shellVisibility = new Map<T.Object3D, boolean>();
  let shellCut = false;
  const cutaway = (enabled: boolean) => {
    if (enabled === shellCut) return false;
    shellCut = enabled;
    for (const o of shell) {
      if (enabled) {
        shellVisibility.set(o, o.visible);
        o.visible = false;
      } else o.visible = shellVisibility.get(o) ?? true;
    }
    return true;
  };
  const levels = halls.map((hall) => {
    const plan = CC_PLANS.find((p) => p.level === hall.level)!;
    const group = new T.Group();
    group.name = `Interior_${hall.id}`;
    group.position.copy(hall.center);
    group.rotation.y = -hall.angle;
    group.visible = false;
    const blocks: InteriorObstacle[] = [],
      visits: CCRoomVisit[] = [],
      chairs: T.Matrix4[] = [],
      chairBacks: T.Matrix4[] = [],
      chairLegs: T.Matrix4[] = [];
    const furniture = new T.Group();
    furniture.name = 'Furniture';
    group.add(furniture);
    group.userData = {
      ccLevel: plan.level,
      sourcePlan: plan.source,
      sourceSha256: plan.sha256,
      registration:
        'Raster plan proportions fitted to incumbent CC floor plate; heights and furnishing are inferred',
      rooms: plan.rooms.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        sourceRect: r.rect,
        door: r.door,
      })),
      adaptedLayout: {
        width: hall.width,
        depth: hall.depth,
        outline: hall.outline,
        route: hall.route,
        obstacles: blocks,
      },
    };
    const pt = (p: PlanPoint) => planPoint(plan, hall, p);
    const obstacle = (x: number, z: number, w: number, d: number) =>
      blocks.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    function cube(
      name: string,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      m: T.Material,
      solid = false,
      parent: T.Object3D = group,
    ) {
      const mesh = new T.Mesh(box, m);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.receiveShadow = true;
      parent.add(mesh);
      if (solid) obstacle(x, z, w, d);
      return mesh;
    }
    function label(text: string, x: number, y: number, z: number, width: number, flat = true) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f6f0dd';
      ctx.fillRect(0, 0, 512, 96);
      ctx.fillStyle = '#244b48';
      ctx.font = '600 27px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 48, 480);
      const map = new T.CanvasTexture(canvas);
      map.colorSpace = T.SRGBColorSpace;
      textures.add(map);
      const m = new T.MeshBasicMaterial({ map, side: T.DoubleSide });
      mats.add(m);
      const mesh = new T.Mesh(ownGeometry(new T.PlaneGeometry(width, (width * 96) / 512)), m);
      mesh.name = `Sign_${text}`;
      mesh.position.set(x, y, z);
      if (flat) {
        mesh.rotation.x = -Math.PI / 2;
        mesh.userData['planLabel'] = true;
      }
      group.add(mesh);
      return mesh;
    }
    const slabShape = new T.Shape(
      plan.outline.map((p) => {
        const [x, z] = pt(p);
        return new T.Vector2(x, -z);
      }),
    );
    const slabGeometry = ownGeometry(
      new T.ExtrudeGeometry(slabShape, { depth: 0.18, bevelEnabled: false }).rotateX(-Math.PI / 2),
    );
    const slab = new T.Mesh(slabGeometry, stone);
    slab.name = 'Traced floor slab';
    slab.position.y = -0.18;
    slab.receiveShadow = true;
    group.add(slab);
    const ceiling = new T.Mesh(slabGeometry, wallMat);
    ceiling.name = 'Ceiling';
    ceiling.position.y = hall.height;
    ceiling.userData['interiorCeiling'] = true;
    group.add(ceiling);
    // External glazing stays in the original building. This inner perimeter remains open
    // at the plan's side entrances and supports an intelligible level cutaway.
    for (let i = 0; i < plan.outline.length; i++) {
      const a = pt(plan.outline[i]),
        b = pt(plan.outline[(i + 1) % plan.outline.length]);
      const x = (a[0] + b[0]) / 2,
        z = (a[1] + b[1]) / 2,
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mesh = cube('Inner perimeter plinth', x, 0.3, z, len, 0.6, 0.25, stone);
      mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      const lining = new T.Group();
      lining.name = 'Interior facade lining';
      lining.userData['interiorCeiling'] = true;
      group.add(lining);
      for (const [name, cy, ch, m] of [
        ['Window belt', 2.1, 3, glazing],
        ['Upper wall', 4.4 + (hall.height - 4.4) / 2, hall.height - 4.4, wallMat],
      ] as const) {
        const panel = cube(name, x, cy, z, len, ch, 0.16, m, false, lining);
        panel.rotation.y = mesh.rotation.y;
      }
      cube(
        'Facade column',
        a[0],
        hall.height / 2,
        a[1],
        0.32,
        hall.height,
        0.32,
        stone,
        false,
        lining,
      );
    }
    function chair(x: number, z: number, y = 0, rotation = 0) {
      const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rotation),
        v = new T.Vector3(0, 0, 1).applyQuaternion(q);
      chairs.push(
        new T.Matrix4().compose(new T.Vector3(x, y + 0.47, z), q, new T.Vector3(1, 1, 1)),
      );
      chairBacks.push(
        new T.Matrix4().compose(
          new T.Vector3(x - v.x * 0.23, y + 0.77, z - v.z * 0.23),
          q,
          new T.Vector3(1, 1, 1),
        ),
      );
      chairLegs.push(
        new T.Matrix4().compose(new T.Vector3(x, y + 0.23, z), q, new T.Vector3(0.8, 0.6, 0.8)),
      );
    }
    function rows(x0: number, z0: number, x1: number, z1: number, reverse = false, large = false) {
      const aisle = large ? 3.4 : 1.8,
        mid = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      for (let z = z0 + 1.4; z < z1 - 1.2; z += 1.25) {
        if (large && (Math.abs(z - mz) < 1.8 || z > z1 - 4.8)) continue;
        for (const [a, b] of [
          [x0 + 1.6, mid - aisle / 2],
          [mid + aisle / 2, x1 - 1.6],
        ]) {
          if (b <= a) continue;
          for (let x = a; x <= b; x += 0.76) chair(x, z, 0, reverse ? 0 : Math.PI);
          obstacle((a + b) / 2, z, b - a + 0.54, 0.6);
        }
      }
    }
    function wallSegment(x: number, z: number, w: number, d: number, h = 4.4) {
      cube('Partition', x, h / 2, z, w, h, d, wallMat, true);
      cube('Timber skirting', x, 0.13, z, w, 0.26, d + 0.03, wood);
    }
    function partition(r: CCRoom, a: PlanPoint, b: PlanPoint) {
      const w = b[0] - a[0],
        d = b[1] - a[1],
        x = (a[0] + b[0]) / 2,
        z = (a[1] + b[1]) / 2,
        h =
          r.kind === 'service' || r.kind === 'wc'
            ? 3.6
            : Math.min(hall.height - 0.6, r.id === 'multi-function' ? hall.height - 0.6 : 4.6);
      const opening = Math.min(
        r.id === 'multi-function' ? 4.8 : 2.1,
        (r.door === 'n' || r.door === 's' ? w : d) * 0.45,
      );
      for (const edge of ['n', 's', 'e', 'w'] as const) {
        const horizontal = edge === 'n' || edge === 's',
          len = horizontal ? w : d,
          at = horizontal ? (edge === 'n' ? a[1] : b[1]) : edge === 'w' ? a[0] : b[0];
        if (edge === r.door || r.id === 'multi-function') {
          for (const side of [-1, 1]) {
            const half = (len - opening) / 2,
              pos = (horizontal ? x : z) + side * (opening / 2 + half / 2);
            wallSegment(
              horizontal ? pos : at,
              horizontal ? at : pos,
              horizontal ? half : 0.18,
              horizontal ? 0.18 : half,
              h,
            );
          }
          cube(
            'Door lintel',
            horizontal ? x : at,
            h - 0.32,
            horizontal ? at : z,
            horizontal ? opening : 0.2,
            0.64,
            horizontal ? 0.2 : opening,
            wood,
          );
          // Door leaves are visibly held open along the wall, not collision-blocking slabs.
          const door = cube(
            'Open door leaf',
            horizontal ? x + opening / 2 : at,
            (h / 2) * 0.58,
            horizontal ? at : z + opening / 2,
            horizontal ? 0.08 : opening * 0.47,
            2.5,
            horizontal ? opening * 0.47 : 0.08,
            wood,
          );
          door.userData['openDoor'] = true;
          const px = horizontal ? x : at,
            pz = horizontal ? at : z;
          const plaque = label(r.label, px, 2.9, pz, 0.95 * opening, false);
          plaque.rotation.y = horizontal ? 0 : Math.PI / 2;
          const spawn: [number, number] = [
            px + (edge === 'w' ? 1.2 : edge === 'e' ? -1.2 : 0),
            pz + (edge === 'n' ? 1.2 : edge === 's' ? -1.2 : 0),
          ];
          if (edge === r.door && !['wc', 'service', 'lift', 'stair'].includes(r.kind))
            visits.push({ id: r.id, label: r.label, position: spawn, target: [x, z] });
        } else
          wallSegment(
            horizontal ? x : at,
            horizontal ? at : z,
            horizontal ? w : 0.18,
            horizontal ? 0.18 : d,
            h,
          );
      }
    }
    for (const r of plan.rooms) {
      const a = pt([r.rect[0], r.rect[1]]),
        b = pt([r.rect[2], r.rect[3]]),
        x = (a[0] + b[0]) / 2,
        z = (a[1] + b[1]) / 2,
        w = b[0] - a[0],
        d = b[1] - a[1];
      const open = ['foyer', 'garden'].includes(r.kind);
      cube(
        `${r.label} floor`,
        x,
        0.025,
        z,
        w,
        0.04,
        d,
        r.kind === 'garden'
          ? gardenMat
          : ['wc', 'service', 'stair', 'lift'].includes(r.kind)
            ? serviceMat
            : r.kind === 'foyer'
              ? stone
              : carpet,
      );
      if (!open) partition(r, a, b);
      label(
        r.label,
        x,
        open ? 0.08 : Math.min(hall.height - 0.3, r.id === 'multi-function' ? hall.height : 4.9),
        z,
        Math.min(w * 0.85, Math.max(3, r.label.length * 0.23)),
      );
      if (r.kind === 'garden') {
        obstacle(x, z, w, d);
        for (const ox of [-0.25, 0.25])
          for (const oz of [-0.3, 0, 0.3]) {
            const plant = new T.Mesh(
              ownGeometry(new T.IcosahedronGeometry(Math.min(w, d) * 0.12, 0)),
              foliage,
            );
            plant.position.set(x + ox * w, 0.8, z + oz * d);
            group.add(plant);
          }
        continue;
      }
      if (r.kind === 'theatre') {
        const big = r.id === 'multi-function';
        rows(a[0], a[1] + (big ? 0 : 1.7), b[0], b[1], big, big);
        const stageZ = big ? b[1] - 2.3 : a[1] + 1.2;
        cube(`${r.label} stage`, x, 0.38, stageZ, w * 0.42, 0.76, big ? 3 : 1.9, stageMat, true);
        cube('Stage screen', x, 2.5, big ? b[1] - 0.3 : a[1] + 0.3, w * 0.44, 2.4, 0.08, metal);
        if (big) {
          // Extra plan-indicated doors connect both side prefunction areas and the plenary.
          visits.push({
            id: 'multi-central',
            label: 'Multi-function · central aisle',
            position: [x, z],
            target: [x, stageZ],
          });
        }
      } else if (['banquet', 'lounge', 'foyer'].includes(r.kind)) {
        if (r.kind === 'foyer') {
          const counter = kit.get('reception-counter')!.clone(true);
          counter.position.set(a[0] + 2, 0, z);
          group.add(counter);
          continue;
        }
        for (let tz = a[1] + 2; tz < b[1] - 1.6; tz += 3.2)
          for (let tx = a[0] + 1.8; tx < b[0] - 1.8; tx += 3.2) {
            const table = new T.Mesh(roundTable, wood);
            table.position.set(tx, 0.78, tz);
            furniture.add(table);
            const post = new T.Mesh(leg, metal);
            post.position.set(tx, 0.36, tz);
            furniture.add(post);
            obstacle(tx, tz, 2.25, 2.25);
            for (let i = 0; i < 4; i++) {
              const t = (i * Math.PI) / 2;
              chair(tx + Math.sin(t) * 1.1, tz + Math.cos(t) * 1.1, 0, t + Math.PI);
            }
          }
      } else if (r.kind === 'g20') {
        const radius = Math.min(w, d) * 0.3;
        for (let ring = 0; ring < 3; ring++) {
          const rad = radius + ring * 1.3,
            count = Math.floor((rad * 2 * Math.PI) / 0.85);
          for (let i = 0; i < count; i++) {
            const t = (i / count) * 2 * Math.PI;
            if (Math.abs(Math.sin(t)) < 0.13) continue;
            chair(x + Math.sin(t) * rad, z + Math.cos(t) * rad, 0, t + Math.PI);
          }
        }
        const table = new T.Mesh(
          ownGeometry(new T.CylinderGeometry(radius * 0.64, radius * 0.64, 0.1, 48)),
          wood,
        );
        table.position.set(x, 0.8, z);
        furniture.add(table);
        obstacle(x, z, radius * 1.3, radius * 1.3);
      } else if (['boardroom', 'meeting'].includes(r.kind)) {
        const tw = Math.min(w * 0.4, 2),
          td = Math.max(1.2, d - 3.8);
        cube('Conference table', x, 0.76, z, tw, 0.12, td, wood, true, furniture);
        for (let tz = a[1] + 2; tz < b[1] - 1.5; tz += 0.95) {
          chair(x - tw / 2 - 0.55, tz, 0, Math.PI / 2);
          chair(x + tw / 2 + 0.55, tz, 0, -Math.PI / 2);
        }
      } else if (r.kind === 'stair') {
        for (let i = 0; i < 12; i++)
          cube(
            'Stair tread',
            x,
            (i + 1) * 0.075,
            a[1] + 0.4 + (i * (d - 0.8)) / 12,
            w * 0.65,
            (i + 1) * 0.15,
            (d - 0.8) / 12,
            stone,
          );
        obstacle(x, z, w * 0.7, d - 0.8);
      } else if (r.kind === 'lift') {
        cube('Lift door', x, 1.3, a[1] + 0.15, Math.min(w - 1, 1.9), 2.6, 0.08, metal);
        obstacle(x, z, w - 0.4, d - 0.4);
      } else if (r.kind === 'wc') {
        for (let tz = a[1] + 0.8; tz < b[1] - 0.6; tz += 1.5)
          cube('WC cubicle', a[0] + 0.8, 1, tz, 1.2, 2, 1.2, wallMat, true);
      }
    }
    // Fan geometry and aisle breaks follow the semicircular seating shown on each plan.
    const fan = plan.fan,
      c = pt(fan.center),
      rx = (fan.radius[0] / (plan.bounds[2] - plan.bounds[0])) * hall.width,
      rz = (fan.radius[1] / (plan.bounds[3] - plan.bounds[1])) * hall.depth;
    const fanShape = new T.Shape();
    fanShape.moveTo(c[0] - rx, -c[1]);
    for (let i = 0; i <= 64; i++) {
      const t = Math.PI - (i / 64) * Math.PI;
      fanShape.lineTo(c[0] + Math.cos(t) * rx, -c[1] + Math.sin(t) * rz);
    }
    fanShape.lineTo(c[0] - rx, -c[1]);
    const fanFloor = new T.Mesh(
      ownGeometry(new T.ShapeGeometry(fanShape).rotateX(-Math.PI / 2)),
      plan.level === 3 ? carpet : wood,
    );
    fanFloor.position.y = 0.05;
    fanFloor.name = fan.label;
    group.add(fanFloor);
    const acoustic = new T.Group();
    acoustic.name = 'Curved auditorium acoustic lining';
    acoustic.userData['interiorCeiling'] = true;
    group.add(acoustic);
    for (let i = 0; i < 48; i++) {
      if (i >= 23 && i <= 24) continue; // Rear lobby opening, aligned with the radial aisle.
      const a = (i / 48) * Math.PI,
        b = ((i + 1) / 48) * Math.PI;
      const ax = c[0] + Math.cos(a) * rx * 1.065,
        az = c[1] - Math.sin(a) * rz * 1.065,
        bx = c[0] + Math.cos(b) * rx * 1.065,
        bz = c[1] - Math.sin(b) * rz * 1.065;
      const panel = cube(
        'Acoustic wall panel',
        (ax + bx) / 2,
        hall.height / 2,
        (az + bz) / 2,
        Math.hypot(bx - ax, bz - az),
        hall.height,
        0.18,
        wood,
        false,
        acoustic,
      );
      panel.rotation.y = -Math.atan2(bz - az, bx - ax);
      blocks.push({
        minX: Math.min(ax, bx) - 0.09,
        maxX: Math.max(ax, bx) + 0.09,
        minZ: Math.min(az, bz) - 0.09,
        maxZ: Math.max(az, bz) + 0.09,
      });
      const strip = cube(
        'Acoustic wall light',
        (ax + bx) / 2,
        4,
        (az + bz) / 2,
        0.06,
        3.8,
        0.06,
        lightMat,
        false,
        acoustic,
      );
      strip.userData['luminaire'] = true;
    }
    const tierCount = plan.level === 3 ? 18 : 14;
    hall.elevation = (x, z) => {
      const r = Math.hypot((x - c[0]) / rx, (z - c[1]) / rz);
      return z < c[1] && r >= 0.3 && r <= 1
        ? Math.max(0, Math.floor(((r - 0.3) / 0.69) * tierCount)) * 0.15
        : 0;
    };
    for (let row = 0; row < tierCount; row++) {
      const r = 0.3 + (row / tierCount) * 0.69,
        count = Math.floor((Math.PI * rx * r) / 0.72),
        y = row * 0.15;
      const band = new T.Shape(),
        inner = Math.max(0.27, r - (0.5 / tierCount) * 0.69),
        outer = r + (0.5 / tierCount) * 0.69;
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI,
          x = c[0] + Math.cos(t) * rx * outer,
          z = -c[1] + Math.sin(t) * rz * outer;
        if (i === 0) band.moveTo(x, z);
        else band.lineTo(x, z);
      }
      for (let i = 48; i >= 0; i--) {
        const t = (i / 48) * Math.PI;
        band.lineTo(c[0] + Math.cos(t) * rx * inner, -c[1] + Math.sin(t) * rz * inner);
      }
      const tier = new T.Mesh(
        ownGeometry(
          new T.ExtrudeGeometry(band, { depth: y + 0.04, bevelEnabled: false }).rotateX(
            -Math.PI / 2,
          ),
        ),
        plan.level === 3 ? carpet : wood,
      );
      tier.name = 'Seating tier';
      group.add(tier);
      for (let i = 1; i < count; i++) {
        const t = (i / count) * Math.PI;
        if (Math.abs(Math.sin(t * 6)) < 0.18) continue;
        const x = c[0] + Math.cos(t) * rx * r,
          z = c[1] - Math.sin(t) * rz * r;
        chair(x, z, y, Math.atan2(c[0] - x, c[1] - z));
      }
      // Six complete seat banks leave radial walking aisles, with colliders per bank.
      for (let sector = 0; sector < 6; sector++) {
        const ta = ((sector + 0.12) / 6) * Math.PI,
          tb = ((sector + 0.88) / 6) * Math.PI;
        const xs = [Math.cos(ta) * rx * r, Math.cos(tb) * rx * r],
          zs = [-Math.sin(ta) * rz * r, -Math.sin(tb) * rz * r];
        blocks.push({
          minX: c[0] + Math.min(...xs) - 0.2,
          maxX: c[0] + Math.max(...xs) + 0.2,
          minZ: c[1] + Math.min(...zs) - 0.2,
          maxZ: c[1] + Math.max(...zs) + 0.2,
        });
      }
    }
    const stage = new T.Mesh(
      ownGeometry(
        new T.CylinderGeometry(rx * 0.27, rx * 0.27, 0.6, 48, 1, false, Math.PI / 2, Math.PI),
      ),
      stageMat,
    );
    stage.position.set(c[0], 0.3, c[1]);
    stage.name = `${fan.label} stage`;
    group.add(stage);
    label(fan.label, c[0], 4.9, c[1] - rz * 0.6, Math.min(15, rx));
    visits.push({
      id: 'plenary',
      label: fan.label,
      position: [c[0], c[1] + 1.3],
      target: [c[0], c[1] - rz * 0.6],
    });
    for (const [name, geometry, instances, m] of [
      ['Seats', chairSeat, chairs, upholstery],
      ['Seat backs', chairBack, chairBacks, upholstery],
      ['Seat supports', chairSeat, chairLegs, metal],
    ] as const) {
      const mesh = new T.InstancedMesh(geometry, m, instances.length);
      instances.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.name = name;
      mesh.userData = { illustrativeSeating: true, count: instances.length };
      mesh.computeBoundingSphere();
      furniture.add(mesh);
    }
    hall.rooms = visits;
    // Ceiling grids and warm fixtures reuse the extracted reference fittings.
    for (const x of [-hall.width * 0.22, 0, hall.width * 0.22])
      for (const z of [-hall.depth * 0.2, 0, hall.depth * 0.2]) {
        const fixture = kit.get('ceiling-light')!.clone(true);
        fixture.position.set(x, hall.height - 0.5, z);
        group.add(fixture);
        cube('Linear ceiling luminaire', x, hall.height - 0.25, z, 7, 0.12, 0.18, lightMat);
      }
    const lights: T.PointLight[] = [];
    for (const [x, z] of [
      [-0.25, 0],
      [0.25, 0],
      [0, -0.25],
      [0, 0.25],
    ]) {
      const l = new T.PointLight('#ffdfb5', 180, Math.max(hall.width, hall.depth) * 0.75, 2);
      l.position.set(x * hall.width, Math.min(8, hall.height - 0.8), z * hall.depth);
      l.userData = { runtimeInteriorFill: true, ccLevel: plan.level };
      l.visible = false;
      group.add(l);
      lights.push(l);
    }
    group.userData['seatCountIllustrative'] = chairs.length;
    return { hall, group, blocks, lights };
  });
  return {
    levels,
    cutaway,
    dispose() {
      cutaway(false);
      geoms.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
