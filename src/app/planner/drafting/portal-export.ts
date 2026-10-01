import { pointInPolygon } from '../geometry/placement-rules';
import type { Point, Rect } from '../geometry/placement-rules';
import { openEdgeList, stallPolygon } from '../geometry/polygon-geometry';
import { PX_PER_METRE } from '../geometry/selfcare-layout';
import { GridCell, outlineLoops, parseLayoutGrid, selfcareGeometryUnchanged } from '../geometry/selfcare-stalls';
import { polygonArea } from '../geometry/stall-footprint';
import type { Stall } from '../models/stall.model';

/**
 * Export for the Fabric.js booking portal (ITPO SelfCare `hall-layout`), so the published drawing
 * replaces the hand redraw there.
 *
 * The portal's model: the hall is `length` x `breadth` metres of `stallWidth` x `stallHeight`
 * cells, drawn at `metersToPixels` px per metre from the hall's top-left corner, Y down. A stall
 * is the list of its cells (`stallCoords`, top-left pixel of each cell) plus its outline as one
 * segment per cell edge (`borderCoords`), dashed where the side is open to the aisle.
 *
 * `frame` is the SelfCare canvas in planner coordinates: the hall's `width` x `length` rectangle
 * around the centre, NOT the planner's grid/plan bounds, which grow past it with walls and foyers.
 *
 * A stall imported from SelfCare and not changed since is written back exactly as it came
 * (cells, borders, area text, id). Anything else is regenerated from its outline when that
 * outline is a union of whole cells (any quarter turn, custom shapes included); what is not is
 * listed in `skipped` with the reason, never approximated.
 */

export interface PortalBorder {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  isDashed: boolean;
}

export interface PortalStall {
  /** SelfCare stall id for an imported stall; otherwise the planner number (or row id). */
  id: string;
  /** Saved area text: the imported text when there is one, else the cell count as `"<n>sqm"`. */
  area: string | null;
  stallCoords: Array<{ x: number; y: number }>;
  borderCoords: PortalBorder[];
  /** Not read by the portal; kept so the two systems can be matched. */
  name: string;
  stallNumber: string | null;
  /** `unchanged` = the imported SelfCare data, as is; `changed` = imported, then edited. */
  source: 'unchanged' | 'changed' | 'planner';
}

export interface PortalExport {
  name: string;
  length: number;
  breadth: number;
  metersToPixels: number;
  layout_data: { shape: 'non-circular'; stallWidth: number; stallHeight: number };
  default_stalls: PortalStall[];
  skipped: Array<{ name: string; reason: string }>;
  /** Exported, but a person should look: e.g. a changed stall whose saved area text was kept. */
  warnings: Array<{ name: string; reason: string }>;
}

export interface PortalExportOptions {
  /** Canvas px per metre; SelfCare's booking page draws at 20 (`PX_PER_METRE`). */
  metersToPixels?: number;
  /** Cell size in metres: the matched layout's `stallWidth` / `stallHeight`. */
  cellWidth?: number;
  cellHeight?: number;
}

const EPS = 1e-6;
const whole = (v: number) => Math.abs(v - Math.round(v)) < EPS;

