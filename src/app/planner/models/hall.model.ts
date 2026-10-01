import type {
  EventType,
  HallOpening,
  HallZone,
  LayoutRules,
  Point
} from '../geometry/placement-rules';
import type { SelfcareLayoutSource } from '../geometry/selfcare-layout';

/**
 * Hall shapes supported by the planner.
 * Mirrors the React values used in `frontend/src/App.js` (`shapeOf`).
 */
export type HallShape = 'SQUARE' | 'CIRCLE';

/**
 * What a blocked area represents in the hall:
 * - `'outside'` — carves the irregular outline; blocks stall placement.
 * - `'wall'`    — the thick boundary wall itself; blocks stall placement.
 * - `'zone'`    — any other coloured rectangle of the source plan (pillars...). Visual only: it
 *                 does NOT block placement (pavilions are built around pillars). The restrictions
 *                 that block — passages, no-construction areas, fire curtains — are `Hall.zones`.
 */
export type BlockedAreaKind = 'outside' | 'wall' | 'zone';

/**
 * An axis-aligned rectangle that is part of the hall's irregular geometry.
 * Coordinates are in hall units, centre-origin (same system as stall posX/posZ).
 */
export interface BlockedArea {
  posX: number;
  posZ: number;
  width: number;
  length: number;
  kind: BlockedAreaKind;
  color: string;
  /** Outline colour, when the source gives one that differs from the fill. */
  strokeColor?: string;
  /** Tooltip text of the source plan, e.g. `Pillar`. */
  title?: string;
  /**
   * SelfCare `visibleInView: false`: not drawn in the planner's view. (Curtains, the rows that
   * carry this flag, are imported as hidden `zones`, which still block.)
   */
  hidden?: boolean;
}

/**
 * A hall as held in frontend state.
 *
 * `id` is intentionally `string | number` because the React app mixes
 * backend numeric ids with local ids such as `hall-1712345678901` and
 * `excel-hall-1712345678901`. See `App.js:529` and `App.js:531-544`.
 */
export interface Hall {
  id: string | number;
  name: string;
  shape: HallShape;
  width: number;
  length: number;
  radius: number;
  blockedAreas?: BlockedArea[] | null;
  /**
   * Rule-driven geometry, all optional. A hall with `rules` is edited through the placement
   * rules (placement-rules.ts); without it the legacy rectangle/overlap checks apply unchanged.
   * `boundary` is the real outline polygon; when present it replaces the rectangle masks.
   */
  boundary?: Point[] | null;
  zones?: HallZone[] | null;
  openings?: HallOpening[] | null;
  markers?: HallMarker[] | null;
  /** Utility icons (toilets, stairs, entries) carried over from the SelfCare reference plan. */
  amenities?: HallAmenity[] | null;
  /** North arrow of the SelfCare plan, when its row carries one. */
  compass?: HallCompass | null;
  /** The SelfCare legend rows, so the UI can show the plan's own key rather than a hardcoded one. */
  legends?: HallLegend[] | null;
  rules?: Partial<LayoutRules> | null;
  /**
   * The SelfCare layout this hall's plan was imported from (ids and stall-cell grid). Editor
   * state only: not part of the save payload, so a hall loaded from the planner backend has none.
   */
  selfcareLayout?: SelfcareLayoutSource | null;
}

/**
 * The icon of an amenity: the base name of its SVG under `src/assets/images/` (`toilet-male`,
 * `drinking-water`, `emergency-exit`, `cargo-truck`, `circulation`, `entry-left` ...). SelfCare
 * stores the icon as `assets/images/<name>.svg`; every such name is accepted, so a new icon in the
 * source plan shows up without a code change. Only local asset names are ever loaded.
 */
export type AmenityKind = string;

/**
 * One utility icon on the plan (a `helper_text[].image[]` entry): a toilet, stairs/lifts,
 * drinking water, an emergency exit, a cargo entry...
 *
 * `position` is the icon centre in the planner's centre-origin metres. SelfCare groups icons in
 * rows: one `helper_text` entry is one row of icons on a white card, anchored by its top-left
 * corner. `anchor` is that corner (metres) and `slot` the icon's place in the row, so the
 * renderer can draw the card exactly as the plan does. Both are absent on older data, which is
 * then drawn one icon at a time around `position`.
 *
 * Visual only: amenities never take part in placement validation. They sit outside the hall
 * outline as often as inside it.
 */
export interface HallAmenity {
  kind: AmenityKind;
  /** The SelfCare caption, e.g. `Toilet (Male)`. Rendered under the icon. */
  label: string;
  position: Point;
  anchor?: Point | null;
  slot?: number | null;
}

/**
 * The plan's north arrow (`direction` in the SelfCare payload). Scene decoration only.
 */
export interface HallCompass {
  /** Centre of the rose. */
  position: Point;
  /** Side of the rose in metres, from the payload's pixel `width`/`height`. */
  size: number;
  /** In-plane rotation in degrees, clockwise on the plan, as SelfCare stores it. */
  rotation: number;
  /** Usually `N`. */
  label: string;
  /** Top-left of the label relative to the rose centre, in metres. */
  labelOffset: Point;
}

/**
 * One row of the SelfCare legend.
 *
 * A row carries EITHER a `colorCode` (the red passage / brown NC swatches) OR `htmlContent` (the
 * gate-numbering notes, which SelfCare ships as markup). `htmlContent` is untrusted API output:
 * it is never bound as HTML; `legend-content.ts` reduces it to plain text runs.
 */
export interface HallLegend {
  label: string;
  colorCode?: string | null;
  htmlContent?: string | null;
  /** false: SelfCare hides the row in its view mode — the planner is a view, so it hides it too. */
  visibleInViewMode?: boolean;
  /** false: SelfCare hides the row in its booking view. */
  visibleInBookMode?: boolean;
}

/** A text label on the plan, e.g. a gate or foyer name. Visual only. */
export interface HallMarker {
  text: string;
  position: Point;
}

/**
 * A stall size offered by the editor (GET /api/stall-types). `width` runs along X and `height`
 * is the plan depth - the stall's `length` along Z. Metres.
 */
export interface StallType {
  id: string;
  label: string;
  width: number;
  height: number;
  unit: 'meter';
}

export type { EventType };

/** Width/length pair used for rendering, produced by `hallSize()`. */
export interface HallSize {
  width: number;
  length: number;
}
