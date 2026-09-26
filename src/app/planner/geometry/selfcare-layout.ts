import { traceFloor } from './placement-rules';
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
import { cardLayout } from './plan-annotations';

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
 * are canvas pixels at 20 px per metre, measured from the same top-left origin as the areas, and
 * they give the TOP-LEFT corner of the thing drawn there (SelfCare places them as absolutely
 * positioned boxes). Hall 8-9-10 pins the scale down exactly: it is 133 x 43 m, and its
 * `HALL 8` / `HALL 9` / `HALL 10` captions all sit at `positionY` 860 = 43 x 20, the bottom edge.
 * Hall 1GF confirms it independently: at 20 px/m every `EE1-n` gate label lands against the wall
 * rectangle it names, `FOYER-1G` on the foyer and `GG1-1` / `GG1-2` on their red passage markers.
 * See `PX_PER_METRE`.
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
  /**
   * `false` on the fire-curtain rows: SelfCare does not draw them in its view mode, but they stay
   * non-clickable. The planner hides them and still blocks them.
   */
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
  visibleInViewMode?: boolean;
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

/**
 * Zone kind from the legend label SelfCare shows for a colour. Checked before the colour table,
 * because the legend is the plan's own statement of what a colour means. Curtains are matched
 * before "no construction": the curtain legend reads "Fire curtains (No construction zone
 * below)", which the old order typed as a plain no-construction zone.
 */
function zoneKindOfLabel(label: string): ZoneKind | null {
  const l = label.toLowerCase();
  if (l.includes('curtain')) return 'SMOKE_CURTAIN';
  if (l.includes('passage')) return 'PASSAGE';
  if (l.includes('no construction') || /\bnc\b/.test(l)) return 'NO_CONSTRUCTION';
  if (l.includes('partition')) return 'PARTITION';
  return null;
}

/** The purple hall outline of the SelfCare plan; these rectangles are the wall itself. */
const WALL_COLOR = '#742371';

/** SelfCare paints everything outside the irregular outline white to hide the base rectangle. */
const OUTSIDE_COLOR = '#ffffff';

/**
 * An icon name SelfCare may reference: the base name of a local SVG. Anything else (a remote
 * URL, a path with directories, odd characters) is refused rather than loaded.
 */
const ICON_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

/** Everything one SelfCare row contributes to a planner hall. */
export interface SelfcareImport {
  /** `hallId` / `hall_id`, or null when the row carries neither. */
  hallId: number | string | null;
  /** `name`, or null in the database export, which has no name column. */
  name: string | null;
  /**
   * SelfCare `shape` is "circular" or "non-circular". A circular plan is still drawn on its
   * `length x breadth` canvas and its outline is still carved by the rectangles, so it stays a
   * SQUARE (canvas) hall here; only a circular plan WITHOUT any outline rectangle becomes a planner
   * CIRCLE, inscribed in the canvas. Turning a carved circular plan into a CIRCLE of radius
   * length / 2 would drop everything below that circle — Hall 14GF's lower floor and foyer.
   */
  shape: 'SQUARE' | 'CIRCLE';
  radius: number;
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

  const legendByColor = new Map<string, string>();
  for (const legend of legendRows) {
    if (legend?.colorCode && legend.label) legendByColor.set(normalizeColor(legend.colorCode), legend.label.trim());
  }