export function portalExport(
  hallName: string,
  frame: Rect,
  stalls: readonly Stall[],
  options: PortalExportOptions = {}
): PortalExport {
  const metersToPixels = options.metersToPixels ?? PX_PER_METRE;
  const cw = options.cellWidth ?? 1;
  const ch = options.cellHeight ?? 1;
  const px = (m: number) => Math.round(m * metersToPixels * 1000) / 1000;
  const cols = Math.round((frame.maxX - frame.minX) / cw);
  const rows = Math.round((frame.maxZ - frame.minZ) / ch);
  const out: PortalExport = {
    name: hallName,
    length: Math.round((frame.maxX - frame.minX) * 1000) / 1000,
    breadth: Math.round((frame.maxZ - frame.minZ) * 1000) / 1000,
    metersToPixels,
    layout_data: { shape: 'non-circular', stallWidth: cw, stallHeight: ch },
    default_stalls: [],
    skipped: [],
    warnings: []
  };

  for (const s of stalls) {
    if (s.status === 'CANCELLED') continue;
    const label = s.stallNumber ?? s.name;
    const source = s.selfcare ?? null;

    // Unchanged SelfCare stall on the same grid: its own data, untouched.
    const sameGrid = !!source && source.grid.pxPerMetre === metersToPixels &&
      Math.abs(source.grid.cellWidth - cw) < EPS && Math.abs(source.grid.cellHeight - ch) < EPS;
    const raw = source ? parseLayoutGrid(source.row.layout_grid) : null;
    if (source && sameGrid && raw && selfcareGeometryUnchanged(s)) {
      out.default_stalls.push({
        id: source.stallId ?? String(s.stallNumber ?? s.id),
        area: source.areaText,
        stallCoords: raw.stallCoords ?? [],
        borderCoords: raw.borderCoords ?? [],
        name: s.name,
        stallNumber: s.stallNumber,
        source: 'unchanged'
      });
      continue;
    }

    const turn = (((s.rotation ?? 0) % 360) + 360) % 360;
    if (Math.abs(turn / 90 - Math.round(turn / 90)) > EPS) {
      out.skipped.push({ name: label, reason: `rotated ${Math.round(s.rotation ?? 0)}°` });
      continue;
    }

    // The outline in grid units from the canvas corner; every corner must be a grid vertex.
    const outline = stallPolygon(s).map(p => ({ x: (p.x - frame.minX) / cw, z: (p.z - frame.minZ) / ch }));
    if (!outline.every(p => whole(p.x) && whole(p.z))) {
      out.skipped.push({ name: label, reason: `not on the ${cw} × ${ch} m cell grid` });
      continue;
    }
    const grid: Point[] = outline.map(p => ({ x: Math.round(p.x), z: Math.round(p.z) }));
    const cells = rasterize(grid);
    if (Math.abs(cells.length - polygonArea(grid)) > EPS) {
      out.skipped.push({ name: label, reason: `not a union of whole ${cw} × ${ch} m cells` });
      continue;
    }
    if (cells.some(c => c.col < 0 || c.row < 0 || c.col >= cols || c.row >= rows)) {
      out.skipped.push({ name: label, reason: 'outside the SelfCare hall canvas' });
      continue;
    }

    const open = openEdgeList(s).map(e => [grid[e.index], grid[(e.index + 1) % grid.length]] as const);
    const borders: PortalBorder[] = outlineLoops(cells).flat().map(e => {
      const a = { x: e.from.col, z: e.from.row };
      const b = { x: e.to.col, z: e.to.row };
      return {
        x1: px(Math.min(a.x, b.x) * cw),
        x2: px(Math.max(a.x, b.x) * cw),
        y1: px(Math.min(a.z, b.z) * ch),
        y2: px(Math.max(a.z, b.z) * ch),
        isDashed: open.some(([p, q]) => onSegment(a, p, q) && onSegment(b, p, q))
      };
    });

    const edited = !!source;
    if (source) {
      const why = selfcareGeometryUnchanged(s) ? 'exported on a different cell grid than it was imported with' : 'changed since import';
      out.warnings.push({
        name: label,
        reason: source.areaText != null
          ? `${why}: saved area "${source.areaText}" kept, geometric area now ${round(cells.length * cw * ch)} m²`
          : why
      });
    }
    out.default_stalls.push({
      id: source?.stallId ?? String(s.stallNumber ?? s.id),
      area: edited && source!.areaText != null ? source!.areaText : `${cells.length}sqm`,
      stallCoords: cells.map(c => ({ x: px(c.col * cw), y: px(c.row * ch) })),
      borderCoords: borders,
      name: s.name,
      stallNumber: s.stallNumber,
      source: edited ? 'changed' : 'planner'
    });
  }
  return out;
}

/** The cells whose centre lies inside an outline given in grid units, row by row. */
function rasterize(outline: Point[]): GridCell[] {
  const xs = outline.map(p => p.x);
  const zs = outline.map(p => p.z);
  const cells: GridCell[] = [];
  for (let row = Math.min(...zs); row < Math.max(...zs); row++) {
    for (let col = Math.min(...xs); col < Math.max(...xs); col++) {
      if (pointInPolygon({ x: col + 0.5, z: row + 0.5 }, outline)) cells.push({ col, row });
    }
  }
  return cells;
}

/** `p` lies on segment a-b (grid units). */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  return (
    Math.abs(cross) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.z >= Math.min(a.z, b.z) - EPS && p.z <= Math.max(a.z, b.z) + EPS
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
