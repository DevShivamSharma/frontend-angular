import * as T from 'three';

import type { FloorAreaKind as AreaKind, HallFloor } from '../../../core/api/api.models';
import { PlanContent, stallLabel, StallSide } from '../../../core/plans/plans.models';
import type { MultiPolygon, Point } from '../../../core/venues/floor-plan.models';
import {
  facilityCardCanvas,
  iconGroupSize,
  labelCanvas,
  labelSize,
} from '../../../shared/floor/floor-annotations';
import { objectOutline, Rect, rectRing, stallRect } from './planner-geometry';
import type { Selection } from './planner.store';

/**
 * The plan in 3D, to look at: the hall's floor with its walls and pillars standing up, and the
 * stalls with their shell walls, seats and zones on it. Floor metres map to x and z (x right,
 * floor y towards the viewer), with y up; nothing here is edited, the 2D plan is.
 */

/** How tall what stands on the floor is drawn, metres. */
const HEIGHTS: Partial<Record<AreaKind, number>> = {
  wall: 4,
  column: 6,
  facility: 3,
};
/** Floor kinds drawn as a coloured mark on the floor. */
const MARKED: ReadonlySet<AreaKind> = new Set([
  'passage',
  'fire_curtain',
  'no_build',
  'utility',
  'entry',
  'unavailable',
  'marking',
  'void',
]);
const AREA_COLORS: Record<AreaKind, string> = {
  outside: '#d9dee5',
  wall: '#8b5e83',
  column: '#94a3b8',
  passage: '#e53935',
  fire_curtain: '#8a2be2',
  no_build: '#8b4513',
  utility: '#1e88e5',
  entry: '#2e8b57',
  unavailable: '#f2c200',
  marking: '#9e9e9e',
  void: '#151e29',
  facility: '#5681ad',
};
/** Shell walls: height and thickness, metres. */
const SHELL_HEIGHT = 2.5;
const PANEL = 0.06;
const STALL_FILL = '#86efac';
const STALL_BLOCKED = '#cbd5e1';
const SEAT_FILL = '#a855f7';
const SELECTED = '#2563eb';
/** Stalls at most this many get their number drawn above them. */
const LABELLED = 600;

export interface Scene3dInput {
  floor: HallFloor;
  plan: PlanContent;
  selection: Selection | null;
  categoryColors: ReadonlyMap<string, string>;
  showGrid: boolean;
  showLabels: boolean;
}

