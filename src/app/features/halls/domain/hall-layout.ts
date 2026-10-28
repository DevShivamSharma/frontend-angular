import { HallNotes, readNotes } from './hall-notes';

/**
 * A hall's layout as ITPO keeps it (`T_HALL_LAYOUTS`): a grid of 1 m cells, `columns` across and
 * `rows` down, with rectangles marking what cannot be used. ITPO's own are the walls and cut
 * corners (white); the pillars placed from this portal are the same kind of rectangle in grey, so
 * the booking portal already draws them as not clickable.
 */
export interface LayoutArea {
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
}

export interface HallLayout {
  hallId: number;
  columns: number;
  rows: number;
  /** The layout as ITPO sent it, so what this portal does not touch is saved back as it was. */
  data: Record<string, unknown>;
  areas: LayoutArea[];
  /** Its helpers, text labels and legend (ITPO's `helper_text`, `exit_labels` and `legends`). */
  notes: HallNotes;
}

export const PILLAR_FILL = '#6b7280';
export const PILLAR_STROKE = '#374151';

/** The biggest grid a hall may have, in cells (metres) along a side; the same as the hall's own limit. */
export const MAX_GRID = 2000;
export const PILLAR_SIZES = [1, 2, 3] as const;

export const isPillar = (area: LayoutArea): boolean => area.fillColor === PILLAR_FILL;

/** ITPO marks what is outside the floor (walls, cut corners) in white; the coloured thin ones are only wall lines. */
export const isOutside = (area: LayoutArea): boolean =>
  /^#?(f{3}|f{6})$/i.test(area.fillColor.trim());

const covers = (area: LayoutArea, x: number, y: number): boolean =>
  x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;

/** A cell outside the floor (a pillar can only stand on the floor). */
export function isWall(areas: readonly LayoutArea[], x: number, y: number): boolean {
  return areas.some((area) => isOutside(area) && covers(area, x + 0.5, y + 0.5));
}

/**
 * Clicking a cell: a pillar there is taken away; on bare floor a pillar of `size` metres is put
 * (kept inside the grid); on a wall nothing happens.
 */
export function togglePillar(
  areas: readonly LayoutArea[],
  cell: { x: number; y: number },
  size: number,
  grid: { columns: number; rows: number },
): LayoutArea[] {
  const existing = areas.find((area) => isPillar(area) && covers(area, cell.x + 0.5, cell.y + 0.5));
  if (existing) {
    return areas.filter((area) => area !== existing);
  }
  const x = Math.max(0, Math.min(cell.x, grid.columns - size));
  const y = Math.max(0, Math.min(cell.y, grid.rows - size));
  if (isWall(areas, cell.x, cell.y) || size > grid.columns || size > grid.rows) {
    return [...areas];
  }
  return [
    ...areas,
    { x, y, width: size, height: size, fillColor: PILLAR_FILL, strokeColor: PILLAR_STROKE },
  ];
}

/** A smaller grid cuts off the pillars that stood outside it; ITPO's own areas are left as they are. */
export function fitToGrid(
  areas: readonly LayoutArea[],
  grid: { columns: number; rows: number },
): LayoutArea[] {
  return areas.filter(
    (area) =>
      !isPillar(area) ||
      (area.x >= 0 &&
        area.y >= 0 &&
        area.x + area.width <= grid.columns &&
        area.y + area.height <= grid.rows),
  );
}

/** The coloured thin rectangles ITPO draws along the walls: neither the floor's outside nor a pillar. */
export const isLine = (area: LayoutArea): boolean => !isPillar(area) && !isOutside(area);

/** A wall line runs along x when it is wider than tall. */
export const isHorizontal = (area: LayoutArea): boolean => area.width >= area.height;

/** The length of a wall line: its longer side, in metres. */
export const lineLength = (area: LayoutArea): number => Math.max(area.width, area.height);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
/** Positions are kept to half a metre, as ITPO's own wall lines are. */
const half = (value: number): number => Math.round(value * 2) / 2;

/**
 * A wall line put at a new position and length (its thickness stays), kept inside the grid. Only a
 * wall line can be changed; anything else, or a place that is not on the list, leaves the areas as they were.
 */
export function setLine(
  areas: readonly LayoutArea[],
  index: number,
  change: { x?: number; y?: number; length?: number },
  grid: { columns: number; rows: number },
): LayoutArea[] {
  const line = areas[index];
  if (!line || !isLine(line)) return [...areas];

  const horizontal = isHorizontal(line);
  const thickness = horizontal ? line.height : line.width;
  const length = clamp(
    half(change.length ?? lineLength(line)),
    0.5,
    horizontal ? grid.columns : grid.rows,
  );
  const width = horizontal ? length : thickness;
  const height = horizontal ? thickness : length;
  const next: LayoutArea = {
    ...line,
    width,
    height,
    x: clamp(half(change.x ?? line.x), 0, Math.max(grid.columns - width, 0)),
    y: clamp(half(change.y ?? line.y), 0, Math.max(grid.rows - height, 0)),
  };
  return areas.map((area, i) => (i === index ? next : area));
}

/** A wall line moved by whole metres. */
export function moveLine(
  areas: readonly LayoutArea[],
  index: number,
  delta: { x: number; y: number },
  grid: { columns: number; rows: number },
): LayoutArea[] {
  const line = areas[index];
  return line
    ? setLine(areas, index, { x: line.x + delta.x, y: line.y + delta.y }, grid)
    : [...areas];
}

