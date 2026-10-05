import { Hall, StallType } from '../models/hall.model';
import { hallFloor, planBounds } from './hall-plan';
import { effectiveRules, Footprint, Point, polygonBounds, Rect, rectToFootprint } from './placement-rules';
import { hallSize, num } from './planner-geometry';

/**
 * The hall's coordinate system: world metres <-> grid cells, and snapping.
 *
 * One instance is shared by the grid renderer, pointer handling, stall creation, validation and
 * persistence, so a stall that looks aligned IS aligned.
 *
 * World coordinates are the planner's centre-origin metres (posX / posZ). The grid starts at the
 * hall's minimum corner - for an irregular hall, the corner of its boundary's bounding box - so
 * grid lines run along the real walls. The old grid started at the hall centre, which put every
 * line 0.5 m off the walls of an odd-sized hall such as Hall 8-9-10 (133 x 43 m).
 *
 * `cellSize` (grid unit) and `snapStep` are separate: the grid is what is drawn, the snap step is
 * what stall edges and sizes align to. Both come from the hall's rules (metres), never pixels.
 */
export class GridSystem {
  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly width: number,
    readonly length: number,
    readonly cellSize = 1,
    readonly snapStep = 1
  ) {}

  static forHall(hall: Hall): GridSystem {
    const rules = effectiveRules(hall.rules);
    const cellSize = hall.rules ? rules.gridUnit : 1;
    const snapStep = hall.rules ? rules.snapStep : 1;

    // A hall traced from its plan: the grid covers the whole plan, from the plan's own corner, so
    // grid lines stay on the source's whole metres and reach a foyer beyond the breadth.
    const floor = hallFloor(hall);
    if (floor.length) {
      const b = planBounds(hall);
      // Lines in phase with the floor's own corner: a floor traced from the plan's grid starts on
      // a grid line, while walls drawn outside it can push the plan's corner off the lattice.
      const f = polygonBounds(floor.flatMap(r => r.outer));
      const minX = f.minX - Math.ceil((f.minX - b.minX) / cellSize - 1e-9) * cellSize;
      const minZ = f.minZ - Math.ceil((f.minZ - b.minZ) / cellSize - 1e-9) * cellSize;
      return new GridSystem(minX, minZ, b.maxX - minX, b.maxZ - minZ, cellSize, snapStep);
    }

    if (hall.boundary && hall.boundary.length >= 3) {
      const b = polygonBounds(hall.boundary);
      return new GridSystem(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ, cellSize, snapStep);
    }

    const { width, length } = hallSize(hall);
    return new GridSystem(-width / 2, -length / 2, width, length, cellSize, snapStep);
  }

  get bounds(): Rect {
    return {
      minX: this.originX,
      minZ: this.originZ,
      maxX: this.originX + this.width,
      maxZ: this.originZ + this.length
    };
  }

  /** World point -> fractional grid coordinates (column along X, row along Z). */
  toGrid(p: Point): { col: number; row: number } {
    return {
      col: (p.x - this.originX) / this.cellSize,
      row: (p.z - this.originZ) / this.cellSize
    };
  }

  toWorld(col: number, row: number): Point {
    return { x: this.originX + col * this.cellSize, z: this.originZ + row * this.cellSize };
  }

  /** Nearest snap line on one axis. */
  snapX(x: number): number {
    return this.originX + Math.round((x - this.originX) / this.snapStep) * this.snapStep;
  }

  snapZ(z: number): number {
    return this.originZ + Math.round((z - this.originZ) / this.snapStep) * this.snapStep;
  }

  /** Snap line at or below / at or above a value (used to cover a dragged area). */
  floorX(x: number): number {
    return this.originX + Math.floor((x - this.originX) / this.snapStep + 1e-9) * this.snapStep;
  }

  ceilX(x: number): number {
    return this.originX + Math.ceil((x - this.originX) / this.snapStep - 1e-9) * this.snapStep;
  }

  floorZ(z: number): number {
    return this.originZ + Math.floor((z - this.originZ) / this.snapStep + 1e-9) * this.snapStep;
  }

  ceilZ(z: number): number {
    return this.originZ + Math.ceil((z - this.originZ) / this.snapStep - 1e-9) * this.snapStep;
  }

  /**
   * Snap a stall so its EDGES land on the grid (not its centre). For a 3 m wide stall that means
   * a centre on a half metre, which is what makes it line up with the grid lines.
   */
  snapFootprint(f: Footprint): Footprint {
    const minX = this.snapX(f.posX - f.width / 2);
    const minZ = this.snapZ(f.posZ - f.length / 2);
    return { ...f, posX: round(minX + f.width / 2), posZ: round(minZ + f.length / 2) };
  }

  /** Round a size up to a whole number of snap steps (never zero). */
  snapSize(size: number): number {
    return Math.max(this.snapStep, Math.round(num(size, this.snapStep) / this.snapStep) * this.snapStep);
  }

  /**
   * The snapped footprint a drag would create.
   *
   * - `type` null (Custom): the rectangle covering every cell the drag touched, from `start` to
   *   `current`.
   * - `type` set: the type's own size, anchored at the start corner and extending towards the
   *   pointer. Dragging more along Z than X rotates it (3 x 2 becomes 2 x 3). While hovering
   *   (`dragging` false) it is centred on the pointer instead.
   */
  draftFootprint(start: Point, current: Point, type: StallType | null, dragging: boolean): Footprint {
    if (!type) {
      const minX = this.floorX(Math.min(start.x, current.x));
      const minZ = this.floorZ(Math.min(start.z, current.z));
      const maxX = Math.max(this.ceilX(Math.max(start.x, current.x)), minX + this.snapStep);
      const maxZ = Math.max(this.ceilZ(Math.max(start.z, current.z)), minZ + this.snapStep);
      return roundFootprint(rectToFootprint({ minX, minZ, maxX, maxZ }));
    }

    const dx = current.x - start.x;
    const dz = current.z - start.z;
    const vertical = dragging && Math.abs(dz) > Math.abs(dx);
    const width = vertical ? type.height : type.width;
    const length = vertical ? type.width : type.height;

    if (!dragging) {
      return this.snapFootprint({ posX: current.x, posZ: current.z, width, length });
    }

    const anchorX = dx >= 0 ? this.floorX(start.x) : this.ceilX(start.x);
    const anchorZ = dz >= 0 ? this.floorZ(start.z) : this.ceilZ(start.z);
    const minX = dx >= 0 ? anchorX : anchorX - width;
    const minZ = dz >= 0 ? anchorZ : anchorZ - length;
    return roundFootprint(rectToFootprint({ minX, minZ, maxX: minX + width, maxZ: minZ + length }));
  }
}

/** Removes float noise such as 0.30000000000000004 so saved values stay clean. */
function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function roundFootprint(f: Footprint): Footprint {
  return { posX: round(f.posX), posZ: round(f.posZ), width: round(f.width), length: round(f.length) };
}
