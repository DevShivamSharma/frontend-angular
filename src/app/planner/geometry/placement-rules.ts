/**
 * Placement rules for the rule-driven hall editor. Pure: no framework, no ORM, no I/O.
 *
 * Source of the rules: ITPO "Public Safety Measures and Design Guidelines — Third Party Events
 * in Pragati Maidan", September 2022, section D (referenced below as "ITPO D<n>").
 *
 * Frontend preview rules. The backend remains authoritative on save. The passage/open-side
 * extension and split contract are documented in docs/stall-placement-contract.md.
 *
 * Units are metres. Coordinates are the planner's centre-origin system shared with stalls:
 * X to the right, Z down the plan, posX / posZ = the stall CENTRE, width along X, length along Z.
 * Stalls are oriented rectangles; the hall boundary and zones are arbitrary polygons.
 */

/** Tolerance for "touching is allowed" comparisons. Distances come out of sqrt, hence not 1e-8. */
import { validateOrientedPlacement, usableFloor } from './oriented-placement';
import { closestPoints, segmentInsideFloor, stallPolygon } from './polygon-geometry';

export const PLACEMENT_EPSILON = 1e-6;

const EPS = PLACEMENT_EPSILON;

// --- model -------------------------------------------------------------------------------------

export interface Point {
  x: number;
  z: number;
}

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export type EventType = 'B2B' | 'B2C';

export const EVENT_TYPES: readonly EventType[] = ['B2B', 'B2C'];

/** A region of the hall where stalls may not be built. */
export type ZoneKind =
  | 'PASSAGE'
  | 'NO_CONSTRUCTION'
  | 'EMERGENCY_EXIT_ACCESS'
  | 'ENTRY_EXIT_ACCESS'
  | 'FACILITY_ACCESS'
  | 'FOYER'
  | 'PARTITION'
  | 'SMOKE_CURTAIN';

export const ZONE_KINDS: readonly ZoneKind[] = [
  'PASSAGE',
  'NO_CONSTRUCTION',
  'EMERGENCY_EXIT_ACCESS',
  'ENTRY_EXIT_ACCESS',
  'FACILITY_ACCESS',
  'FOYER',
  'PARTITION',
  'SMOKE_CURTAIN',
];

export interface HallZone {
  id: string;
  kind: ZoneKind;
  label: string;
  polygon: Point[];
  /** Metres to keep free around the zone. Overrides `LayoutRules.zoneClearance[kind]`. */
  clearance?: number | null;
  color?: string | null;
  /**
   * Not drawn in the planner's view (SelfCare `visibleInView: false`, e.g. fire-curtain lines).
   * Display only: a hidden zone restricts placement exactly like a visible one.
   */
  hidden?: boolean | null;
}

export type OpeningKind = 'ENTRY' | 'EXIT' | 'SERVICE' | 'EMERGENCY';

export const OPENING_KINDS: readonly OpeningKind[] = ['ENTRY', 'EXIT', 'SERVICE', 'EMERGENCY'];

/** Direction from the opening INTO the hall. NORTH = -Z (towards the top of the plan). */
export type OpeningFacing = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export const OPENING_FACINGS: readonly OpeningFacing[] = ['NORTH', 'SOUTH', 'EAST', 'WEST'];

/** A door in the hall wall. Its access area in front of it must stay free (ITPO D2, D3, D11). */
export interface HallOpening {
  id: string;
  label: string;
  kind: OpeningKind;
  /** Centre of the opening, on the wall. */
  position: Point;
  /** Clear width of the opening in metres. */
  width: number;
  facing: OpeningFacing;
}

/** Every physical rule the validator applies, in metres. Stored per hall. */
export interface LayoutRules {
  /** Configurable 3–5 m per event; a missing setting defaults to 3 m. */
  minPassageWidth: Record<EventType, number>;
  /** ITPO D5: free passage along all external walls. */
  peripheralClearance: number;
  /** ITPO D4/D6/D7: metres kept free around zones of a kind (hose reels, partitions, curtains). */
  zoneClearance?: Partial<Record<ZoneKind, number>> | null;
  /** Depth of the free area in front of an opening. null = the event's minimum passage width. */
  openingAccessDepth?: number | null;
  /** Size of one grid cell in metres. */
  gridUnit: number;
  /** Stall edges and sizes snap to multiples of this, in metres. */
  snapStep: number;
  /** Prefix of persisted stall numbers, e.g. "STALL-" -> "STALL-001". */
  stallNumberPrefix: string;
}

export const DEFAULT_LAYOUT_RULES: LayoutRules = {
  minPassageWidth: { B2B: 3, B2C: 3 },
  peripheralClearance: 1,
  zoneClearance: { FACILITY_ACCESS: 1, PARTITION: 1, SMOKE_CURTAIN: 1 },
  openingAccessDepth: null,
  gridUnit: 1,
  snapStep: 1,
  stallNumberPrefix: 'STALL-',
};

/** Stored (partial) rules merged over the defaults. */
export function effectiveRules(stored: Partial<LayoutRules> | null | undefined): LayoutRules {
  return {
    ...DEFAULT_LAYOUT_RULES,
    ...(stored ?? {}),
    minPassageWidth: { ...DEFAULT_LAYOUT_RULES.minPassageWidth, ...(stored?.minPassageWidth ?? {}) },
    zoneClearance: { ...DEFAULT_LAYOUT_RULES.zoneClearance, ...(stored?.zoneClearance ?? {}) },
  };
}

export type StallStatus = 'AVAILABLE' | 'BOOKED' | 'CANCELLED';

