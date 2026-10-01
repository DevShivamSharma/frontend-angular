import type { Point } from './placement-rules';
import { PX_PER_METRE, SelfcareLayoutSource } from './selfcare-layout';
import { normalizeFootprint, sidesOfEdges } from './stall-footprint';
import type { GateSide, Stall, StallStatus } from '../models/stall.model';

/**
 * Import of SelfCare stalls (`idp."T_STALLS"` rows) into planner stalls, and the grid tracing the
 * SelfCare export (drafting/portal-export.ts) shares with it.
 *
 * See docs/selfcare-stall-booking-3d-handoff.md. What this module relies on, by evidence level:
 *
 *   DB verified   `layout_grid` = { area, stallCoords, borderCoords }; the layout's `length`,
 *                 `breadth` and `layout_data.stallWidth/stallHeight`; the stall's hall / event /
 *                 event-hall ids; the 12-cell Hall 12A sample.
 *   Reported      20 canvas px per metre on the booking page, top-left origin with Y down,
 *                 `stallCoords` = top-left pixel of each selected cell, `isDashed` = open segment,
 *                 cell size = hall size / floor(hall size / stallWidth) for non-circular halls.
 *                 `PX_PER_METRE` independently fixes the same 20 px/m for the plan's labels.
 *
 * Where a reported rule is not settled, the import refuses the case rather than guessing:
 * circular layouts, and halls whose size is not a whole number of configured cells (there the
 * configured and "effective" cell sizes differ and which one SelfCare draws with is unverified).
 *
 * Nothing is silently changed. A stall the planner cannot represent faithfully (holes, several
 * pieces, off-grid cells, no whole open side...) is not imported and is reported instead; what
 * can be imported keeps its raw SelfCare row in `Stall.selfcare` so an unchanged stall exports
 * byte-for-byte as it came in.
 */

/** One `layout_grid.stallCoords` entry: top-left canvas pixel of a selected cell. */
export interface SelfcareCell {
  x: number;
  y: number;
}

/** One `layout_grid.borderCoords` entry: a drawn outline segment in canvas pixels. */
export interface SelfcareBorder {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  isDashed: boolean;
}

/** `T_STALLS.layout_grid` as observed in the database (not a complete API DTO). */
export interface SelfcareLayoutGrid {
  area?: string | null;
  stallCoords?: SelfcareCell[] | null;
  borderCoords?: SelfcareBorder[] | null;
}

/**
 * A `T_STALLS` row, database spelling. Only the fields the import reads are named; every other
 * column (flags, price, category array, `stall_coordinates`...) is carried untouched in
 * `SelfcareStallSource.row`, nulls and literal `"null"` strings included.
 */
export interface SelfcareStallRow {
  id?: string | null;
  stall_name?: string | null;
  stall_number?: string | null;
  island_number?: string | null;
  hall_id?: number | string | null;
  event_id?: string | null;
  event_hall_id?: string | null;
  layout_grid?: SelfcareLayoutGrid | string | null;
  booking_status?: string | null;
  no_of_open_sides?: number | string | null;
  is_active?: boolean | null;
  [column: string]: unknown;
}

/** The stall-cell grid of one SelfCare layout, in metres and canvas pixels. */
export interface SelfcareCellGrid {
  pxPerMetre: number;
  /** Hall size in metres: `length` along X, `breadth` down the plan. */
  hallLength: number;
  hallBreadth: number;
  cellWidth: number;
  cellHeight: number;
  cellWidthPx: number;
  cellHeightPx: number;
  cols: number;
  rows: number;
}

/** Planner geometry as it was right after import; an export compares against it. */
export interface SelfcareImportedGeometry {
  posX: number;
  posZ: number;
  width: number;
  length: number;
  rotation: number;
  footprint: Point[] | null;
  openSides: GateSide[];
  openEdges: number[] | null;
}

/**
 * Where an imported stall came from. The SelfCare ids never become planner ids or planner stall
 * numbers: the planner backend owns numbering, and the two systems' ids must not be interchanged.
 */
export interface SelfcareStallSource {
  stallId: string | null;
  hallId: number | string | null;
  eventId: string | null;
  eventHallId: string | null;
  layoutId: number | string | null;
  stallNumber: string | null;
  islandNumber: string | null;
  /** `layout_grid.area` exactly as saved (user-editable, unit in the text). Never recomputed. */
  areaText: string | null;
  /** Unique cells x cell size, in m². Separate from `areaText` on purpose. */
  geometricArea: number;
  /** SelfCare stores no height; the planner default was used. */
  heightSource: 'planner-default';
  grid: SelfcareCellGrid;
  imported: SelfcareImportedGeometry;
  /** The whole source row, cloned. */
  row: SelfcareStallRow;
}