/** One area taken away, by its place in the list; only a wall line or a pillar, never ITPO's outside. */
export function removeLine(areas: readonly LayoutArea[], index: number): LayoutArea[] {
  const area = areas[index];
  return area && isLine(area) ? areas.filter((_, i) => i !== index) : [...areas];
}

/** The wall line nearest the point, within `reach` metres of it; null when none is. */
export function lineAt(
  areas: readonly LayoutArea[],
  point: { x: number; y: number },
  reach: number,
): number | null {
  let best: { index: number; distance: number } | null = null;
  areas.forEach((area, index) => {
    if (!isLine(area)) return;
    const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
    const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
    const distance = Math.hypot(dx, dy);
    if (distance <= reach && (!best || distance < best.distance)) best = { index, distance };
  });
  return (best as { index: number } | null)?.index ?? null;
}

/** Walls and lines are this thin or thinner; anything thicker is a block. */
const THIN = 1.5;
/** An area is on an edge of the grid when it ends this close to it (ITPO's own walls start up to 2 m in from it). */
const EDGE = 2;

/** Which side of the hall gets the extra metres (or loses them): the rest of the hall keeps its place. */
export interface GrowFrom {
  horizontal: 'left' | 'right';
  vertical: 'top' | 'bottom';
}

export const GROW_END: GrowFrom = { horizontal: 'right', vertical: 'bottom' };

/**
 * One direction of a resize. `start` and `size` are the area's place and length on that axis,
 * `total` the old size of the grid, `delta` the change, `across` when the area is a thin line that
 * runs across this axis (an up-and-down wall, when it is the horizontal axis).
 *
 * Growing at the far end: what is on that end follows it (a line across the axis moves, anything
 * else is made longer to reach it). Growing at the near end: everything moves along by `delta`,
 * and what was on that end stays on it the same way.
 */
function followAxis(
  start: number,
  size: number,
  total: number,
  delta: number,
  across: boolean,
  fromStart: boolean,
): { start: number; size: number } {
  if (delta === 0) return { start, size };
  if (!fromStart) {
    if (start + size < total - EDGE) return { start, size };
    return across
      ? { start: Math.max(half(start + delta), 0), size }
      : { start, size: Math.max(half(size + delta), 0.5) };
  }
  if (start > EDGE) return { start: start + delta, size };
  return across ? { start, size } : { start, size: Math.max(half(size + delta), 0.5) };
}

/**
 * The grid made bigger or smaller, with the walls following the side that changes, so the hall
 * grows (or shrinks) as a whole instead of leaving its walls behind:
 *   - a wall line on that side that runs across it moves with the edge; one that runs along it, and
 *     any block of outside floor there, is made longer or shorter to reach it;
 *   - the pillars (and what is not on that side) keep their place in the hall; those the new
 *     grid no longer holds are cut off.
 * `side` says whether the width changes at the left or the right, and the height at the top or bottom.
 */
export function resizeLayout(
  areas: readonly LayoutArea[],
  from: { columns: number; rows: number },
  to: { columns: number; rows: number },
  side: GrowFrom = GROW_END,
): LayoutArea[] {
  const dc = to.columns - from.columns;
  const dr = to.rows - from.rows;
  const left = side.horizontal === 'left';
  const top = side.vertical === 'top';

  const followed = areas.map((area): LayoutArea => {
    if (isPillar(area)) {
      return { ...area, x: left ? area.x + dc : area.x, y: top ? area.y + dr : area.y };
    }
    const thin = Math.min(area.width, area.height) <= THIN;
    const horizontal = followAxis(
      area.x,
      area.width,
      from.columns,
      dc,
      thin && area.height > area.width,
      left,
    );
    const vertical = followAxis(
      area.y,
      area.height,
      from.rows,
      dr,
      thin && area.width > area.height,
      top,
    );
    return {
      ...area,
      x: horizontal.start,
      width: horizontal.size,
      y: vertical.start,
      height: vertical.size,
    };
  });

  return fitToGrid(followed, to);
}

/** What is saved: ITPO's own fields as they were, with the areas as they are now. */
export function toLayoutData(
  layout: HallLayout,
  areas: readonly LayoutArea[],
): Record<string, unknown> {
  return { ...layout.data, nonClickableAreas: areas.map((area) => ({ ...area })) };
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function toArea(raw: unknown): LayoutArea | null {
  if (!raw || typeof raw !== 'object') return null;
  const area = raw as Record<string, unknown>;
  const [x, y, width, height] = [
    num(area['x']),
    num(area['y']),
    num(area['width']),
    num(area['height']),
  ];
  if (x === null || y === null || width === null || height === null) return null;
  return {
    x,
    y,
    width,
    height,
    fillColor: typeof area['fillColor'] === 'string' ? area['fillColor'] : '#ffffff',
    strokeColor: typeof area['strokeColor'] === 'string' ? area['strokeColor'] : '#ffffff',
  };
}

/** ITPO's answer (a list of rows, or one) as a layout; null when the hall has none or it cannot be read. */
export function parseLayout(raw: unknown, hallId: number): HallLayout | null {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== 'object') return null;
  const columns = num(row['length']);
  const rows = num(row['breadth']);
  const data = row['layout_data'];
  if (!columns || !rows || !data || typeof data !== 'object') return null;
  const list = (data as Record<string, unknown>)['nonClickableAreas'];
  return {
    hallId,
    columns: Math.round(columns),
    rows: Math.round(rows),
    data: data as Record<string, unknown>,
    areas: (Array.isArray(list) ? list : []).map(toArea).filter((a): a is LayoutArea => a !== null),
    notes: readNotes(row),
  };
}
