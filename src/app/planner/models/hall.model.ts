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
  rules?: Partial<LayoutRules> | null;
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
