import * as THREE from 'three';
import { ruleEnabled } from '../geometry/basic-rules';

import {
  EventType,
  forEachEdge,
  HallOpening,
  HallZone,
  LayoutRules,
  openingAccessRect,
  Point,
  pointInPolygon,
  Rect,
  ZoneKind,
  zoneClearanceFor
} from '../geometry/placement-rules';
import { makeTextSprite } from './text-sprite';

/** Colour of each zone kind. Red / brown match the source layout's legend colours. */
const ZONE_COLORS: Record<ZoneKind, string> = {
  PASSAGE: '#dc2626',
  NO_CONSTRUCTION: '#8b4513',
  EMERGENCY_EXIT_ACCESS: '#16a34a',
  ENTRY_EXIT_ACCESS: '#0284c7',
  FACILITY_ACCESS: '#ea580c',
  FOYER: '#7c3aed',
  PARTITION: '#475569',
  SMOKE_CURTAIN: '#8a2be2'
};

const ZONE_SHORT: Record<ZoneKind, string> = {
  PASSAGE: 'PASSAGE',
  NO_CONSTRUCTION: 'NO CONSTRUCTION',
  EMERGENCY_EXIT_ACCESS: 'EMERGENCY ACCESS',
  ENTRY_EXIT_ACCESS: 'ENTRY/EXIT ACCESS',
  FACILITY_ACCESS: 'FACILITY ACCESS',
  FOYER: 'FOYER',
  PARTITION: 'PARTITION',
  SMOKE_CURTAIN: 'SMOKE CURTAIN'
};

const CLEARANCE_COLOR = '#f59e0b';

/**
 * Layer 3 — restricted areas: every zone as a filled, outlined polygon, plus a dashed outline at
 * its configured clearance distance. These are the same polygons the rules check, not decoration.
 *
 * A zone that comes from the source plan carries the plan's own colour: it is drawn solid in that
 * colour and without a caption, exactly as the plan shows it (the plan's legend explains it).
 * A rule-engine zone (no colour) gets the translucent kind colour and a short caption.
 * Hidden zones (`visibleInView: false` on the plan, the fire curtains) are not drawn at all —
 * they still restrict placement.
 */
export function buildRestrictedZones(zones: HallZone[], rules: LayoutRules, drawClearance = true): THREE.Group {
  const group = new THREE.Group();
  group.name = 'restricted-zones';

  for (const zone of zones) {
    if (!zone.polygon || zone.polygon.length < 3 || zone.hidden) continue;
    const fromPlan = !!zone.color;
    const color = zone.color || ZONE_COLORS[zone.kind] || '#dc2626';

    const fill = flatPolygon(zone.polygon, color, fromPlan ? 0.95 : 0.42, 0.14);
    fill.userData['zoneId'] = zone.id;
    if (fromPlan) fill.userData['planTooltip'] = zone.label;
    group.add(fill);
    group.add(outline(zone.polygon, color, 0.15));

    const clearance = drawClearance && ruleEnabled(rules, zone.kind) ? zoneClearanceFor(zone, rules) : 0;
    if (clearance > 0) {
      group.add(dashedRect(inflate(bounds(zone.polygon), clearance), color, 0.15));
    }
    if (fromPlan) continue;

    const b = bounds(zone.polygon);
    const label = makeTextSprite([ZONE_SHORT[zone.kind]], {
      color: '#ffffff',
      background: color,
      lineHeight: 0.55,
      bold: true
    });
    label.position.set((b.minX + b.maxX) / 2, 0.9, (b.minZ + b.maxZ) / 2);
    group.add(label);
  }

  return group;
}

/**
 * Layer 4 — pathway / clearance: the peripheral passage along every external wall (ITPO D5),
 * drawn as a band of `clearance` metres inside the boundary, and the access area in front of
 * each opening (ITPO D2/D3).
 */
export function buildClearances(
  boundary: Point[] | null,
  openings: HallOpening[],
  rules: LayoutRules,
  eventType: EventType
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'clearances';
  const material = new THREE.MeshBasicMaterial({
    color: CLEARANCE_COLOR,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const band = ruleEnabled(rules, 'peripheralClearance') ? rules.peripheralClearance : 0;
  if (boundary && boundary.length >= 3 && band > 0) {
    forEachEdge(boundary, (a, b) => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-9) return;

      // Inward normal: the perpendicular whose side is inside the hall.
      let nx = -dz / length;
      let nz = dx / length;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (!pointInPolygon({ x: mid.x + nx * 0.01, z: mid.z + nz * 0.01 }, boundary)) {
        nx = -nx;
        nz = -nz;
      }

      const strip = new THREE.Mesh(new THREE.PlaneGeometry(length, band), material);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = Math.atan2(-dz, dx);
      strip.position.set(mid.x + (nx * band) / 2, 0.135, mid.z + (nz * band) / 2);
      strip.renderOrder = 5;
      group.add(strip);
    });
  }

  for (const opening of openings) {
    const access = openingAccessRect(opening, rules, eventType);
    if (!access) continue;
    const color = opening.kind === 'EMERGENCY' ? ZONE_COLORS.EMERGENCY_EXIT_ACCESS : ZONE_COLORS.ENTRY_EXIT_ACCESS;
    group.add(flatRect(access, color, 0.35, 0.14));
    group.add(outline(rectPoints(access), color, 0.15));
  }

  return group;
}

/**
 * Layer 8 — rule-engine openings (doors with an access area). The plan's own gate / foyer
 * captions (`markers`) are drawn flat at plan scale by `buildExitLabels` in
 * annotations-renderer.ts.
 */
export function buildOpeningMarkers(openings: HallOpening[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'markers';

  for (const opening of openings) {
    const sprite = makeTextSprite([`${opening.kind} ${opening.label}`], {
      color: '#ffffff',
      background: opening.kind === 'EMERGENCY' ? ZONE_COLORS.EMERGENCY_EXIT_ACCESS : ZONE_COLORS.ENTRY_EXIT_ACCESS,
      lineHeight: 0.7,
      bold: true
    });
    sprite.position.set(opening.position.x, 2, opening.position.z);
    group.add(sprite);
  }

  return group;
}

// --- shared flat-geometry helpers (also used by the editor overlay) ---------------------------

export function flatPolygon(points: Point[], color: string, opacity: number, y: number): THREE.Mesh {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)));
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = 6;
  return mesh;
}

export function flatRect(rect: Rect, color: string, opacity: number, y: number): THREE.Mesh {
  return flatPolygon(rectPoints(rect), color, opacity, y);
}

export function outline(points: Point[], color: string, y: number): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, y, p.z)));
  const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
  line.renderOrder = 7;
  return line;
}

export function dashedRect(rect: Rect, color: string, y: number): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    rectPoints(rect).map(p => new THREE.Vector3(p.x, y, p.z))
  );
  const line = new THREE.LineLoop(
    geometry,
    new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, depthTest: false })
  );
  line.computeLineDistances();
  line.renderOrder = 7;
  return line;
}

export function rectPoints(r: Rect): Point[] {
  return [
    { x: r.minX, z: r.minZ },
    { x: r.maxX, z: r.minZ },
    { x: r.maxX, z: r.maxZ },
    { x: r.minX, z: r.maxZ }
  ];
}

export function inflate(r: Rect, d: number): Rect {
  return { minX: r.minX - d, minZ: r.minZ - d, maxX: r.maxX + d, maxZ: r.maxZ + d };
}

function bounds(points: Point[]): Rect {
  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)),
    maxZ: Math.max(...points.map(p => p.z))
  };
}