export const STALL_STATUSES: readonly StallStatus[] = ['AVAILABLE', 'BOOKED', 'CANCELLED'];

export interface Footprint {
  /** Clockwise local rotation in the X-right / Z-down plan, as stored by the backend. */
  rotation?: number;
  posX: number;
  posZ: number;
  width: number;
  length: number;
  openSides?: Array<'FRONT' | 'BACK' | 'LEFT' | 'RIGHT'>;
  gateSide?: 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT';
}

export interface PlacementStall extends Footprint {
  id: string;
  stallNumber?: string | null;
  status?: string | null;
}

export interface PlacementContext {
  enforceGrid?: boolean;
  /** Exact circular boundary for halls without an irregular floor outline. */
  circleRadius?: number;
  /** Physical walls/outside masks and floor holes, including those inside an outer ring. */
  obstacles?: Point[][];
  /** Hall outline. null = the rectangle/circle check done elsewhere is the only boundary. */
  boundary: Point[] | null;
  /**
   * Further floor regions of the same hall that are NOT connected to `boundary`, e.g. the foyer
   * below Hall 1GF / 14GF, which the plan separates from the main floor by an outside strip. A
   * stall inside any of them is inside the hall. See `traceFloor` / `extraFloorRegions`.
   */
  regions?: Point[][] | null;
  zones: HallZone[];
  openings: HallOpening[];
  rules: LayoutRules;
  eventType: EventType;
  /** Every stall of the layout. Cancelled stalls are ignored: they no longer occupy space. */
  stalls: PlacementStall[];
}

export type ViolationCode =
  | 'INVALID_PASSAGE_WIDTH'
  | 'INVALID_OPEN_SIDES'
  | 'OPEN_SIDE_BLOCKED'
  | 'CORNER_PASSAGE'
  | 'INVALID_TOUCHING'
  | 'INVALID_BACK_TO_BACK'
  | 'OPEN_SIDE_PASSAGE'
  | 'INVALID_DIMENSIONS'
  | 'OUTSIDE_HALL'
  | 'STALL_OVERLAP'
  | 'RESTRICTED_ZONE'
  | 'PATHWAY_WIDTH'
  | 'PERIPHERAL_CLEARANCE'
  | 'ENTRY_EXIT_BLOCKED'
  | 'EMERGENCY_ACCESS'
  | 'NO_CONTIGUOUS_SPACE';

/** Where a violation is, so the editor can draw it. */
export type ViolationGeometry =
  | { type: 'rect'; rect: Rect }
  | { type: 'polygon'; points: Point[] };

