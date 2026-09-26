import { GridSystem } from './grid-system';
import {
  Footprint,
  forEachEdge,
  PlacementContext,
  Rect,
  rectInsidePolygon,
  rectOverlapsPolygon,
  rectToFootprint,
  segmentRectDistance,
  validatePlacement
} from './placement-rules';

/**
 * Free-space model: where in the hall a stall of a given size can actually go.
 *
 * Total empty area says nothing about whether a stall fits - 20 free cells scattered around the
 * hall cannot hold one 4 x 5 stall. So this works on CONTIGUOUS space:
 *
 *  1. The hall's bounding box is rasterised into cells of half a snap step (0.5 m by default).
 *     A cell is blocked when it is certainly unusable: outside the boundary, inside a
 *     restricted zone, inside an active stall, or wholly inside the peripheral clearance band.
 *  2. A summed-area table over the blocked cells answers "how many blocked cells lie inside
 *     this rectangle?" in O(1), so every candidate window is checked for being entirely free.
 *  3. Windows that pass are then checked with the full rule set (validatePlacement), which also
 *     covers what a raster cannot - the passage width between separate stalls.
 *
 * Step 1 is deliberately conservative (it only blocks cells that no stall could ever use), so
 * it can only speed things up; the answer always comes from step 3.
 */
export class FreeSpaceMap {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  /** (cols + 1) x (rows + 1) summed-area table of blocked cells. */
  private readonly sat: Int32Array;

  constructor(
    private readonly grid: GridSystem,
    private readonly ctx: PlacementContext
  ) {
    this.cell = grid.snapStep / 2;
    this.cols = Math.max(1, Math.round(grid.width / this.cell));
    this.rows = Math.max(1, Math.round(grid.length / this.cell));
    this.sat = this.buildTable();
  }

  /** Number of blocked cells inside a lattice-aligned rectangle. */
  blockedCellsIn(rect: Rect): number {
    const c0 = this.clampCol(Math.round((rect.minX - this.grid.originX) / this.cell));
    const c1 = this.clampCol(Math.round((rect.maxX - this.grid.originX) / this.cell));
    const r0 = this.clampRow(Math.round((rect.minZ - this.grid.originZ) / this.cell));
    const r1 = this.clampRow(Math.round((rect.maxZ - this.grid.originZ) / this.cell));
    const w = this.cols + 1;
    return this.sat[r1 * w + c1] - this.sat[r0 * w + c1] - this.sat[r1 * w + c0] + this.sat[r0 * w + c0];
  }

  /** True when the rectangle is inside the raster and contains no blocked cell. */
  isFree(rect: Rect): boolean {
    const b = this.grid.bounds;
    if (rect.minX < b.minX - 1e-9 || rect.minZ < b.minZ - 1e-9) return false;
    if (rect.maxX > b.maxX + 1e-9 || rect.maxZ > b.maxZ + 1e-9) return false;
    return this.blockedCellsIn(rect) === 0;
  }

  /**
   * Every valid placement of a width x length stall, in both orientations when they differ.
   * `ignoreId` excludes the stall being moved from the obstacles check.
   */
  validPlacements(width: number, length: number, ignoreId: string | null = null,
    openSides: Footprint['openSides'] = ['FRONT']): Footprint[] {
    const out: Footprint[] = [];
    for (const [w, l] of orientations(width, length)) {
      for (const candidate of this.lattice(w, l)) {
        const oriented = { ...candidate, openSides };
        if (validatePlacement(oriented, this.ctx, ignoreId).valid) out.push(oriented);
      }
    }
    return out;
  }