/** Builds the 3D plan into `g`; `extent` is the box of the hall, floor metres. */
export function buildScene3d(g: T.Group, input: Scene3dInput, extent: Rect): void {
  const { floor: f, plan } = input;
  const selected = new Set(input.selection?.ids ?? []);

  g.add(new T.HemisphereLight('#ffffff', '#94a3b8', 1.6));
  const sun = new T.DirectionalLight('#ffffff', 1.4);
  sun.position.set(
    extent.x - extent.width * 0.3,
    Math.max(extent.width, extent.height),
    extent.y - extent.height * 0.2,
  );
  sun.target.position.set(extent.x + extent.width / 2, 0, extent.y + extent.height / 2);
  g.add(sun, sun.target);

  // The floor and what is on it.
  if (f.geometry) {
    for (const poly of f.geometry.boundary) addSlab(g, [poly], '#ffffff', 0.05, -0.05);
    for (const o of f.geometry.objects) addArea(g, o.kind as AreaKind, o.geometry, o.color);
  } else {
    addSlab(
      g,
      [[rectRing({ x: 0, y: 0, width: f.width, height: f.depth })]],
      '#ffffff',
      0.05,
      -0.05,
    );
    for (const a of f.areas) addArea(g, a.kind, [[rectRing(a)]], a.color);
  }
  if (input.showGrid) addGrid(g, extent);
  // The hall's helper text and cards (toilets, exits…), on the floor where the plan has them.
  if (input.showLabels) {
    for (const l of f.labels ?? []) {
      const size = labelSize(f, l);
      addDecal(g, labelCanvas(l.text), l.x, l.y, size.width, size.height, 0.06);
    }
    for (const group of f.iconGroups ?? []) {
      const canvas = facilityCardCanvas(group);
      if (!canvas) continue;
      const size = iconGroupSize(f, group);
      addDecal(g, canvas, group.x, group.y, size.width, size.height, 0.07);
    }
  }

  for (const z of plan.zones) {
    const on = input.selection?.kind === 'zone' && selected.has(z.id);
    addFlat(g, [[z.polygon]], z.color, on ? 0.3 : 0.15, 0.015);
    addLoop(g, z.polygon, on ? SELECTED : z.color, 0.03);
  }

  for (const o of plan.objects) {
    if (o.kind === 'text') continue;
    const { points, closed } = objectOutline(o);
    if (closed) addLoop(g, points, o.color, 0.04);
    else addPath(g, points, o.color, 0.04);
  }

  // Stalls: a coloured floor, shell walls on the closed sides, the number above.
  const panelMaterial = new T.MeshLambertMaterial({ color: '#f8fafc' });
  const edgeMaterial = new T.LineBasicMaterial({ color: '#15803d' });
  for (const s of plan.stalls) {
    const on = input.selection?.kind === 'stall' && selected.has(s.id);
    const color = on
      ? SELECTED
      : s.isBlocked
        ? STALL_BLOCKED
        : (input.categoryColors.get(s.categoryIds[0] ?? '') ?? STALL_FILL);
    const tile = new T.Mesh(
      new T.BoxGeometry(s.width, 0.08, s.depth),
      new T.MeshLambertMaterial({ color }),
    );
    tile.position.set(s.x + s.width / 2, 0.04, s.y + s.depth / 2);
    g.add(tile);
    if (s.scheme === 'shell') {
      for (const side of ['top', 'right', 'bottom', 'left'] as StallSide[]) {
        if (!s.openSides.includes(side)) g.add(panel(stallRect(s), side, panelMaterial));
      }
      const frame = new T.LineSegments(
        new T.EdgesGeometry(new T.BoxGeometry(s.width, SHELL_HEIGHT, s.depth)),
        edgeMaterial,
      );
      frame.position.set(s.x + s.width / 2, SHELL_HEIGHT / 2, s.y + s.depth / 2);
      g.add(frame);
    }
  }
  if (input.showLabels && plan.stalls.length <= LABELLED) {
    for (const s of plan.stalls) {
      g.add(
        label(
          stallLabel(s),
          s.x + s.width / 2,
          SHELL_HEIGHT + 0.6,
          s.y + s.depth / 2,
          Math.min(s.width, 3),
        ),
      );
    }
  }

  // Seats: one instanced box each.
  if (plan.seats.length) {
    const seats = new T.InstancedMesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshLambertMaterial(),
      plan.seats.length,
    );
    const m = new T.Matrix4();
    const c = new T.Color();
    plan.seats.forEach((s, i) => {
      m.makeScale(s.width * 0.85, 0.45, s.depth * 0.85);
      m.setPosition(s.x + s.width / 2, 0.225, s.y + s.depth / 2);
      seats.setMatrixAt(i, m);
      const on = input.selection?.kind === 'seat' && selected.has(s.id);
      seats.setColorAt(
        i,
        c.set(on ? SELECTED : (input.categoryColors.get(s.categoryId ?? '') ?? SEAT_FILL)),
      );
    });
    g.add(seats);
  }
}

// ---- helpers --------------------------------------------------------------------------------

/** A floor polygon as a Three shape, in the plane the slab is turned up from. */
function shapes(g: MultiPolygon): T.Shape[] {
  return g
    .filter((poly) => poly[0]?.length >= 3)
    .map((poly) => {
      const shape = new T.Shape(poly[0].map(([x, y]) => new T.Vector2(x, -y)));
      for (const hole of poly.slice(1))
        shape.holes.push(new T.Path(hole.map(([x, y]) => new T.Vector2(x, -y))));
      return shape;
    });
}