export type SelfcareIssueSeverity = 'error' | 'warning' | 'info';

/**
 * One finding of an import. `error` = the stall was NOT imported; `warning` = imported, but part
 * of the source could not be represented and needs review; `info` = recorded source discrepancy.
 */
export interface SelfcareStallIssue {
  severity: SelfcareIssueSeverity;
  code: string;
  stallId: string | null;
  stallNumber: string | null;
  message: string;
}

export interface SelfcareStallImport {
  stalls: Stall[];
  issues: SelfcareStallIssue[];
}

/** Planner default height (the same 4 m `normalizeStall` falls back to). Not a SelfCare value. */
const PLANNER_DEFAULT_HEIGHT = 4;
const PLANNER_DEFAULT_COLOR = '#3498db';
const EPS = 1e-6;

/**
 * The cell grid of a layout, or the reason it cannot be used. Uses the layout's own size and
 * `stallWidth/stallHeight`; nothing is defaulted to Hall 12A's 1 x 1 m.
 */
export function selfcareCellGrid(
  layout: SelfcareLayoutSource | null | undefined,
  pxPerMetre = PX_PER_METRE
): SelfcareCellGrid | string {
  if (!layout) return 'No SelfCare layout is attached to this hall. Import its hall layout first.';
  const { length, breadth, stallWidth, stallHeight } = layout;
  if (!(length > 0) || !(breadth > 0)) return 'The SelfCare layout has no valid length / breadth.';
  if (stallWidth == null || stallHeight == null) {
    return 'The SelfCare layout has no stallWidth / stallHeight, so its cell size is unknown.';
  }
  if (String(layout.shape ?? '').trim().toLowerCase() === 'circular') {
    return 'Circular SelfCare layouts are not supported: how their cells are sized has not been verified.';
  }
  const cols = Math.floor(length / stallWidth + EPS);
  const rows = Math.floor(breadth / stallHeight + EPS);
  if (cols < 1 || rows < 1) return 'The SelfCare layout has fewer than one cell per row or column.';
  if (Math.abs(cols * stallWidth - length) > EPS || Math.abs(rows * stallHeight - breadth) > EPS) {
    return (
      `The hall (${length} x ${breadth} m) is not a whole number of ${stallWidth} x ${stallHeight} m cells. ` +
      'SelfCare then stretches its cells, and which size it draws stalls with has not been verified.'
    );
  }
  return {
    pxPerMetre,
    hallLength: length,
    hallBreadth: breadth,
    cellWidth: stallWidth,
    cellHeight: stallHeight,
    cellWidthPx: stallWidth * pxPerMetre,
    cellHeightPx: stallHeight * pxPerMetre,
    cols,
    rows
  };
}

/**
 * Import SelfCare stall rows onto a hall imported from `layout`. Each row either becomes one
 * planner stall (`stallNumber: null`, numbered by the planner backend on save) or produces an
 * `error` issue saying why not. The placement audit then judges the imported stalls against the
 * hall's own rules; nothing here moves a stall to make it pass.
 */
export function importSelfcareStalls(
  rows: readonly SelfcareStallRow[],
  layout: SelfcareLayoutSource | null | undefined,
  hallId: string | number,
  pxPerMetre = PX_PER_METRE
): SelfcareStallImport {
  const grid = selfcareCellGrid(layout, pxPerMetre);
  if (typeof grid === 'string') {
    return { stalls: [], issues: [{ severity: 'error', code: 'LAYOUT_UNSUPPORTED', stallId: null, stallNumber: null, message: grid }] };
  }

  const stalls: Stall[] = [];
  const issues: SelfcareStallIssue[] = [];
  const seen = new Set<string>();
  const stamp = Date.now();

  rows.forEach((row, index) => {
    const stallId = text(row?.id);
    if (stallId && seen.has(stallId)) {
      issues.push(issue('error', 'DUPLICATE_STALL', row, 'This SelfCare stall id appears more than once in the file.'));
      return;
    }
    if (stallId) seen.add(stallId);
    const result = importOne(row, layout!, grid, hallId, `selfcare-import-${stamp}-${index + 1}`);
    issues.push(...result.issues);
    if (result.stall) stalls.push(result.stall);
  });

  return { stalls, issues };
}