export interface Violation {
  code: ViolationCode;
  /** Which guideline the rule comes from, e.g. "ITPO D1". */
  ruleRef: string;
  message: string;
  geometry: ViolationGeometry[];
  /** Other stalls involved (overlapped, too close). */
  relatedStallIds: string[];
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

// --- validation --------------------------------------------------------------------------------

/**
 * Checks one candidate footprint against every rule. `ignoreId` is the stall being moved or
 * resized, so it is not compared with its own old position.
 *
 * Every violation is reported (not only the first) so the editor can draw all of them.
 */
export function validatePlacement(
  candidate: Footprint,
  ctx: PlacementContext,
  ignoreId: string | null = null,
): ValidationResult {
  const violations: Violation[] = [];
  const passage = ctx.rules.minPassageWidth[ctx.eventType];
  if (!Number.isFinite(passage) || passage < 3 || passage > 5) {
    return { valid: false, violations: [{ code: 'INVALID_PASSAGE_WIDTH', ruleRef: 'Passage',
      message: 'Choose a passage width between 3 and 5 m.', geometry: [], relatedStallIds: [] }] };
  }
  if (!openSidesOf(candidate).length) {
    return { valid: false, violations: [{ code: 'INVALID_OPEN_SIDES', ruleRef: 'Open sides',
      message: 'A stall must have at least one valid open side.', geometry: [], relatedStallIds: [] }] };
  }

  if (!validDimensions(candidate, ctx.rules.snapStep)) {
    violations.push({
      code: 'INVALID_DIMENSIONS',
      ruleRef: 'Grid',
      message: `Stall size must be a positive multiple of ${fmt(ctx.rules.snapStep)} m.`,
      geometry: [],
      relatedStallIds: [],
    });
    return { valid: false, violations };
  }
  if ((candidate.rotation ?? 0) % 360 !== 0 || ctx.stalls.some(s => (s.rotation ?? 0) % 360 !== 0)) {
    return validateOrientedPlacement(candidate, { ...ctx, enforceGrid: true }, ignoreId);
  }

  const rect = footprintRect(candidate);
  if (ctx.circleRadius !== undefined && !rectInsideCircle(rect, ctx.circleRadius - ctx.rules.peripheralClearance)) {
    violations.push({ code: 'OUTSIDE_HALL', ruleRef: 'Hall boundary',
      message: 'Stall must stay inside the circular hall and its wall clearance.',
      geometry: [{ type: 'rect', rect }], relatedStallIds: [] });
  }
  for (const obstacle of ctx.obstacles ?? []) {
    if (rectOverlapsPolygon(rect, obstacle)) violations.push({ code: 'RESTRICTED_ZONE', ruleRef: 'Hall floor',
      message: 'Stall overlaps a wall, outside area or floor opening.',
      geometry: [{ type: 'polygon', points: obstacle }], relatedStallIds: [] });
  }

  // Hall boundary and peripheral passage (ITPO D5). The stall must sit wholly inside ONE floor
  // region; the peripheral clearance is measured against the walls of that region.
  const outlines = [ctx.boundary, ...(ctx.regions ?? [])].filter(
    (o): o is Point[] => !!o && o.length >= 3,
  );
  if (outlines.length) {
    const home = outlines.find((o) => rectInsidePolygon(rect, o));
    if (!home) {
      violations.push({
        code: 'OUTSIDE_HALL',
        ruleRef: 'Hall boundary',
        message: 'Stall is outside the hall boundary.',
        geometry: [{ type: 'rect', rect }],
        relatedStallIds: [],
      });
    } else {
      const clearance = ctx.rules.peripheralClearance;
      const bands: ViolationGeometry[] = [];
      let nearest = Infinity;

      forEachEdge(home, (a, b) => {
        const d = segmentRectDistance(a, b, rect);
        if (d < clearance - EPS) {
          nearest = Math.min(nearest, d);
          bands.push({ type: 'rect', rect: edgeGapRect(a, b, rect) });
        }
      });

      if (bands.length) {
        violations.push({
          code: 'PERIPHERAL_CLEARANCE',
          ruleRef: 'ITPO D5',
          message:
            `${fmt(clearance)} m peripheral clearance from the external wall is violated ` +
            `(${fmt(nearest)} m left).`,
          geometry: bands,
          relatedStallIds: [],
        });
      }
    }
  }

  // Other stalls: overlap, and the minimum passage between separate stalls (ITPO D1).
  const overlapped: PlacementStall[] = [];
  const overlapAreas: ViolationGeometry[] = [];
  const candidateCorner = isCornerStall(candidate, ctx);
  const neighbours = ctx.stalls.filter(s => s.status !== 'CANCELLED' && String(s.id) !== ignoreId);
  const nearest = Math.min(...neighbours.map(s => rectDistance(rect, footprintRect(s))));

  for (const other of ctx.stalls) {
    if (ignoreId !== null && String(other.id) === String(ignoreId)) continue;
    if (other.status === 'CANCELLED') continue;

    const otherRect = footprintRect(other);

    if (rectsOverlap(rect, otherRect)) {
      overlapped.push(other);
      overlapAreas.push({ type: 'rect', rect: rectIntersection(rect, otherRect) });
      continue;
    }

    const gap = rectDistance(rect, otherRect);
    const otherCorner = isCornerStall(other, ctx);
    const corner = candidateCorner || otherCorner;
    const nearestToOtherCorner = otherCorner && gap <= Math.min(...neighbours
      .filter(s => s.id !== other.id).map(s => rectDistance(otherRect, footprintRect(s)))) + EPS;
    if (gap > EPS && ((candidateCorner && gap <= nearest + EPS) || nearestToOtherCorner) && ctx.circleRadius === undefined) {
      const [from, to] = closestPoints(stallPolygon(candidate), stallPolygon(other));
      if (!segmentInsideFloor(from, to, usableFloor(ctx))) violations.push({
        code: 'CORNER_PASSAGE', ruleRef: 'Usable passage',
        message: 'The gap to the nearest stall crosses outside the usable hall; exterior space is not passage.',
        geometry: [{ type: 'rect', rect: gapRect(rect, otherRect) }], relatedStallIds: [String(other.id)]
      });
    }
    const touching = gap <= EPS;
    const allowedTouch = touching && !corner && backToBack(candidate, other);
    if (gap < passage - EPS && !allowedTouch) {
      violations.push({
        code: corner ? 'CORNER_PASSAGE' : touching ? 'INVALID_TOUCHING' : 'PATHWAY_WIDTH',
        ruleRef: 'Stall passage',
        message: touching && !corner
          ? `Touching stalls must be back-to-back with opposite outward open sides next to ${stallLabel(other)}.`
          : (corner ? 'Corner stalls need a clear passage. ' : '') +
          `Required ${fmt(passage)} m passage (${ctx.eventType}) is blocked: ` +
          `only ${fmt(gap)} m left next to ${stallLabel(other)}.`,
        geometry: [{ type: 'rect', rect: gapRect(rect, otherRect) }],
        relatedStallIds: [String(other.id)],
      });
    }
  }

  // Check the candidate's full open frontage, then protect existing stalls' frontage too.
  for (const side of openSidesOf(candidate)) {
    const access = openSideAccessRect(candidate, side, passage);
    const home = outlines.find(o => rectInsidePolygon(rect, o));
    const outside = (outlines.length > 0 && (!home || !rectInsidePolygon(access, home))) ||
      (ctx.circleRadius !== undefined && !rectInsideCircle(access, ctx.circleRadius));
    const blocked = (ctx.obstacles ?? []).some(o => rectOverlapsPolygon(access, o)) ||
      ctx.zones.some(z => ['NO_CONSTRUCTION', 'PARTITION', 'SMOKE_CURTAIN', 'FACILITY_ACCESS'].includes(z.kind) &&
        rectOverlapsPolygon(access, z.polygon));
    const others = ctx.stalls.filter(s => s.status !== 'CANCELLED' && String(s.id) !== ignoreId &&
      rectsOverlap(access, footprintRect(s)));
    if (outside || blocked || others.length) violations.push({
      code: 'OPEN_SIDE_BLOCKED', ruleRef: 'Open-side access',
      message: `${side} open side needs ${fmt(passage)} m of clear passage inside the hall.`,
      geometry: [{ type: 'rect', rect: access }], relatedStallIds: others.map(s => String(s.id))
    });
  }
  for (const other of ctx.stalls) {
    if (other.status === 'CANCELLED' || String(other.id) === ignoreId) continue;
    for (const side of openSidesOf(other)) {
      const access = openSideAccessRect(other, side, passage);
      if (rectsOverlap(rect, access)) violations.push({ code: 'OPEN_SIDE_BLOCKED', ruleRef: 'Open-side access',
        message: `Blocks the ${side} open side of ${stallLabel(other)}; keep ${fmt(passage)} m clear.`,
        geometry: [{ type: 'rect', rect: access }], relatedStallIds: [String(other.id)] });
    }
  }

  if (overlapped.length) {
    violations.unshift({
      code: 'STALL_OVERLAP',
      ruleRef: 'Occupancy',
      message:
        overlapped.length === 1
          ? `Overlaps existing stall ${stallLabel(overlapped[0])}.`
          : `Overlaps ${overlapped.length} existing stalls (${overlapped.map(stallLabel).join(', ')}).`,
      geometry: overlapAreas,
      relatedStallIds: overlapped.map((s) => String(s.id)),
    });
  }

  // Restricted zones, with their configured clearance (ITPO D3, D4, D6, D7, D11, D12).
  for (const zone of ctx.zones) {
    if (!zone.polygon || zone.polygon.length < 3) continue;

    const clearance = zoneClearanceFor(zone, ctx.rules);
    const inside = rectOverlapsPolygon(rect, zone.polygon);
    const distance = inside ? 0 : polygonRectDistance(zone.polygon, rect);

    if (inside || distance < clearance - EPS) {
      violations.push({
        code: 'RESTRICTED_ZONE',
        ruleRef: ZONE_RULE_REF[zone.kind],
        message: inside
          ? `Overlaps ${zone.label} (${ZONE_TEXT[zone.kind]}).`
          : `Keep ${fmt(clearance)} m free around ${zone.label} (${fmt(distance)} m left).`,
        geometry: [
          { type: 'polygon', points: zone.polygon },
          ...(inside ? [{ type: 'rect' as const, rect: rectIntersection(rect, polygonBounds(zone.polygon)) }] : []),
        ],
        relatedStallIds: [],
      });
    }
  }

  // Access in front of doors (ITPO D2, D3, D11).
  for (const opening of ctx.openings) {
    const access = openingAccessRect(opening, ctx.rules, ctx.eventType);
    if (!access || !rectsOverlap(rect, access)) continue;

    const emergency = opening.kind === 'EMERGENCY';
    violations.push({
      code: emergency ? 'EMERGENCY_ACCESS' : 'ENTRY_EXIT_BLOCKED',
      ruleRef: emergency ? 'ITPO D3' : 'ITPO D2',
      message: emergency
        ? `Stall overlaps the access zone of emergency exit ${opening.label}.`
        : `Stall blocks the access zone of ${opening.kind.toLowerCase()} ${opening.label}.`,
      geometry: [{ type: 'rect', rect: access }, { type: 'rect', rect: rectIntersection(rect, access) }],
      relatedStallIds: [],
    });
  }

  return { valid: violations.length === 0, violations };
}

/** One audit entry per stall that currently breaks a rule. */
export interface AuditEntry {
  stallId: string;
  stallNumber: string | null;
  violations: Violation[];
}

/**
 * Checks every active stall of a layout against the others. Used to REPORT problems in existing
 * layouts; it never blocks anything. A pair problem (overlap, narrow passage) is reported once,
 * on the first stall of the pair.
 */
export function auditLayout(ctx: PlacementContext): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const reportedPairs = new Set<string>();

