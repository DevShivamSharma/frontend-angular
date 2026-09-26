import type { HallZone, Point, ZoneKind } from './placement-rules';
import type {
  AmenityKind,
  BlockedArea,
  Hall,
  HallAmenity,
  HallCompass,
  HallLegend,
  HallMarker
} from '../models/hall.model';

/**
 * Import of a SelfCare hall plan (`t_event_hall_layout_data`) into a planner `Hall`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now nothing read the SelfCare layout. The planner drew its restricted areas from the
 * ITPO rule engine (`placement-rules.ts`) alone, which is why halls showed red PASSAGE and brown
 * NO_CONSTRUCTION bands that the official SelfCare plan does not carry, and why the SelfCare
 * amenity icons (toilets, stairs, entry) never appeared: `helper_text` had no consumer.
 *
 * This module makes the SelfCare row the source of truth for both. A hall imported here gets
 * exactly the passages SelfCare marks — none, if SelfCare marks none — and exactly its icons.
 *
 * COORDINATES
 * -----------
 * SelfCare uses a top-left origin in metres: `x` right over `0..length`, `y` down over
 * `0..breadth`, with `stallWidth`/`stallHeight` of 1 confirming the unit. Rectangles are given
 * as top-left corner plus size.
 *
 * The planner uses a centre-origin system in metres: X right, Z down, rectangles given as
 * CENTRE plus size. `toPlanner()` is the single place that converts.
 *
 * Label and icon positions (`exit_labels`, `helper_text`, `direction`) are NOT in metres — they
 * are canvas pixels at 20 px per metre. Hall 8-9-10 pins this down exactly: it is 133 x 43 m,
 * and its `HALL 8` / `HALL 9` / `HALL 10` captions all sit at `positionY` 860 = 43 x 20, the
 * bottom edge. See `PX_PER_METRE`.
 */

/**
 * Canvas pixels per metre in `exit_labels` / `helper_text` / `direction` positions.
 *
 * Derived from the Hall 8-9-10 row and cross-checked against every other hall in the export:
 * the hall captions land on `breadth * 20` and the compass on `length * 20` plus its margin.
 */
export const PX_PER_METRE = 20;

/** `layout_data.nonClickableAreas[]` — a top-left rectangle with the colour that gives it meaning. */
export interface SelfcareArea {
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
  strokeColor?: string;
  title?: string;
  /** Present on smoke-curtain rows; those are construction data, not part of the drawn plan. */
  visibleInView?: boolean;
}

/** `layout_data` — the JSON column of `t_event_hall_layout_data`. */
export interface SelfcareLayoutData {
  shape?: string;
  stallWidth?: number;
  stallHeight?: number;
  nonClickableAreas?: SelfcareArea[];
}

/** One entry of `helper_text[]`: a cluster of amenity icons at one pixel position. */
export interface SelfcareHelperText {
  image?: Array<{ url?: string; label?: string }>;
  positionX?: number;
  positionY?: number;
}

/** One entry of `exit_labels[]`: a gate / foyer / hall caption at a pixel position. */
export interface SelfcareExitLabel {
  text?: string;
  positionX?: number;
  positionY?: number;
}

/** `direction` — the north arrow, positioned in the same pixel space as the labels. */
export interface SelfcareDirection {
  image?: {
    url?: string;
    width?: number;
    height?: number;
    rotation?: number;
    /** Offset of the rose inside its own box. Not used: the rose is centred on `positionX/Y`. */
    positionX?: number;
    positionY?: number;
  };
  label?: { text?: string; positionX?: number; positionY?: number };
  positionX?: number;
  positionY?: number;
}

/** One row of `legends[]`: either a colour swatch or a markup note. */
export interface SelfcareLegend {
  label?: string;
  colorCode?: string;
  htmlContent?: string;
  visibleInBookMode?: boolean;
}

/**
 * A SelfCare hall layout.
 *
 * The live API (`data[]` of the hall-layout endpoint) and the `t_event_hall_layout_data` export
 * are the same record under two spellings: the API sends `hallId` and `name`, the export sends
 * `hall_id` and no name. Both are accepted so one importer serves both. The JSON columns may
 * arrive parsed or still as text; `parseJson()` takes either.
 */
export interface SelfcareLayoutRow {
  /** Live API spelling. */
  hallId?: number | string;
  /** Database-export spelling. */
  hall_id?: number | string;
  name?: string;
  event_id?: string;
  length?: number | string;
  breadth?: number | string;
  layout_data?: SelfcareLayoutData | string | null;
  helper_text?: SelfcareHelperText[] | string | null;
  exit_labels?: SelfcareExitLabel[] | string | null;
  legends?: SelfcareLegend[] | string | null;
  direction?: SelfcareDirection | string | null;
  /**
   * Pre-drawn stall blocks. Declared because the API sends the key, but null in every response
   * seen so far and not imported: the planner draws stalls from its own data, not from here.
   */
  default_stalls?: SelfcareDefaultStall[] | null;
}