/** True when an imported stall still has exactly the geometry and openings it was imported with. */
export function selfcareGeometryUnchanged(stall: Stall): boolean {
  const imported = stall.selfcare?.imported;
  if (!imported) return false;
  const same = (a: number, b: number) => Math.abs(a - b) <= EPS;
  const footprint = stall.footprint?.length ? stall.footprint : null;
  return (
    same(stall.posX, imported.posX) &&
    same(stall.posZ, imported.posZ) &&
    same(stall.width, imported.width) &&
    same(stall.length, imported.length) &&
    same(normalizedTurn(stall.rotation ?? 0), normalizedTurn(imported.rotation)) &&
    samePoints(footprint, imported.footprint) &&
    sameSet(stall.openSides ?? [], imported.openSides) &&
    sameSet(footprint ? stall.openEdges ?? [] : [], imported.openEdges ?? [])
  );
}

/** `layout_grid` parsed, or null. The column arrives as JSON text from some clients. */
export function parseLayoutGrid(value: SelfcareStallRow['layout_grid']): SelfcareLayoutGrid | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as SelfcareLayoutGrid) : null;
  } catch {
    return null;
  }
}

// --- grid outline tracing (shared with the export) ------------------------------------------------

/** A cell by grid column / row, counted from the hall's top-left corner. */
export interface GridCell {
  col: number;
  row: number;
}

/** A grid vertex: `col` / `row` are line numbers. */
export interface GridVertex {
  col: number;
  row: number;
}

/** One cell side on a shape's outline, directed clockwise on the plan (inside on its right). */
export interface OutlineEdge {
  from: GridVertex;
  to: GridVertex;
}

/** A straight run of outline edges: one side of the traced polygon. */
export interface OutlineRun {
  from: GridVertex;
  to: GridVertex;
  edges: number[];
}

/**
 * The outline loops of a set of unique cells, each clockwise on the plan (X right, Z down) and
 * starting at its top-left-most corner. Loops with a negative `signedArea` are holes. At a corner
 * where two cells touch only diagonally the loops are kept apart (right turn first), so such a
 * pinch shows up as a second loop rather than a self-touching outline.
 */
export function outlineLoops(cells: readonly GridCell[]): OutlineEdge[][] {
  const key = (c: number, r: number) => `${c},${r}`;
  const filled = new Set(cells.map(c => key(c.col, c.row)));
  const edges: OutlineEdge[] = [];
  for (const { col: c, row: r } of cells) {
    if (!filled.has(key(c, r - 1))) edges.push({ from: { col: c, row: r }, to: { col: c + 1, row: r } });
    if (!filled.has(key(c + 1, r))) edges.push({ from: { col: c + 1, row: r }, to: { col: c + 1, row: r + 1 } });
    if (!filled.has(key(c, r + 1))) edges.push({ from: { col: c + 1, row: r + 1 }, to: { col: c, row: r + 1 } });
    if (!filled.has(key(c - 1, r))) edges.push({ from: { col: c, row: r + 1 }, to: { col: c, row: r } });
  }

  const outgoing = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = key(e.from.col, e.from.row);
    outgoing.set(k, [...(outgoing.get(k) ?? []), i]);
  });

  // Start each loop at its top-left-most vertex, so loops (and exports) have a stable order.
  const order = edges
    .map((e, i) => i)
    .sort((a, b) => edges[a].from.row - edges[b].from.row || edges[a].from.col - edges[b].from.col);
  const used = new Set<number>();
  const loops: OutlineEdge[][] = [];
  for (const start of order) {
    if (used.has(start)) continue;
    const loop: OutlineEdge[] = [];
    for (let i: number | undefined = start; i !== undefined && !used.has(i); ) {
      used.add(i);
      const e: OutlineEdge = edges[i];
      loop.push(e);
      const d = { col: e.to.col - e.from.col, row: e.to.row - e.from.row };
      const turns = [{ col: -d.row, row: d.col }, d, { col: d.row, row: -d.col }];
      const next: number[] = (outgoing.get(key(e.to.col, e.to.row)) ?? []).filter(n => !used.has(n));
      i = turns
        .map(t => next.find(n => edges[n].to.col - edges[n].from.col === t.col && edges[n].to.row - edges[n].from.row === t.row))
        .find(n => n !== undefined);
    }
    loops.push(loop);
  }
  return loops;
}