  /**
   * The valid placement of a width x length stall whose centre is nearest to `target`, or null
   * when no contiguous area in the hall can hold it.
   */
  nearestPlacement(
    width: number,
    length: number,
    target: { x: number; z: number },
    ignoreId: string | null = null,
    openSides: Footprint['openSides'] = ['FRONT'],
    allowRotate = true,
    rotation = 0
  ): Footprint | null {
    const candidates: Array<{ footprint: Footprint; distance: number }> = [];
    for (const [w, l] of (allowRotate ? orientations(width, length) : [[width, length]])) {
      for (const footprint of this.lattice(w, l, rotation !== 0)) {
        candidates.push({
          footprint: { ...footprint, openSides, ...(rotation ? { rotation } : {}) },
          distance: Math.hypot(footprint.posX - target.x, footprint.posZ - target.z)
        });
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    for (const { footprint } of candidates) {
      if (validatePlacement(footprint, this.ctx, ignoreId).valid) return footprint;
    }
    return null;
  }

  /** Candidate windows on the snap lattice that pass the raster pre-check. */
  private *lattice(width: number, length: number, rotated = false): Generator<Footprint> {
    const step = this.grid.snapStep;
    const b = this.grid.bounds;

    if (rotated) {
      // An unrotated rectangle is not a conservative pre-check for a rotated one.
      // Keep the same edge-based snap phase and let exact polygons test containment.
      const startX = b.minX + (width / 2) % step;
      const startZ = b.minZ + (length / 2) % step;
      for (let posZ = startZ; posZ <= b.maxZ; posZ += step) {
        for (let posX = startX; posX <= b.maxX; posX += step) {
          yield { posX, posZ, width, length };
        }
      }
      return;
    }

    for (let minZ = b.minZ; minZ + length <= b.maxZ + 1e-9; minZ += step) {
      for (let minX = b.minX; minX + width <= b.maxX + 1e-9; minX += step) {
        const rect = { minX, minZ, maxX: minX + width, maxZ: minZ + length };
        if (this.isFree(rect)) yield rectToFootprint(rect);
      }
    }
  }

  private buildTable(): Int32Array {
    const { cols, rows, cell } = this;
    const w = cols + 1;
    const sat = new Int32Array(w * (rows + 1));
    const peripheral = this.ctx.rules.peripheralClearance;
    const halfDiagonal = (cell * Math.SQRT2) / 2;
    // A rotated stall's bounding box contains usable floor: leave it to exact validation.
    const stalls = this.ctx.stalls.filter(s => s.status !== 'CANCELLED' && !(s.rotation ?? 0)).map(s => ({
      minX: s.posX - s.width / 2,
      maxX: s.posX + s.width / 2,
      minZ: s.posZ - s.length / 2,
      maxZ: s.posZ + s.length / 2
    }));

    for (let r = 0; r < rows; r++) {
      let rowSum = 0;
      for (let c = 0; c < cols; c++) {
        const minX = this.grid.originX + c * cell;
        const minZ = this.grid.originZ + r * cell;
        const rect = { minX, minZ, maxX: minX + cell, maxZ: minZ + cell };
        const blocked = this.isBlocked(rect, stalls, peripheral, halfDiagonal) ? 1 : 0;
        rowSum += blocked;
        sat[(r + 1) * w + (c + 1)] = sat[r * w + (c + 1)] + rowSum;
      }
    }
    return sat;
  }

  private isBlocked(rect: Rect, stalls: Rect[], peripheral: number, halfDiagonal: number): boolean {
    const outlines = [this.ctx.boundary, ...(this.ctx.regions ?? [])].filter(o => o && o.length >= 3);
    const boundary = outlines.find(o => rectOverlapsPolygon(rect, o!));
    if (outlines.length && !boundary) return true;
    if (boundary && boundary.length >= 3) {
      // Wholly inside the peripheral band: every point of the cell is closer than the clearance.
      const cx = (rect.minX + rect.maxX) / 2;
      const cz = (rect.minZ + rect.maxZ) / 2;
      const centre = { minX: cx, maxX: cx, minZ: cz, maxZ: cz };
      let nearest = Infinity;
      forEachEdge(boundary, (a, b) => {
        nearest = Math.min(nearest, segmentRectDistance(a, b, centre));
      });
      if (nearest + halfDiagonal < peripheral) return true;
    }

    for (const zone of this.ctx.zones) {
      if (zone.polygon?.length >= 3 && rectInsidePolygon(rect, zone.polygon)) return true;
    }

    return stalls.some(
      s => rect.minX >= s.minX - 1e-9 && rect.maxX <= s.maxX + 1e-9 && rect.minZ >= s.minZ - 1e-9 && rect.maxZ <= s.maxZ + 1e-9
    );
  }

  private clampCol(c: number): number {
    return Math.max(0, Math.min(this.cols, c));
  }

  private clampRow(r: number): number {
    return Math.max(0, Math.min(this.rows, r));
  }
}

function orientations(width: number, length: number): Array<[number, number]> {
  return width === length ? [[width, length]] : [[width, length], [length, width]];
}