/** `default_stalls[]` — a pre-drawn stall block. Carried for completeness; not consumed. */
export interface SelfcareDefaultStall {
  id?: number | string;
  area?: number;
  stallCoords?: Array<{ x: number; y: number }>;
  borderCoords?: Array<{ x1: number; y1: number; x2: number; y2: number; isDashed?: boolean }>;
}

/** One hall of the event endpoint's `data.halls[]`. */
export interface SelfcareEventHall {
  hallId?: number | string;
  hallName?: string;
  stallCount?: number;
  /** Non-null when this hall has a published layout for the event. */
  eventLayoutId?: number | null;
  hallCategoryId?: number | null;
}

/** The envelope every SelfCare endpoint replies with. */
export interface SelfcareEnvelope<T> {
  header?: { code?: number; error?: boolean; success?: boolean; msg?: string };
  data?: T;
}

/**
 * SelfCare fill colours and what they mean on the plan. The two restriction colours are the ones
 * the SelfCare legend names: "Compulsory passage for entry/exit/services" (red) and
 * "NC - No Construction Zone" (saddlebrown).
 */
const ZONE_BY_COLOR: Record<string, ZoneKind> = {
  red: 'PASSAGE',
  saddlebrown: 'NO_CONSTRUCTION',
  '#8a2be2': 'SMOKE_CURTAIN'
};

/** The purple hall outline of the SelfCare plan; these rectangles are the wall itself. */
const WALL_COLOR = '#742371';

/** SelfCare paints everything outside the irregular outline white to hide the base rectangle. */
const OUTSIDE_COLOR = '#ffffff';

/** `helper_text` icon URL -> amenity kind. The URL is the SelfCare contract, so match on it. */
const AMENITY_BY_URL: Record<string, AmenityKind> = {
  'toilet-male.svg': 'toilet-male',
  'toilet-female.svg': 'toilet-female',
  'stairs.svg': 'stairs',
  'entry-up.svg': 'entry-up'
};

/** Everything one SelfCare row contributes to a planner hall. */
export interface SelfcareImport {
  /** `hallId` / `hall_id`, or null when the row carries neither. */
  hallId: number | string | null;
  /** `name`, or null in the database export, which has no name column. */
  name: string | null;
  width: number;
  length: number;
  blockedAreas: BlockedArea[];
  zones: HallZone[];
  markers: HallMarker[];
  amenities: HallAmenity[];
  compass: HallCompass | null;
  legends: HallLegend[];
}

/**
 * Convert one SelfCare row into the geometry a planner `Hall` carries.
 *
 * Passages and no-construction zones come out EXACTLY as SelfCare marks them. A hall whose row
 * carries no red and no saddlebrown rectangle — which is the case for Hall 8-9-10 on every event
 * since November 2025 — yields an empty `zones` array, and the planner then draws no restriction
 * bands for it. That is the intended behaviour, not a gap.
 */