/** Twice the shoelace sum of a loop in grid units: positive = clockwise on the plan (outer). */
export function loopArea(loop: readonly OutlineEdge[]): number {
  return loop.reduce((s, e) => s + e.from.col * e.to.row - e.to.col * e.from.row, 0) / 2;
}

/** Collinear consecutive edges merged into polygon sides. `loop` must start at a corner. */
export function outlineRuns(loop: readonly OutlineEdge[]): OutlineRun[] {
  const runs: OutlineRun[] = [];
  loop.forEach((e, i) => {
    const last = runs[runs.length - 1];
    const dir = (x: OutlineEdge) => `${x.to.col - x.from.col},${x.to.row - x.from.row}`;
    if (last && dir(loop[last.edges[last.edges.length - 1]]) === dir(e)) {
      last.to = e.to;
      last.edges.push(i);
    } else {
      runs.push({ from: e.from, to: e.to, edges: [i] });
    }
  });
  return runs;
}

// --- one stall ------------------------------------------------------------------------------------

function importOne(
  row: SelfcareStallRow,
  layout: SelfcareLayoutSource,
  grid: SelfcareCellGrid,
  hallId: string | number,
  plannerId: string
): { stall: Stall | null; issues: SelfcareStallIssue[] } {
  const issues: SelfcareStallIssue[] = [];
  const fail = (code: string, message: string) => {
    issues.push(issue('error', code, row, message));
    return { stall: null, issues };
  };
  if (!row || typeof row !== 'object') return fail('INVALID_ROW', 'The stall entry is not an object.');

  // Relationships: stall -> the layout that defines its cells.
  if (layout.hallId != null && row.hall_id != null && String(layout.hallId) !== String(row.hall_id)) {
    return fail('HALL_MISMATCH', `Stall hall ${row.hall_id} is not the layout's hall ${layout.hallId}.`);
  }
  if (text(row.event_id)) {
    if (!layout.eventId) {
      return fail(
        'LAYOUT_NOT_EVENT_LAYOUT',
        'The stall belongs to an event but the imported layout is a default hall layout. Which layout ' +
          'SelfCare falls back to is unverified; import the event layout of this hall and event.'
      );
    }
    if (layout.eventId !== text(row.event_id)) {
      return fail('EVENT_MISMATCH', `Stall event ${row.event_id} is not the layout's event ${layout.eventId}.`);
    }
  }
  if (text(row.event_hall_id) && layout.eventHallId && layout.eventHallId !== text(row.event_hall_id)) {
    return fail('EVENT_HALL_MISMATCH', `Stall event-hall ${row.event_hall_id} is not the layout's ${layout.eventHallId}.`);
  }

  const layoutGrid = parseLayoutGrid(row.layout_grid);
  if (!layoutGrid || !Array.isArray(layoutGrid.stallCoords) || !layoutGrid.stallCoords.length) {
    return fail('NO_CELLS', 'layout_grid has no stallCoords, so the stall has no geometry.');
  }

  // Cells: whole grid positions inside the hall canvas.
  const cells: GridCell[] = [];
  const cellKeys = new Set<string>();
  let duplicates = 0;
  for (const c of layoutGrid.stallCoords) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return fail('INVALID_CELL', 'A stallCoords entry has no numeric x / y.');
    const col = c.x / grid.cellWidthPx;
    const r = c.y / grid.cellHeightPx;
    if (Math.abs(col - Math.round(col)) > EPS || Math.abs(r - Math.round(r)) > EPS) {
      return fail('OFF_GRID', `Cell (${c.x}, ${c.y}) px is not on the ${grid.cellWidthPx} x ${grid.cellHeightPx} px cell grid.`);
    }
    const cell = { col: Math.round(col), row: Math.round(r) };
    if (cell.col < 0 || cell.row < 0 || cell.col >= grid.cols || cell.row >= grid.rows) {
      return fail('OUTSIDE_HALL', `Cell (${c.x}, ${c.y}) px lies outside the ${grid.hallLength} x ${grid.hallBreadth} m hall.`);
    }
    const k = `${cell.col},${cell.row}`;
    if (cellKeys.has(k)) duplicates++;
    else {
      cellKeys.add(k);
      cells.push(cell);
    }
  }
  if (duplicates) issues.push(issue('warning', 'DUPLICATE_CELLS', row, `${duplicates} repeated cell(s) counted once.`));

  const loops = outlineLoops(cells);
  if (!connected(cells)) return fail('DISCONNECTED', 'The stall cells form separate pieces; a planner stall is one piece.');
  if (loops.length !== 1) {
    return fail(
      loops.some(l => loopArea(l) < 0) ? 'HOLES' : 'SELF_TOUCHING',
      loops.some(l => loopArea(l) < 0)
        ? 'The stall cells enclose a hole, which a planner stall outline cannot hold.'
        : 'The stall outline touches itself at a corner, which a planner stall outline cannot hold.'
    );
  }
  const loop = loops[0];

  // Borders: which outline edges are drawn dashed (open).
  const borders = matchBorders(loop, Array.isArray(layoutGrid.borderCoords) ? layoutGrid.borderCoords : [], grid);
  if (borders.offsets.length) {
    issues.push(issue('info', 'BORDER_OFFSET', row,
      `${borders.offsetCount} border segment(s) are drawn ${borders.offsets.join(' / ')} px from the cell edge they were ` +
      'matched to. The cells define the geometry; the raw segments are kept unchanged.'));
  }
  if (borders.missing) issues.push(issue('warning', 'MISSING_BORDER', row, `${borders.missing} outline cell edge(s) have no border segment; treated as closed.`));
  if (borders.unmatched) issues.push(issue('warning', 'UNMATCHED_BORDER', row, `${borders.unmatched} border segment(s) match no outline edge (kept in the raw data, ignored).`));
  if (borders.conflicts) issues.push(issue('warning', 'CONFLICTING_BORDER', row, `${borders.conflicts} outline edge(s) have both open and closed segments; treated as closed.`));

  const runs = outlineRuns(loop);
  const openRuns: number[] = [];
  const partial: string[] = [];
  const rectangle = isRectangle(cells);
  runs.forEach((run, i) => {
    const states = run.edges.map(e => borders.dashed[e] === true);
    if (states.every(Boolean)) openRuns.push(i);
    else if (states.some(Boolean)) partial.push(rectangle ? RECT_SIDE[direction(run)] : `edge ${i + 1}`);
  });
  if (partial.length) {
    issues.push(issue('warning', 'PARTIAL_OPENING', row,
      `Partly open ${partial.join(', ')}: the planner opens whole sides only, so ${partial.length === 1 ? 'it is' : 'they are'} ` +
      'imported as closed. The original segments are kept for export.'));
  }
  if (!openRuns.length) {
    return fail('NO_WHOLE_OPEN_SIDE',
      partial.length
        ? 'No side of the stall is fully open, and a planner stall needs at least one open side.'
        : 'The stall has no open (dashed) border, and a planner stall needs at least one open side.');
  }

  // Geometry in the planner frame: centre origin, metres.
  const toX = (col: number) => col * grid.cellWidth - grid.hallLength / 2;
  const toZ = (r: number) => r * grid.cellHeight - grid.hallBreadth / 2;
  let geometry: SelfcareImportedGeometry;
  if (rectangle) {
    const cols = cells.map(c => c.col);
    const rowsOf = cells.map(c => c.row);
    const minC = Math.min(...cols), maxC = Math.max(...cols) + 1;
    const minR = Math.min(...rowsOf), maxR = Math.max(...rowsOf) + 1;
    geometry = {
      posX: (toX(minC) + toX(maxC)) / 2,
      posZ: (toZ(minR) + toZ(maxR)) / 2,
      width: (maxC - minC) * grid.cellWidth,
      length: (maxR - minR) * grid.cellHeight,
      rotation: 0,
      footprint: null,
      openSides: openRuns.map(i => RECT_SIDE[direction(runs[i])]),
      openEdges: null
    };
  } else {
    const n = normalizeFootprint(runs.map(run => ({ x: toX(run.from.col), z: toZ(run.from.row) })));
    if (typeof n === 'string') return fail('INVALID_OUTLINE', n);
    const openEdges = [...new Set(openRuns.map(i => n.edgeMap.get(i)).filter((e): e is number => e !== undefined))].sort((a, b) => a - b);
    geometry = {
      posX: n.offset.x,
      posZ: n.offset.z,
      width: n.width,
      length: n.length,
      rotation: 0,
      footprint: n.points,
      openSides: sidesOfEdges(n.points, openEdges).filter(isGateSide),
      openEdges
    };
  }

  // Recorded discrepancies: reported, never "fixed".
  const geometricArea = cells.length * grid.cellWidth * grid.cellHeight;
  const areaText = typeof layoutGrid.area === 'string' ? layoutGrid.area : null;
  const sqm = /^\s*(\d+(?:\.\d+)?)\s*sqm\s*$/i.exec(areaText ?? '');
  if (areaText == null) {
    issues.push(issue('info', 'NO_AREA_TEXT', row, `No saved area text; geometric area is ${round(geometricArea)} m².`));
  } else if (!sqm) {
    issues.push(issue('info', 'AREA_TEXT_KEPT', row, `Saved area "${areaText}" is kept as text; geometric area is ${round(geometricArea)} m².`));
  } else if (Math.abs(Number(sqm[1]) - geometricArea) > EPS) {
    issues.push(issue('info', 'AREA_DIFFERS', row, `Saved area "${areaText}" differs from the geometric ${round(geometricArea)} m²; both are kept.`));
  }
  const storedOpen = row.no_of_open_sides == null ? null : Number(row.no_of_open_sides);
  const counted = reportedOpenSideCount(layoutGrid.borderCoords ?? []);
  if (storedOpen != null && Number.isFinite(storedOpen) && storedOpen !== counted) {
    issues.push(issue('info', 'OPEN_SIDE_COUNT', row, `Stored no_of_open_sides ${storedOpen} differs from ${counted} dashed line group(s).`));
  }
  const bookingStatus = row.booking_status;
  const status: StallStatus = bookingStatus === 'Booked' ? 'BOOKED' : 'AVAILABLE';
  if (bookingStatus !== 'Booked' && bookingStatus !== 'Available') {
    issues.push(issue('info', 'STATUS_UNMAPPED', row,
      `booking_status ${JSON.stringify(bookingStatus ?? null)} has no planner status; shown as AVAILABLE, source value kept.`));
  }
  if (row.is_active === false) issues.push(issue('warning', 'INACTIVE', row, 'The SelfCare stall is inactive (is_active = false).'));

  const openSides = geometry.openSides;
  const stall: Stall = {
    id: plannerId,
    hallId,
    name: text(row.stall_number) ?? text(row.stall_name) ?? 'Shop',
    width: geometry.width,
    length: geometry.length,
    height: PLANNER_DEFAULT_HEIGHT,
    posX: geometry.posX,
    posZ: geometry.posZ,
    color: PLANNER_DEFAULT_COLOR,
    gateSide: openSides[0],
    openSides,
    stallNumber: null,
    status,
    stallTypeId: null,
    rotation: 0,
    ...(geometry.footprint ? { footprint: geometry.footprint, openEdges: geometry.openEdges } : {}),
    selfcare: {
      stallId: text(row.id),
      hallId: row.hall_id ?? null,
      eventId: text(row.event_id),
      eventHallId: text(row.event_hall_id),
      layoutId: layout.layoutId,
      stallNumber: text(row.stall_number),
      islandNumber: text(row.island_number),
      areaText,
      geometricArea,
      heightSource: 'planner-default',
      grid,
      imported: geometry,
      row: structuredClone(row)
    }
  };
  return { stall, issues };
}

