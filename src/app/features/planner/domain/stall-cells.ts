import type { Point } from './floor-plan.models';
import type { StallSide } from './plan.models';

/**
 * A stall is a rectangle with some of its 1 m grid cells cut away, the way SelfCare draws one:
 * its `cutCells` are [column, row] of the cells taken out, counted from the stall's top-left
 * corner. A stall off whole metres has part cells on its far edges; cutting one takes only the
 * part inside the stall.
 *
 * The server keeps the same rules (`stall-plans/stall-cells.ts`); keep them alike.
 */
export interface CellStall {
  x: number;
  y: number;
  width: number;
  depth: number;
  cutCells: ReadonlyArray<readonly [number, number]>;
}

const EPS = 1e-6;

/** Columns and rows of cells the stall touches. */
export function cellCounts(s: Pick<CellStall, 'width' | 'depth'>): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.ceil(s.width - EPS)),
    rows: Math.max(1, Math.ceil(s.depth - EPS)),
  };
}

/**
 * The cut cells as kept: whole numbers inside the stall, each once, sorted; never every cell,
 * as a stall needs at least one. Run after a stall is resized, so no cut is left outside it.
 */
export function cleanCutCells(
  s: Pick<CellStall, 'width' | 'depth'>,
  cells: ReadonlyArray<readonly number[]>,
): Array<[number, number]> {
  const { cols, rows } = cellCounts(s);
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const [c, r] of cells) {
    if (!Number.isInteger(c) || !Number.isInteger(r)) continue;
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const key = `${c},${r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([c, r]);
  }
  if (out.length >= cols * rows) return [];
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** The stall's floor area, m²: its rectangle less the cells cut away. */
export function stallArea(s: Pick<CellStall, 'width' | 'depth' | 'cutCells'>): number {
  let area = s.width * s.depth;
  for (const [c, r] of s.cutCells ?? []) {
    area -= Math.max(0, Math.min(1, s.width - c)) * Math.max(0, Math.min(1, s.depth - r));
  }
  return Math.max(0, area);
}

/** Whether a cell is cut away. */
export function isCut(s: Pick<CellStall, 'cutCells'>, c: number, r: number): boolean {
  return (s.cutCells ?? []).some(([cc, rr]) => cc === c && rr === r);
}

/** The stall's cell under a point on the floor, as [column, row]; null outside the stall. */
export function cellAt(s: CellStall, p: Point): [number, number] | null {
  const c = Math.floor(p[0] - s.x);
  const r = Math.floor(p[1] - s.y);
  const { cols, rows } = cellCounts(s);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
  if (p[0] > s.x + s.width || p[1] > s.y + s.depth) return null;
  return [c, r];
}

/** A kept cell's square on the floor, cut short at the stall's far edges. */
export interface StallCell {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cells the stall keeps, row by row. */
export function keptCells(s: CellStall): StallCell[] {
  const { cols, rows } = cellCounts(s);
  const out: StallCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isCut(s, col, row)) continue;
      out.push({
        col,
        row,
        x: s.x + col,
        y: s.y + row,
        width: Math.min(1, s.width - col),
        height: Math.min(1, s.depth - row),
      });
    }
  }
  return out;
}

/**
 * Every kept cell edge with no kept cell beyond it: which cell, which of its sides, and whether
 * it is on the stall's outer line (only there can a side be open) or round a cut.
 */
export function cellWalls(
  s: CellStall,
): Array<{ cell: StallCell; side: StallSide; outer: boolean }> {
  const { cols, rows } = cellCounts(s);
  const cells = keptCells(s);
  const has = new Set(cells.map((k) => `${k.col},${k.row}`));
  const out: Array<{ cell: StallCell; side: StallSide; outer: boolean }> = [];
  for (const cell of cells) {
    const { col, row } = cell;
    if (!has.has(`${col},${row - 1}`)) out.push({ cell, side: 'top', outer: row === 0 });
    if (!has.has(`${col + 1},${row}`)) out.push({ cell, side: 'right', outer: col === cols - 1 });
    if (!has.has(`${col},${row + 1}`)) out.push({ cell, side: 'bottom', outer: row === rows - 1 });
    if (!has.has(`${col - 1},${row}`)) out.push({ cell, side: 'left', outer: col === 0 });
  }
  return out;
}

/**
 * The stall's walls as lines: an edge on the stall's outer line names its side, so an open
 * side can be drawn open; an edge round a cut has none.
 */
export function stallWalls(s: CellStall): Array<[StallSide | null, Point, Point]> {
  return cellWalls(s).map(({ cell: k, side, outer }) => {
    const x2 = k.x + k.width;
    const y2 = k.y + k.height;
    const [a, b]: [Point, Point] =
      side === 'top'
        ? [
            [k.x, k.y],
            [x2, k.y],
          ]
        : side === 'right'
          ? [
              [x2, k.y],
              [x2, y2],
            ]
          : side === 'bottom'
            ? [
                [x2, y2],
                [k.x, y2],
              ]
            : [
                [k.x, y2],
                [k.x, k.y],
              ];
    return [outer ? side : null, a, b];
  });
}