export function importSelfcareLayout(row: SelfcareLayoutRow): SelfcareImport {
  // SelfCare's `length` runs along X (the long side on screen) and `breadth` down the plan,
  // so they map to the planner's `width` and `length` respectively.
  const width = numberOf(row.length, 0);
  const length = numberOf(row.breadth, 0);

  const data = parseJson<SelfcareLayoutData>(row.layout_data) ?? {};
  const helpers = parseJson<SelfcareHelperText[]>(row.helper_text) ?? [];
  const labels = parseJson<SelfcareExitLabel[]>(row.exit_labels) ?? [];
  const legendRows = parseJson<SelfcareLegend[]>(row.legends) ?? [];
  const direction = parseJson<SelfcareDirection>(row.direction);

  const blockedAreas: BlockedArea[] = [];
  const zones: HallZone[] = [];

  for (const area of data.nonClickableAreas ?? []) {
    if (!isDrawable(area)) continue;

    const color = normalizeColor(area.fillColor ?? area.strokeColor);
    const zoneKind = ZONE_BY_COLOR[color];

    if (zoneKind) {
      // A restriction. SelfCare's own smoke-curtain rows are flagged `visibleInView: false`;
      // they are construction metadata and are skipped by `isDrawable`.
      zones.push({
        id: `sc-zone-${zones.length + 1}`,
        kind: zoneKind,
        label: area.title ?? zoneKind,
        polygon: rectPolygon(area, width, length),
        color
      });
      continue;
    }

    blockedAreas.push({
      ...toPlanner(area, width, length),
      kind: color === WALL_COLOR ? 'wall' : color === OUTSIDE_COLOR ? 'outside' : 'zone',
      color,
      ...(area.title ? { title: area.title } : {})
    });
  }

  const markers: HallMarker[] = [];
  for (const label of labels) {
    const text = String(label.text ?? '').trim();
    if (!text) continue;
    markers.push({ text, position: pixelToPlanner(label.positionX, label.positionY, width, length) });
  }

  const amenities: HallAmenity[] = [];
  for (const helper of helpers) {
    const images = helper.image ?? [];
    // One `helper_text` entry is a ROW of icons sharing a pixel position. Spreading them keeps
    // the cluster readable at plan scale instead of stacking every icon on one point.
    images.forEach((image, i) => {
      const kind = amenityKindOf(image.url);
      if (!kind) return;
      const base = pixelToPlanner(helper.positionX, helper.positionY, width, length);
      amenities.push({
        kind,
        label: image.label ?? kind,
        position: { x: base.x + (i - (images.length - 1) / 2) * AMENITY_SPACING, z: base.z }
      });
    });
  }

  const legends: HallLegend[] = legendRows
    .filter(l => String(l?.label ?? '').trim())
    .map(l => ({
      label: String(l.label).trim(),
      ...(l.colorCode ? { colorCode: normalizeColor(l.colorCode) } : {}),
      ...(l.htmlContent ? { htmlContent: l.htmlContent } : {}),
      ...(l.visibleInBookMode === undefined ? {} : { visibleInBookMode: l.visibleInBookMode })
    }));

  return {
    hallId: row.hallId ?? row.hall_id ?? null,
    name: row.name?.trim() || null,
    width,
    length,
    blockedAreas,
    zones,
    markers,
    amenities,
    compass: toCompass(direction, width, length),
    legends
  };
}

/**
 * The north arrow. Its pixel size converts at the same 20 px/m as its position, so Hall 8-9-10's
 * 100 px rose is 5 m across and lands at (63.5, 26) — below and right of the outline, which is
 * where the SelfCare plan draws it.
 */
function toCompass(
  direction: SelfcareDirection | null,
  hallWidth: number,
  hallLength: number
): HallCompass | null {
  if (!direction) return null;

  const position = pixelToPlanner(direction.positionX, direction.positionY, hallWidth, hallLength);
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;

  const size = numberOf(direction.image?.width, 0) / PX_PER_METRE;

  return {
    position,
    size: size > 0 ? size : DEFAULT_COMPASS_SIZE,
    rotation: numberOf(direction.image?.rotation, 0),
    label: String(direction.label?.text ?? 'N').trim() || 'N',
    labelOffset: {
      x: numberOf(direction.label?.positionX, 0) / PX_PER_METRE,
      z: numberOf(direction.label?.positionY, 0) / PX_PER_METRE
    }
  };
}

/** Used when `direction.image.width` is missing; 5 m is what every hall in the export resolves to. */
const DEFAULT_COMPASS_SIZE = 5;

/**
 * Unwrap a SelfCare response envelope. Every endpoint replies `{ header, data }`, and the
 * hall-layout endpoint puts a single hall in a one-element array, so both shapes are flattened
 * to a list here rather than at each call site.
 */
export function unwrapSelfcareData<T>(payload: SelfcareEnvelope<T | T[]> | T | T[]): T[] {
  const body =
    payload && typeof payload === 'object' && 'data' in (payload as SelfcareEnvelope<T>)
      ? (payload as SelfcareEnvelope<T | T[]>).data
      : payload;

  if (body == null) return [];
  return (Array.isArray(body) ? body : [body]) as T[];
}

/** Import the hall-layout endpoint's response — `{ header, data: [row] }` — into planner halls. */
export function importSelfcareResponse(
  payload: SelfcareEnvelope<SelfcareLayoutRow | SelfcareLayoutRow[]> | SelfcareLayoutRow
): Hall[] {
  return unwrapSelfcareData<SelfcareLayoutRow>(payload).map(row => hallFromSelfcare(row));
}

/** Build a standalone planner hall from one SelfCare row. */
export function hallFromSelfcare(row: SelfcareLayoutRow): Hall {
  const imported = importSelfcareLayout(row);

  return applySelfcareLayout(
    {
      id: imported.hallId ?? `selfcare-hall-${Date.now()}`,
      name: imported.name ?? 'SelfCare Hall',
      shape: 'SQUARE',
      width: imported.width,
      length: imported.length,
      radius: 0
    },
    row
  );
}

/**
 * The halls of the event endpoint (`data.halls[]`), as picker entries.
 *
 * These carry no geometry — only `eventLayoutId` tells you whether a hall has a published plan
 * to fetch. Sizes stay 0 until that plan is imported, so callers should treat a hall with
 * `hasLayout: false` as unfetchable rather than as an empty room.
 */