  for (const stall of ctx.stalls) {
    if (stall.status === 'CANCELLED') continue;

    const result = validatePlacement(stall, ctx, String(stall.id));
    const kept = result.violations.filter((v) => {
      if (v.relatedStallIds.length === 0) return true;
      const key = `${v.code}|${[String(stall.id), ...v.relatedStallIds].sort().join(',')}`;
      if (reportedPairs.has(key)) return false;
      reportedPairs.add(key);
      return true;
    });

    if (kept.length) {
      entries.push({ stallId: String(stall.id), stallNumber: stall.stallNumber ?? null, violations: kept });
    }
  }

  return entries;
}

/** The free area that must stay in front of an opening, or null when it has no usable width. */
export function openingAccessRect(
  opening: HallOpening,
  rules: LayoutRules,
  eventType: EventType,
): Rect | null {
  const width = Number(opening.width);
  if (!Number.isFinite(width) || width <= 0) return null;

  const depth = rules.openingAccessDepth ?? rules.minPassageWidth[eventType];
  const { x, z } = opening.position;
  const half = width / 2;

  switch (opening.facing) {
    case 'NORTH':
      return { minX: x - half, maxX: x + half, minZ: z - depth, maxZ: z };
    case 'SOUTH':
      return { minX: x - half, maxX: x + half, minZ: z, maxZ: z + depth };
    case 'EAST':
      return { minX: x, maxX: x + depth, minZ: z - half, maxZ: z + half };
    case 'WEST':
      return { minX: x - depth, maxX: x, minZ: z - half, maxZ: z + half };
    default:
      return null;
  }
}

export function zoneClearanceFor(zone: HallZone, rules: LayoutRules): number {
  const own = zone.clearance;
  if (own != null && Number.isFinite(own)) return Math.max(0, own);
  return Math.max(0, rules.zoneClearance?.[zone.kind] ?? 0);
}

/** Formats a stall number the way it is persisted: prefix + zero-padded sequence. */
export function formatStallNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

export function openSidesOf(stall: Footprint): NonNullable<Footprint['openSides']> {
  return [...new Set(stall.openSides ?? [stall.gateSide ?? 'FRONT'])]
    .filter(s => ['FRONT', 'BACK', 'LEFT', 'RIGHT'].includes(s));
}

