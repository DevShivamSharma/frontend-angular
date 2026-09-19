/** Side of the stall that is left open for customer entry. */
export type GateSide = 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT';

/**
 * A stall/shop as held in frontend state.
 *
 * `id` is `string | number` for the same reason as `Hall.id`: newly added
 * stalls get local ids like `local-1712345678901-0.42` (`App.js:525`).
 */
export interface Stall {
  id: string | number;
  hallId: string | number;
  name: string;
  width: number;
  length: number;
  height: number;
  posX: number;
  posZ: number;
  color: string;
  gateSide: GateSide;
}

/** Raw stall-shaped input from the backend or from an Excel row. */
export interface StallInput {
  id?: unknown;
  name?: unknown;
  stallName?: unknown;
  width?: unknown;
  length?: unknown;
  height?: unknown;
  posX?: unknown;
  posZ?: unknown;
  color?: unknown;
  gateSide?: unknown;
}
