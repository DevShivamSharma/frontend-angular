import type { Point, StallStatus } from '../geometry/placement-rules';

/** Side of the stall that is left open for customer entry. */
export type GateSide = 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT';

export type { StallStatus };

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
  /** First open side — kept in sync with `openSides[0]` for legacy consumers. */
  gateSide: GateSide;
  /** Every side left open for customer entry (1-4, any combination). Source of truth. */
  openSides: GateSide[];
  /**
   * Persisted identity ("STALL-001"), assigned by the backend on save. null = not saved yet.
   * Never renumbered: cancelling STALL-002 leaves STALL-003 as it is.
   */
  stallNumber: string | null;
  status: StallStatus;
  /** Stall type it was drawn from ("stall-3x2"), or null for a custom size. */
  stallTypeId: string | null;
  rotation?: number;
  isSplitParent?: boolean;
  parentStallNumber?: string | null;
  /**
   * Custom (polygon, e.g. L-shaped) stall: its outline in local metres before rotation,
   * clockwise and centred on its bounding box (geometry/stall-footprint.ts). `width`/`length`
   * are that bounding box. Absent/null = the ordinary width x length rectangle.
   */
  footprint?: Point[] | null;
  /** Open (customer-facing) edges of a custom stall: edge i runs footprint[i] -> footprint[i + 1]. */
  openEdges?: number[] | null;
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
  openSides?: unknown;
  stallNumber?: unknown;
  status?: unknown;
  stallTypeId?: unknown;
  rotation?: unknown;
  isSplitParent?: unknown;
  parentStallNumber?: unknown;
  footprint?: unknown;
  openEdges?: unknown;
}