export function openSideAccessRect(stall: Footprint, side: NonNullable<Footprint['gateSide']>, depth: number): Rect {
  const r = footprintRect(stall);
  switch (side) {
    case 'FRONT': return { ...r, minZ: r.maxZ, maxZ: r.maxZ + depth };
    case 'BACK': return { ...r, minZ: r.minZ - depth, maxZ: r.minZ };
    case 'LEFT': return { ...r, minX: r.minX - depth, maxX: r.minX };
    case 'RIGHT': return { ...r, minX: r.maxX, maxX: r.maxX + depth };
  }
}

/** A corner is a pair of adjacent non-collinear walls each within one passage width. */
export function isCornerStall(stall: Footprint, ctx: PlacementContext): boolean {
  const r = footprintRect(stall);
  const distance = ctx.rules.minPassageWidth[ctx.eventType];
  return [ctx.boundary, ...(ctx.regions ?? []), ...(ctx.obstacles ?? [])].some(outline => outline?.some((b, i) => {
    const a = outline[(i + outline.length - 1) % outline.length];
    const c = outline[(i + 1) % outline.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    return Math.abs(cross) > EPS && segmentRectDistance(a, b, r) <= distance + EPS &&
      segmentRectDistance(b, c, r) <= distance + EPS;
  }) ?? false);
}

function backToBack(a: Footprint, b: Footprint): boolean {
  const ar = footprintRect(a), br = footprintRect(b);
  const as = openSidesOf(a), bs = openSidesOf(b);
  // A single outward frontage leaves the shared boundary closed. Point-only contact is invalid.
  if (as.length !== 1 || bs.length !== 1) return false;
  const xOverlap = Math.min(ar.maxX, br.maxX) - Math.max(ar.minX, br.minX) > EPS;
  const zOverlap = Math.min(ar.maxZ, br.maxZ) - Math.max(ar.minZ, br.minZ) > EPS;
  return (xOverlap && Math.abs(ar.maxZ - br.minZ) <= EPS && as[0] === 'BACK' && bs[0] === 'FRONT') ||
    (xOverlap && Math.abs(br.maxZ - ar.minZ) <= EPS && as[0] === 'FRONT' && bs[0] === 'BACK') ||
    (zOverlap && Math.abs(ar.maxX - br.minX) <= EPS && as[0] === 'LEFT' && bs[0] === 'RIGHT') ||
    (zOverlap && Math.abs(br.maxX - ar.minX) <= EPS && as[0] === 'RIGHT' && bs[0] === 'LEFT');
}

function rectInsideCircle(r: Rect, radius: number): boolean {
  return radius > 0 && Math.hypot(Math.max(Math.abs(r.minX), Math.abs(r.maxX)),
    Math.max(Math.abs(r.minZ), Math.abs(r.maxZ))) <= radius + EPS;
}

const ZONE_TEXT: Record<ZoneKind, string> = {
  PASSAGE: 'compulsory passage for entry/exit/services',
  NO_CONSTRUCTION: 'no construction zone',
  EMERGENCY_EXIT_ACCESS: 'emergency exit access zone',
  ENTRY_EXIT_ACCESS: 'entry/exit access zone',
  FACILITY_ACCESS: 'fire-safety / public facility access',
  FOYER: 'foyer / pre-function restriction',
  PARTITION: 'collapsible partition path',
  SMOKE_CURTAIN: 'area below a smoke curtain',
};

const ZONE_RULE_REF: Record<ZoneKind, string> = {
  PASSAGE: 'ITPO D2',
  NO_CONSTRUCTION: 'ITPO D4',
  EMERGENCY_EXIT_ACCESS: 'ITPO D3',
  ENTRY_EXIT_ACCESS: 'ITPO D2',
  FACILITY_ACCESS: 'ITPO D4',
  FOYER: 'ITPO D11',
  PARTITION: 'ITPO D6',
  SMOKE_CURTAIN: 'ITPO D7',
};

function validDimensions(f: Footprint, snapStep: number): boolean {
  const { width, length } = f;
  if (![width, length, f.posX, f.posZ, f.rotation ?? 0].every(Number.isFinite)) return false;
  if (width <= EPS || length <= EPS) return false;
  if (!(snapStep > 0)) return true;
  return isMultiple(width, snapStep) && isMultiple(length, snapStep);
}

function isMultiple(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

function stallLabel(stall: PlacementStall): string {
  return stall.stallNumber || 'an unsaved stall';
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// --- geometry ----------------------------------------------------------------------------------

export function footprintRect(f: Footprint): Rect {
  if ((f.rotation ?? 0) % 360 !== 0) return polygonBounds(stallPolygon(f));
  return {
    minX: f.posX - f.width / 2,
    maxX: f.posX + f.width / 2,
    minZ: f.posZ - f.length / 2,
    maxZ: f.posZ + f.length / 2,
  };
}

export function rectToFootprint(r: Rect): Footprint {
  return {
    posX: (r.minX + r.maxX) / 2,
    posZ: (r.minZ + r.maxZ) / 2,
    width: r.maxX - r.minX,
    length: r.maxZ - r.minZ,
  };
}

/** Interiors intersect. Edge-touching rectangles do NOT overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS
  );
}

export function rectIntersection(a: Rect, b: Rect): Rect {
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
}

/** Shortest distance between two rectangles; 0 when they touch or overlap. */
export function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dz = Math.max(0, b.minZ - a.maxZ, a.minZ - b.maxZ);
  return Math.hypot(dx, dz);
}

/** The empty strip between two separate rectangles — what a passage would have to fit into. */
export function gapRect(a: Rect, b: Rect): Rect {
  const xOverlap = a.minX < b.maxX && b.minX < a.maxX;
  const zOverlap = a.minZ < b.maxZ && b.minZ < a.maxZ;

  const between = (a1: number, a2: number, b1: number, b2: number): [number, number] =>
    a2 <= b1 ? [a2, b1] : [b2, a1];

  const [gx1, gx2] = xOverlap
    ? [Math.max(a.minX, b.minX), Math.min(a.maxX, b.maxX)]
    : between(a.minX, a.maxX, b.minX, b.maxX);
  const [gz1, gz2] = zOverlap
    ? [Math.max(a.minZ, b.minZ), Math.min(a.maxZ, b.maxZ)]
    : between(a.minZ, a.maxZ, b.minZ, b.maxZ);

  return { minX: gx1, maxX: gx2, minZ: gz1, maxZ: gz2 };
}

export function polygonBounds(points: Point[]): Rect {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Even-odd rule. Meant for points clearly inside or outside (centres), not points on an edge. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > p.z !== b.z > p.z && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Whole rectangle inside the polygon; the rectangle may touch the boundary. */
export function rectInsidePolygon(rect: Rect, polygon: Point[]): boolean {
  // If no boundary edge passes through the rectangle's interior, the rectangle is entirely on
  // one side of the boundary — its centre tells which.
  return !polygonCutsRect(polygon, rect) && pointInPolygon(rectCentre(rect), polygon);
}

/** Interiors intersect; touching the polygon's edge is not an overlap. */
export function rectOverlapsPolygon(rect: Rect, polygon: Point[]): boolean {
  return polygonCutsRect(polygon, rect) || pointInPolygon(rectCentre(rect), polygon);
}

/** Shortest distance from the rectangle to the polygon outline; 0 when they overlap. */
export function polygonRectDistance(polygon: Point[], rect: Rect): number {
  if (rectOverlapsPolygon(rect, polygon)) return 0;

  let best = Infinity;
  forEachEdge(polygon, (a, b) => {
    best = Math.min(best, segmentRectDistance(a, b, rect));
  });
  return best;
}

export function segmentRectDistance(a: Point, b: Point, rect: Rect): number {
  if (segmentCutsRect(a, b, rect)) return 0;

  const corners: Point[] = [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ },
  ];

  return Math.min(
    pointRectDistance(a, rect),
    pointRectDistance(b, rect),
    ...corners.map((c) => pointSegmentDistance(c, a, b)),
  );
}

export function forEachEdge(polygon: Point[], fn: (a: Point, b: Point) => void): void {
  for (let i = 0; i < polygon.length; i++) {
    fn(polygon[i], polygon[(i + 1) % polygon.length]);
  }
}

function rectCentre(rect: Rect): Point {
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
}

function polygonCutsRect(polygon: Point[], rect: Rect): boolean {
  let cuts = false;
  forEachEdge(polygon, (a, b) => {
    if (!cuts && segmentCutsRect(a, b, rect)) cuts = true;
  });
  return cuts;
}

/**
 * Does the segment pass through the rectangle's open interior? Liang–Barsky clipping against the
 * rectangle shrunk by EPS, so a segment lying on the rectangle's border does not count.
 */
function segmentCutsRect(a: Point, b: Point, rect: Rect): boolean {
  const minX = rect.minX + EPS;
  const maxX = rect.maxX - EPS;
  const minZ = rect.minZ + EPS;
  const maxZ = rect.maxZ - EPS;
  if (minX >= maxX || minZ >= maxZ) return false;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };

  if (
    clip(-dx, a.x - minX) &&
    clip(dx, maxX - a.x) &&
    clip(-dz, a.z - minZ) &&
    clip(dz, maxZ - a.z)
  ) {
    return t1 - t0 > 1e-12;
  }
  return false;
}

function pointRectDistance(p: Point, rect: Rect): number {
  const dx = Math.max(rect.minX - p.x, 0, p.x - rect.maxX);
  const dz = Math.max(rect.minZ - p.z, 0, p.z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** The strip between a wall edge and a rectangle that is too close to it, for drawing. */
function edgeGapRect(a: Point, b: Point, rect: Rect): Rect {
  const minEdgeX = Math.min(a.x, b.x);
  const maxEdgeX = Math.max(a.x, b.x);
  const minEdgeZ = Math.min(a.z, b.z);
  const maxEdgeZ = Math.max(a.z, b.z);
  const thin = 0.05;

  if (Math.abs(a.z - b.z) < EPS) {
    // Horizontal wall.
    const x1 = Math.max(rect.minX, minEdgeX);
    const x2 = Math.min(rect.maxX, maxEdgeX);
    const z = a.z;
    const [z1, z2] = z <= rect.minZ ? [z, rect.minZ] : [rect.maxZ, z];
    return { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: z1, maxZ: Math.max(z2, z1 + thin) };
  }

  if (Math.abs(a.x - b.x) < EPS) {
    // Vertical wall.
    const z1 = Math.max(rect.minZ, minEdgeZ);
    const z2 = Math.min(rect.maxZ, maxEdgeZ);
    const x = a.x;
    const [x1, x2] = x <= rect.minX ? [x, rect.minX] : [rect.maxX, x];
    return { minX: x1, maxX: Math.max(x2, x1 + thin), minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2) };
  }

  // Diagonal wall: the box spanning the edge's extent near the rectangle.
  return {
    minX: Math.min(minEdgeX, rect.minX),
    maxX: Math.max(maxEdgeX, rect.maxX),
    minZ: Math.min(minEdgeZ, rect.minZ),
    maxZ: Math.max(maxEdgeZ, rect.maxZ),
  };
}

// --- hall floor from the source plan's rectangles -----------------------------------------------

/**
 * One rectangle of the source plan (SelfCare `nonClickableAreas`, stored as the hall's
 * `blockedAreas`): centre-origin metres, like stalls. Only the fields the floor needs.
 */
export interface FloorArea {
  posX: number;
  posZ: number;
  width: number;
  length: number;
  kind: 'outside' | 'wall' | 'zone';
}

/** One connected piece of hall floor: its outer ring and any interior holes. */
export interface FloorRegion {
  outer: Point[];
  holes: Point[][];
  /** A point strictly inside the floor of this region (a cell centre), for containment tests. */
  sample: Point;
  area: number;
}

/**
 * The hall floor as it appears on the source plan: every connected region, with its holes.
 *
 * WHY THIS EXISTS. The plan is a canvas of `hallWidth x hallLength` metres on which white
 * ('outside') rectangles hide what is not hall and purple ('wall') rectangles draw the walls.
 * Two things about real plans broke the old single-polygon outline:
 *   1. A hall can have SEVERAL floor regions. Hall 1GF / 14GF have a foyer below the main floor,
 *      separated from it by an outside strip; one polygon cannot hold both, so the foyer was
 *      either dropped or the whole outline was discarded.
 *   2. Walls and zones may lie partly OUTSIDE `length x breadth` (Hall 8-9-10 reaches y = 45 on a
 *      43 m canvas; the 14GF foyer walls reach past its breadth). Clipping to the canvas cut the
 *      bottom of the plan off.
 *
 * So the canvas here is the hall rectangle GROWN to cover every wall and zone rectangle. White
 * masks never grow it: they only hide. A cell is floor when no outside/wall rectangle covers it
 * and either it lies inside the original hall rectangle or it is enclosed (its connected piece
 * does not reach the edge of the grown canvas) - so the grown margin never turns into open
 * floor, while a foyer closed off by its own walls beyond the breadth does.
 *
 * Exact for axis-aligned input (coordinate compression, no sampling). Regions come back largest
 * first. Returns [] when the plan has no outside/wall rectangle, i.e. the hall is its rectangle.
 */
export function traceFloor(areas: readonly FloorArea[], hallWidth: number, hallLength: number): FloorRegion[] {
  const valid = areas.filter(
    (a) =>
      a &&
      Number.isFinite(a.posX) &&
      Number.isFinite(a.posZ) &&
      Number.isFinite(a.width) &&
      Number.isFinite(a.length) &&
      a.width > 0 &&
      a.length > 0,
  );
  const toRect = (a: FloorArea): Rect => ({
    minX: a.posX - a.width / 2,
    maxX: a.posX + a.width / 2,
    minZ: a.posZ - a.length / 2,
    maxZ: a.posZ + a.length / 2,
  });
  const solid = valid.filter((a) => a.kind === 'outside' || a.kind === 'wall').map(toRect);
  if (!solid.length || !(hallWidth > 0) || !(hallLength > 0)) return [];

  const hall: Rect = { minX: -hallWidth / 2, maxX: hallWidth / 2, minZ: -hallLength / 2, maxZ: hallLength / 2 };
  const canvas = { ...hall };
  for (const r of valid.filter((a) => a.kind !== 'outside').map(toRect)) {
    canvas.minX = Math.min(canvas.minX, r.minX);
    canvas.maxX = Math.max(canvas.maxX, r.maxX);
    canvas.minZ = Math.min(canvas.minZ, r.minZ);
    canvas.maxZ = Math.max(canvas.maxZ, r.maxZ);
  }

  const cuts = (lo: number, hi: number, values: number[]): number[] =>
    [...new Set([lo, hi, hall.minX, hall.maxX, hall.minZ, hall.maxZ, ...values].map(snapCut))]
      .filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9)
      .sort((a, b) => a - b);
  const xs = cuts(canvas.minX, canvas.maxX, solid.flatMap((r) => [r.minX, r.maxX]));
  const zs = cuts(canvas.minZ, canvas.maxZ, solid.flatMap((r) => [r.minZ, r.maxZ]));
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  if (nx < 1 || nz < 1) return [];

  // 1. Covered cells: mark each solid rectangle's index range (no per-cell rectangle scan).
  const covered = new Uint8Array(nx * nz);
  const lower = (arr: number[], v: number): number => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const r of solid) {
    const i0 = lower(xs, snapCut(r.minX));
    const i1 = lower(xs, snapCut(r.maxX));
    const j0 = lower(zs, snapCut(r.minZ));
    const j1 = lower(zs, snapCut(r.maxZ));
    for (let i = Math.max(0, i0); i < Math.min(nx, i1); i++) {
      for (let j = Math.max(0, j0); j < Math.min(nz, j1); j++) covered[i * nz + j] = 1;
    }
  }

  // 2. Connected pieces of uncovered cells, and whether each reaches the canvas edge.
  const piece = new Int32Array(nx * nz).fill(-1);
  const open: boolean[] = [];
  for (let start = 0; start < nx * nz; start++) {
    if (covered[start] || piece[start] !== -1) continue;
    const id = open.length;
    let reachesEdge = false;
    const stack = [start];
    piece[start] = id;
    while (stack.length) {
      const k = stack.pop() as number;
      const i = Math.floor(k / nz);
      const j = k % nz;
      if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) reachesEdge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = ni * nz + nj;
        if (!covered[nk] && piece[nk] === -1) {
          piece[nk] = id;
          stack.push(nk);
        }
      }
    }
    open.push(reachesEdge);
  }

  // 3. Floor cells.
  const floor = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      if (covered[k]) continue;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const inHall = cx > hall.minX && cx < hall.maxX && cz > hall.minZ && cz < hall.maxZ;
      if (inHall || !open[piece[k]]) floor[k] = 1;
    }
  }
  const isFloor = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz && floor[i * nz + j] === 1;

  // 4. Boundary edges, directed with the floor on the right (in x-right / z-down plan space),
  //    stitched into rings. At a vertex shared by two rings (diagonally touching cells) the
  //    rightmost turn is taken, so rings never cross.
  const key = (x: number, z: number): string => `${x},${z}`;
  const outgoing = new Map<string, Point[]>();
  const add = (a: Point, b: Point): void => {
    const k = key(a.x, a.z);
    const list = outgoing.get(k);
    if (list) list.push(b);
    else outgoing.set(k, [b]);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!isFloor(i, j)) continue;
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      if (!isFloor(i, j - 1)) add({ x: x0, z: z0 }, { x: x1, z: z0 });
      if (!isFloor(i + 1, j)) add({ x: x1, z: z0 }, { x: x1, z: z1 });
      if (!isFloor(i, j + 1)) add({ x: x1, z: z1 }, { x: x0, z: z1 });
      if (!isFloor(i - 1, j)) add({ x: x0, z: z1 }, { x: x0, z: z0 });
    }
  }

  const rings: Point[][] = [];
  while (outgoing.size) {
    const [startKey, firstTargets] = outgoing.entries().next().value as [string, Point[]];
    const [sx, sz] = startKey.split(',').map(Number);
    const ring: Point[] = [{ x: sx, z: sz }];
    let prev: Point = { x: sx, z: sz };
    let target = firstTargets.pop() as Point;
    if (!firstTargets.length) outgoing.delete(startKey);

    for (let guard = 0; guard < 1e6; guard++) {
      if (target.x === sx && target.z === sz) break;
      ring.push(target);
      const k = key(target.x, target.z);
      const options = outgoing.get(k);
      if (!options?.length) break;
      const next = pickTurn(prev, target, options);
      options.splice(options.indexOf(next), 1);
      if (!options.length) outgoing.delete(k);
      prev = target;
      target = next;
    }

    const simplified = ring.filter((q, k) => {
      const p = ring[(k - 1 + ring.length) % ring.length];
      const r = ring[(k + 1) % ring.length];
      return Math.abs((q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x)) > 1e-9;
    });
    if (simplified.length >= 3) rings.push(simplified.map((p) => ({ x: roundCoord(p.x), z: roundCoord(p.z) })));
  }

  // 5. Outer rings run clockwise on screen (positive signed area in x-right / z-down space with
  //    the floor on the right); holes run the other way. Each hole goes to the smallest outer ring
  //    that contains it.
  const signed = (ring: Point[]): number =>
    ring.reduce((sum, p, k) => {
      const q = ring[(k + 1) % ring.length];
      return sum + p.x * q.z - q.x * p.z;
    }, 0) / 2;
  const outers = rings.filter((r) => signed(r) > 0);
  const holes = rings.filter((r) => signed(r) < 0);

  const regions: FloorRegion[] = outers.map((outer) => ({ outer, holes: [], sample: outer[0], area: signed(outer) }));
  for (const hole of holes) {
    const probe = { x: (hole[0].x + hole[1].x) / 2, z: (hole[0].z + hole[1].z) / 2 };
    const owner = regions
      .filter((r) => pointInPolygon(nudgeInside(probe, hole), r.outer))
      .sort((a, b) => a.area - b.area)[0];
    if (owner) {
      owner.holes.push(hole);
      owner.area += signed(hole);
    }
  }

  // A sample point strictly inside each region's floor: the centre of one of its floor cells.
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!floor[i * nz + j]) continue;
      const c = { x: (xs[i] + xs[i + 1]) / 2, z: (zs[j] + zs[j + 1]) / 2 };
      const owner = regions
        .filter((r) => pointInPolygon(c, r.outer))
        .sort((a, b) => a.area - b.area)[0];
      if (owner && owner.sample === owner.outer[0]) owner.sample = c;
    }
  }

  return regions.sort((a, b) => b.area - a.area);
}