/** Rectangle side of an outline run, by its clockwise direction (top runs +X ... left runs -Z). */
const RECT_SIDE: Record<string, GateSide> = { '1,0': 'BACK', '0,1': 'RIGHT', '-1,0': 'FRONT', '0,-1': 'LEFT' };

function direction(run: OutlineRun): string {
  return `${Math.sign(run.to.col - run.from.col)},${Math.sign(run.to.row - run.from.row)}`;
}

/**
 * Pair every outline cell edge with the border segment drawn for it. A segment belongs to an
 * outline edge it runs along and covers, closer than half a cell: the only outline edge that
 * near. This tolerates the inset segments seen in the data (820 px drawn at 818) without shifting
 * any segment by a fixed amount, and the offsets found are reported.
 */
function matchBorders(loop: readonly OutlineEdge[], borders: readonly SelfcareBorder[], grid: SelfcareCellGrid) {
  const dashed: Array<boolean | null> = loop.map(() => null);
  const best = loop.map(() => Infinity);
  const conflict = new Set<number>();
  const offsets = new Set<number>();
  let offsetCount = 0;
  let unmatched = 0;

  for (const b of borders) {
    const valid = b && [b.x1, b.x2, b.y1, b.y2].every(Number.isFinite) && typeof b.isDashed === 'boolean';
    const horizontal = valid && Math.abs(b.y1 - b.y2) <= EPS && Math.abs(b.x1 - b.x2) > EPS;
    const vertical = valid && Math.abs(b.x1 - b.x2) <= EPS && Math.abs(b.y1 - b.y2) > EPS;
    if (!horizontal && !vertical) {
      unmatched++;
      continue;
    }
    let matched = false;
    let offset = 0;
    loop.forEach((e, i) => {
      if ((e.from.row === e.to.row) !== horizontal) return;
      const line = horizontal ? e.from.row * grid.cellHeightPx : e.from.col * grid.cellWidthPx;
      const lo = horizontal ? Math.min(e.from.col, e.to.col) * grid.cellWidthPx : Math.min(e.from.row, e.to.row) * grid.cellHeightPx;
      const hi = lo + (horizontal ? grid.cellWidthPx : grid.cellHeightPx);
      const dist = Math.abs((horizontal ? b.y1 : b.x1) - line);
      const segLo = horizontal ? Math.min(b.x1, b.x2) : Math.min(b.y1, b.y2);
      const segHi = horizontal ? Math.max(b.x1, b.x2) : Math.max(b.y1, b.y2);
      if (dist >= (horizontal ? grid.cellHeightPx : grid.cellWidthPx) / 2 - EPS) return;
      if (segLo > lo + EPS || segHi < hi - EPS) return;
      matched = true;
      offset = Math.max(offset, dist);
      if (dist < best[i] - EPS) {
        best[i] = dist;
        dashed[i] = b.isDashed;
        conflict.delete(i);
      } else if (Math.abs(dist - best[i]) <= EPS && dashed[i] !== b.isDashed) {
        conflict.add(i);
      }
    });
    if (!matched) unmatched++;
    else if (offset > EPS) {
      offsets.add(round(offset));
      offsetCount++;
    }
  }
  conflict.forEach(i => (dashed[i] = false));

  return {
    dashed,
    missing: dashed.filter(d => d === null).length,
    unmatched,
    conflicts: conflict.size,
    offsets: [...offsets].sort((a, b) => a - b),
    offsetCount
  };
}

