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
}

/** Width/length pair used for rendering, produced by `hallSize()`. */
export interface HallSize {
  width: number;
  length: number;
}
