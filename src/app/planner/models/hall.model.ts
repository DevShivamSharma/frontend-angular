import type {
  EventType,
  HallOpening,
  HallZone,
  LayoutRules,
  Point
} from '../geometry/placement-rules';

/**
 * Hall shapes supported by the planner.
 * Mirrors the React values used in `frontend/src/App.js` (`shapeOf`).
 */
export type HallShape = 'SQUARE' | 'CIRCLE';

/**
 * What a blocked area represents in the hall:
 * - `'outside'` — carves the irregular outline; blocks stall placement.
 * - `'wall'`    — the thick boundary wall itself; blocks stall placement.
 * - `'zone'`    — visual overlay (fire curtains etc.); does NOT block placement.
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
  title?: string;
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
  rules?: Partial<LayoutRules> | null;
}

/**
 * The amenity kinds the SelfCare plan marks with an icon. The string is also the base name of
 * the SVG under `src/assets/images/`, so `iconUrlFor()` needs no lookup table.
 */
export type AmenityKind = 'toilet-male' | 'toilet-female' | 'stairs' | 'entry-up';

export const AMENITY_KINDS: readonly AmenityKind[] = [
  'toilet-male',
  'toilet-female',
  'stairs',
  'entry-up'
];

/**
 * One utility icon on the plan: a toilet, a staircase/lift, an entry arrow.
 *
 * `position` is in the planner's centre-origin metres, like every other hall coordinate — the
 * SelfCare pixel position is converted once, on import (`selfcare-layout.ts`).
 *
 * Visual only: amenities never take part in placement validation. They sit outside the hall
 * outline as often as inside it (SelfCare puts the Hall 10 toilet block above FOYER C), which is
 * exactly why they must not be modelled as zones.
 */
export interface HallAmenity {
  kind: AmenityKind;
  /** The SelfCare caption, e.g. `Toilet (Male)`. Rendered under the icon. */
  label: string;
  position: Point;
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