/**
 * Floor regions that are not already covered by `boundary`, as outlines for
 * `PlacementContext.regions`. With no boundary, every region counts.
 */
export function extraFloorRegions(boundary: Point[] | null | undefined, floor: FloorRegion[]): Point[][] {
  const main = boundary && boundary.length >= 3 ? boundary : null;
  return floor.filter((r) => !main || !pointInPolygon(r.sample, main)).map((r) => r.outer);
}

/** Of several outgoing edges at a vertex, the one turning furthest right (keeps rings simple). */
function pickTurn(prev: Point, at: Point, options: Point[]): Point {
  if (options.length === 1) return options[0];
  const inX = at.x - prev.x;
  const inZ = at.z - prev.z;
  let best = options[0];
  let bestScore = -Infinity;
  for (const o of options) {
    const outX = o.x - at.x;
    const outZ = o.z - at.z;
    // In x-right / z-down space a positive cross product is a right (clockwise) turn.
    const cross = inX * outZ - inZ * outX;
    const dot = inX * outX + inZ * outZ;
    const score = Math.atan2(cross, dot);
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** A point just off a hole's first edge, on the floor side, for the containment test. */
function nudgeInside(p: Point, hole: Point[]): Point {
  const a = hole[0];
  const b = hole[1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  // Hole rings run with the floor on their right too; right of (dx, dz) is (-dz, dx) here.
  return { x: p.x - ((b.z - a.z) / len) * 1e-3, z: p.z + ((b.x - a.x) / len) * 1e-3 };
}

function snapCut(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function roundCoord(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