/** A solid of the floor's shape, `height` tall, its bottom at `base`. */
function addSlab(
  g: T.Group,
  polygons: MultiPolygon,
  color: string,
  height: number,
  base: number,
  opacity = 1,
): void {
  for (const shape of shapes(polygons)) {
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }),
      new T.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    );
    // The shape lies in x / -y; turned a quarter, it lies on the floor with its depth upward.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = base;
    g.add(mesh);
  }
}

/** A flat mark on the floor, a little above it. */
function addFlat(
  g: T.Group,
  polygons: MultiPolygon,
  color: string,
  opacity: number,
  y: number,
): void {
  for (const shape of shapes(polygons)) {
    const mesh = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    g.add(mesh);
  }
}

/** An area of the floor: walls, pillars and rooms stand up; the rest is marked on the floor. */
function addArea(g: T.Group, kind: AreaKind, geometry: MultiPolygon, color?: string): void {
  if (kind === 'outside') return;
  const height = HEIGHTS[kind];
  if (height)
    addSlab(
      g,
      geometry,
      AREA_COLORS[kind] ?? color ?? '#94a3b8',
      height,
      0,
      kind === 'facility' ? 0.75 : 1,
    );
  else if (MARKED.has(kind))
    addFlat(g, geometry, color ?? AREA_COLORS[kind], kind === 'void' ? 0.9 : 0.4, 0.01);
}

function addLoop(g: T.Group, ring: Point[], color: string, y: number): void {
  addPath(g, [...ring, ring[0]], color, y);
}

function addPath(g: T.Group, points: Point[], color: string, y: number): void {
  if (points.length < 2) return;
  g.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints(points.map(([x, z]) => new T.Vector3(x, y, z))),
      new T.LineBasicMaterial({ color }),
    ),
  );
}

/** The 1 m grid on the floor, every 10 m darker. */
function addGrid(g: T.Group, e: Rect): void {
  const minor: number[] = [];
  const major: number[] = [];
  const [x0, x1] = [Math.floor(e.x), Math.ceil(e.x + e.width)];
  const [z0, z1] = [Math.floor(e.y), Math.ceil(e.y + e.height)];
  for (let x = x0; x <= x1; x++) (x % 10 ? minor : major).push(x, 0.005, z0, x, 0.005, z1);
  for (let z = z0; z <= z1; z++) (z % 10 ? minor : major).push(x0, 0.005, z, x1, 0.005, z);
  for (const [list, opacity] of [
    [minor, 0.15],
    [major, 0.35],
  ] as const) {
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(list, 3));
    g.add(
      new T.LineSegments(
        geom,
        new T.LineBasicMaterial({
          color: '#64748b',
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    );
  }
}

/** A picture lying on the floor, its top towards the top of the plan; (x, y) its top-left. */
function addDecal(
  g: T.Group,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  lift: number,
): void {
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(width, height),
    new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: T.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x + width / 2, lift, y + height / 2);
  mesh.renderOrder = 2;
  g.add(mesh);
}

/** A shell wall along one side of a stall, inside it. */
function panel(r: Rect, side: StallSide, material: T.Material): T.Mesh {
  const across = side === 'top' || side === 'bottom';
  const mesh = new T.Mesh(
    new T.BoxGeometry(across ? r.width : PANEL, SHELL_HEIGHT, across ? PANEL : r.height),
    material,
  );
  const x =
    side === 'left'
      ? r.x + PANEL / 2
      : side === 'right'
        ? r.x + r.width - PANEL / 2
        : r.x + r.width / 2;
  const z =
    side === 'top'
      ? r.y + PANEL / 2
      : side === 'bottom'
        ? r.y + r.height - PANEL / 2
        : r.y + r.height / 2;
  mesh.position.set(x, SHELL_HEIGHT / 2, z);
  return mesh;
}

/** A number that always faces the camera. */
function label(text: string, x: number, y: number, z: number, width: number): T.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 80, 16);
  ctx.fill();
  ctx.fillStyle = '#14532d';
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50, 236);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthWrite: false }));
  sprite.scale.set(width, (width * 96) / 256, 1);
  sprite.position.set(x, y, z);
  return sprite;
}