export interface SelfcareHallSummary {
  id: number | string;
  name: string;
  hasLayout: boolean;
  eventLayoutId: number | null;
  stallCount: number;
}

export function importSelfcareEventHalls(
  payload: SelfcareEnvelope<{ halls?: SelfcareEventHall[] }> | { halls?: SelfcareEventHall[] }
): SelfcareHallSummary[] {
  const events = unwrapSelfcareData<{ halls?: SelfcareEventHall[] }>(payload);

  return events.flatMap(event =>
    (event?.halls ?? [])
      .filter(h => h?.hallId != null)
      .map(h => ({
        id: h.hallId as number | string,
        name: String(h.hallName ?? '').trim() || `Hall ${h.hallId}`,
        hasLayout: h.eventLayoutId != null,
        eventLayoutId: h.eventLayoutId ?? null,
        stallCount: numberOf(h.stallCount, 0)
      }))
  );
}

/**
 * Metres between neighbouring icons of one `helper_text` cluster.
 *
 * SelfCare gives one position for a whole row of icons, so this is the only placement value not
 * taken from the data. It must stay above the renderer's `ICON_SIZE` or a cluster's chips
 * overlap and their captions collide. The cluster stays centred on the position SelfCare gives.
 */
const AMENITY_SPACING = 5;

/** Apply a SelfCare row to a hall, replacing its geometry. The hall's id and name are kept. */
export function applySelfcareLayout(hall: Hall, row: SelfcareLayoutRow): Hall {
  const imported = importSelfcareLayout(row);

  return {
    ...hall,
    ...(imported.name ? { name: imported.name } : {}),
    shape: 'SQUARE',
    width: imported.width,
    length: imported.length,
    radius: 0,
    blockedAreas: imported.blockedAreas,
    zones: imported.zones,
    markers: imported.markers,
    amenities: imported.amenities,
    compass: imported.compass,
    legends: imported.legends
  };
}

/** The public asset path of an amenity icon — the same URL SelfCare stores in `helper_text`. */
export function iconUrlFor(kind: AmenityKind): string {
  return `assets/images/${kind}.svg`;
}

// --- conversion helpers -------------------------------------------------------------------------

/**
 * SelfCare top-left rectangle -> planner centre-origin rectangle.
 *
 * `hallWidth` / `hallLength` are the full extents, so the hall centre sits at
 * (`hallWidth / 2`, `hallLength / 2`) in SelfCare coordinates.
 */
export function toPlanner(
  area: Pick<SelfcareArea, 'x' | 'y' | 'width' | 'height'>,
  hallWidth: number,
  hallLength: number
): { posX: number; posZ: number; width: number; length: number } {
  return {
    posX: area.x + area.width / 2 - hallWidth / 2,
    posZ: area.y + area.height / 2 - hallLength / 2,
    width: area.width,
    length: area.height
  };
}

/** A SelfCare pixel position -> planner metres. */
export function pixelToPlanner(
  px: number | undefined,
  py: number | undefined,
  hallWidth: number,
  hallLength: number
): Point {
  return {
    x: numberOf(px, 0) / PX_PER_METRE - hallWidth / 2,
    z: numberOf(py, 0) / PX_PER_METRE - hallLength / 2
  };
}

/** The four corners of a SelfCare rectangle, in planner coordinates, clockwise. */
function rectPolygon(area: SelfcareArea, hallWidth: number, hallLength: number): Point[] {
  const minX = area.x - hallWidth / 2;
  const minZ = area.y - hallLength / 2;
  const maxX = minX + area.width;
  const maxZ = minZ + area.height;

  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ }
  ];
}

function amenityKindOf(url: string | undefined): AmenityKind | undefined {
  const file = String(url ?? '').split('/').pop() ?? '';
  return AMENITY_BY_URL[file.toLowerCase()];
}

/**
 * A rectangle is drawn only if it has a real size and SelfCare has not flagged it
 * `visibleInView: false` — that flag marks rows kept for construction reference, such as the
 * smoke-curtain lines, which the published plan does not show.
 */
function isDrawable(area: SelfcareArea | null | undefined): area is SelfcareArea {
  return (
    !!area &&
    area.visibleInView !== false &&
    Number.isFinite(area.x) &&
    Number.isFinite(area.y) &&
    Number(area.width) > 0 &&
    Number(area.height) > 0
  );
}

/** Colour names arrive in mixed case (`saddlebrown`, `#742371`, `#FFFFFF`). */
function normalizeColor(color: string | undefined): string {
  return String(color ?? '').trim().toLowerCase();
}

/** The JSON columns come back parsed from some clients and as text from others. */
function parseJson<T>(value: T | string | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value;

  const text = value.trim();
  if (!text || text === 'NULL') return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function numberOf(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