/**
 * The reported SelfCare count of open sides: dashed vertical segments grouped by X plus dashed
 * horizontal ones grouped by Y. Used only to flag a disagreement with the stored count; it is not
 * a FRONT/BACK/LEFT/RIGHT classification.
 */
function reportedOpenSideCount(borders: readonly SelfcareBorder[]): number {
  const groups = new Set<string>();
  for (const b of borders) {
    if (b?.isDashed !== true) continue;
    if (b.x1 === b.x2) groups.add(`v${b.x1}`);
    else if (b.y1 === b.y2) groups.add(`h${b.y1}`);
  }
  return groups.size;
}

function connected(cells: readonly GridCell[]): boolean {
  if (!cells.length) return false;
  const keys = new Set(cells.map(c => `${c.col},${c.row}`));
  const seen = new Set<string>([`${cells[0].col},${cells[0].row}`]);
  const queue = [cells[0]];
  while (queue.length) {
    const c = queue.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c.col + dc},${c.row + dr}`;
      if (keys.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push({ col: c.col + dc, row: c.row + dr });
      }
    }
  }
  return seen.size === keys.size;
}

/** Unique cells that fill their bounding box exactly. */
function isRectangle(cells: readonly GridCell[]): boolean {
  const cols = cells.map(c => c.col);
  const rows = cells.map(c => c.row);
  const w = Math.max(...cols) - Math.min(...cols) + 1;
  const h = Math.max(...rows) - Math.min(...rows) + 1;
  return w * h === cells.length;
}

function issue(severity: SelfcareIssueSeverity, code: string, row: SelfcareStallRow | null | undefined, message: string): SelfcareStallIssue {
  return { severity, code, stallId: text(row?.id), stallNumber: text(row?.stall_number), message };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function isGateSide(v: string): v is GateSide {
  return v === 'FRONT' || v === 'BACK' || v === 'LEFT' || v === 'RIGHT';
}

function normalizedTurn(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function samePoints(a: Point[] | null, b: Point[] | null): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) <= EPS && Math.abs(p.z - b[i].z) <= EPS);
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every(v => y.has(v));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