  // EVERY rectangle is kept. None is clipped to `length x breadth` (walls and masks legitimately
  // reach past it), and `visibleInView: false` rows are kept too: they are hidden, not free.
  for (const area of data.nonClickableAreas ?? []) {
    if (!isArea(area)) continue;

    const color = normalizeColor(area.fillColor ?? area.strokeColor);
    const stroke = normalizeColor(area.strokeColor);
    const hidden = area.visibleInView === false;
    const legend = legendByColor.get(color);
    const zoneKind = (legend ? zoneKindOfLabel(legend) : null) ?? ZONE_BY_COLOR[color];

    if (zoneKind) {
      zones.push({
        id: `sc-zone-${zones.length + 1}`,
        kind: zoneKind,
        label: area.title?.trim() || legend || zoneKind,
        polygon: rectPolygon(area, width, length),
        color,
        ...(hidden ? { hidden: true } : {})
      });
      continue;
    }

    blockedAreas.push({
      ...toPlanner(area, width, length),
      kind: color === WALL_COLOR ? 'wall' : color === OUTSIDE_COLOR ? 'outside' : 'zone',
      color,
      ...(stroke && stroke !== color ? { strokeColor: stroke } : {}),
      ...(area.title?.trim() ? { title: area.title.trim() } : {}),
      ...(hidden ? { hidden: true } : {})
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
    if (!Number.isFinite(helper?.positionX) || !Number.isFinite(helper?.positionY)) continue;
    // One `helper_text` entry is a ROW of icons on one card whose top-left corner is the given
    // position; `cardLayout` places each icon in the row exactly as the plan does.
    const icons = (helper.image ?? [])
      .map(image => ({ kind: amenityKindOf(image?.url), label: String(image?.label ?? '').trim() }))
      .filter((icon): icon is { kind: AmenityKind; label: string } => !!icon.kind);
    if (!icons.length) continue;

    const anchor = pixelToPlanner(helper.positionX, helper.positionY, width, length);
    const layout = cardLayout(icons.map(icon => icon.label || icon.kind));
    icons.forEach((icon, slot) => {
      amenities.push({
        kind: icon.kind,
        label: icon.label || icon.kind,
        position: { x: anchor.x + layout.slots[slot].iconX, z: anchor.z + layout.slots[slot].iconZ },
        anchor,
        slot
      });
    });
  }

  const legends: HallLegend[] = legendRows
    .filter(l => String(l?.label ?? '').trim())
    .map(l => ({
      label: String(l.label).trim(),
      ...(l.colorCode ? { colorCode: normalizeColor(l.colorCode) } : {}),
      ...(l.htmlContent ? { htmlContent: l.htmlContent } : {}),
      ...(typeof l.visibleInViewMode === 'boolean' ? { visibleInViewMode: l.visibleInViewMode } : {}),
      ...(typeof l.visibleInBookMode === 'boolean' ? { visibleInBookMode: l.visibleInBookMode } : {})
    }));

  const carved = blockedAreas.some(a => a.kind === 'outside' || a.kind === 'wall');
  const circular = String(data.shape ?? '').trim().toLowerCase() === 'circular' && !carved;

  return {
    hallId: row.hallId ?? row.hall_id ?? null,
    name: row.name?.trim() || null,
    shape: circular ? 'CIRCLE' : 'SQUARE',
    radius: circular ? Math.min(width, length) / 2 : 0,
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
 * The north arrow. `direction.positionX/Y` is the top-left of its box; the rose is drawn at
 * `image.positionX/Y` inside that box and the letter at `label.positionX/Y`, all in the same
 * 20 px/m. Hall 8-9-10's 100 px rose is therefore 5 m across, centred at (2660, 1010) px =
 * (133, 50.5) m on the plan, below and right of the outline, with its "N" up and to the left —
 * where the SelfCare plan draws them.
 */
function toCompass(
  direction: SelfcareDirection | null,
  hallWidth: number,
  hallLength: number
): HallCompass | null {
  if (!direction) return null;

  if (!Number.isFinite(direction.positionX) || !Number.isFinite(direction.positionY)) return null;
  const box = pixelToPlanner(direction.positionX, direction.positionY, hallWidth, hallLength);

  const measured = numberOf(direction.image?.width, 0) / PX_PER_METRE;
  const size = measured > 0 ? measured : DEFAULT_COMPASS_SIZE;
  const position = {
    x: box.x + numberOf(direction.image?.positionX, 0) / PX_PER_METRE + size / 2,
    z: box.z + numberOf(direction.image?.positionY, 0) / PX_PER_METRE + size / 2
  };

  return {
    position,
    size,
    rotation: numberOf(direction.image?.rotation, 0),
    label: String(direction.label?.text ?? 'N').trim() || 'N',
    labelOffset: {
      x: box.x + numberOf(direction.label?.positionX, 0) / PX_PER_METRE - position.x,
      z: box.z + numberOf(direction.label?.positionY, 0) / PX_PER_METRE - position.z
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
      shape: imported.shape,
      width: imported.width,
      length: imported.length,
      radius: imported.radius
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
 * Apply a SelfCare row to a hall, replacing its geometry. The hall's id and name are kept.
 *
 * A rule-driven hall keeps its rules, but its stored `boundary` polygon is re-traced from the new
 * rectangles (the main floor region) so it can never disagree with them. Further floor regions,
 * such as a separate foyer, are derived from the rectangles wherever they are needed.
 */
export function applySelfcareLayout(hall: Hall, row: SelfcareLayoutRow): Hall {
  const imported = importSelfcareLayout(row);
  const boundary = hall.boundary
    ? traceFloor(imported.blockedAreas, imported.width, imported.length)[0]?.outer ?? null
    : hall.boundary;

  return {
    ...hall,
    boundary,
    ...(imported.name ? { name: imported.name } : {}),
    shape: imported.shape,
    width: imported.width,
    length: imported.length,
    radius: imported.radius,
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

/**
 * `assets/images/drinking-water.svg` -> `drinking-water`. Only a local asset path is accepted:
 * the name must be a plain file name, so no API value can make the planner load a remote URL.
 */
export function amenityKindOf(url: string | undefined): AmenityKind | undefined {
  const text = String(url ?? '').trim();
  const match = /^(?:\.?\/)?(?:assets\/images\/)?([^/\\?#]+)\.svg$/i.exec(text);
  const name = match?.[1];
  return name && ICON_NAME.test(name) ? name.toLowerCase() : undefined;
}

/** A rectangle with a real size. Hidden ones (`visibleInView: false`) count: they still block. */
function isArea(area: SelfcareArea | null | undefined): area is SelfcareArea {
  return (
    !!area &&
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
