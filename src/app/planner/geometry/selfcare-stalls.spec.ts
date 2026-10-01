import { portalExport } from '../drafting/portal-export';
import type { Stall } from '../models/stall.model';
import { placementContextFor } from './hall-rules';
import { auditLayout } from './placement-rules';
import { hallFromSelfcare, importSelfcareLayout, SelfcareLayoutRow } from './selfcare-layout';
import {
  importSelfcareStalls,
  SelfcareBorder,
  SelfcareStallRow,
  selfcareCellGrid,
  selfcareGeometryUnchanged
} from './selfcare-stalls';

/**
 * Event layout row 5 of Hall 12A (hall 67), as recorded in docs/selfcare-stall-booking-evidence.json:
 * 57 x 115 m, non-circular, 1 x 1 m cells. Areas / labels are not needed here.
 */
function hall12aLayout(): SelfcareLayoutRow {
  return {
    id: 5,
    hall_id: 67,
    event_id: 'c71a3f90-297f-4a40-9517-73d453b110a1',
    event_hall_id: '3902499c-24dc-4b7f-b883-2eeded0698c0',
    length: 57,
    breadth: 115,
    layout_data: { shape: 'non-circular', stallWidth: 1, stallHeight: 1, nonClickableAreas: [] }
  };
}

/** The sanitized 12-cell sample stall of the evidence file, verbatim geometry. */
function sampleStall(): SelfcareStallRow {
  const cells = [1040, 1060, 1080, 1100].flatMap(y => [760, 780, 800].map(x => ({ x, y })));
  const b = (x1: number, x2: number, y1: number, y2: number, isDashed: boolean): SelfcareBorder => ({ x1, x2, y1, y2, isDashed });
  return {
    id: 'c628b705-85a3-4072-9ac3-ae5bef8f3b2d',
    hall_id: 67,
    event_id: 'c71a3f90-297f-4a40-9517-73d453b110a1',
    event_hall_id: '3902499c-24dc-4b7f-b883-2eeded0698c0',
    no_of_open_sides: 2,
    category_id: [114, 100],
    layout_grid: {
      area: '12sqm',
      stallCoords: cells,
      borderCoords: [
        b(760, 780, 1040, 1040, false), b(760, 760, 1040, 1060, true), b(780, 800, 1040, 1040, false),
        b(800, 820, 1040, 1040, false), b(818, 818, 1040, 1060, false), b(760, 760, 1060, 1080, true),
        b(818, 818, 1060, 1080, false), b(760, 760, 1080, 1100, true), b(818, 818, 1080, 1100, false),
        b(760, 760, 1100, 1120, true), b(760, 780, 1118, 1118, true), b(780, 800, 1118, 1118, true),
        b(818, 818, 1100, 1120, false), b(800, 820, 1118, 1118, true)
      ]
    },
    stall_coordinates: { top: 1040, left: 760, width: 61, height: 81, centerX: 790.5, centerY: 910.5 }
  };
}

/** A synthetic stall of whole cells with exact borders; `open` says which outline sides are dashed. */
function cellStall(
  id: string,
  cells: Array<[number, number]>,
  open: (edge: { horizontal: boolean; line: number; from: number }) => boolean,
  px = 20
): SelfcareStallRow {
  const has = new Set(cells.map(([c, r]) => `${c},${r}`));
  const borders: SelfcareBorder[] = [];
  for (const [c, r] of cells) {
    const add = (x1: number, x2: number, y1: number, y2: number, horizontal: boolean, line: number, from: number) =>
      borders.push({ x1: x1 * px, x2: x2 * px, y1: y1 * px, y2: y2 * px, isDashed: open({ horizontal, line, from }) });
    if (!has.has(`${c},${r - 1}`)) add(c, c + 1, r, r, true, r, c);
    if (!has.has(`${c},${r + 1}`)) add(c, c + 1, r + 1, r + 1, true, r + 1, c);
    if (!has.has(`${c - 1},${r}`)) add(c, c, r, r + 1, false, c, r);
    if (!has.has(`${c + 1},${r}`)) add(c + 1, c + 1, r, r + 1, false, c + 1, r);
  }
  return {
    id,
    stall_number: id,
    hall_id: 67,
    event_id: 'c71a3f90-297f-4a40-9517-73d453b110a1',
    booking_status: 'Available',
    layout_grid: { area: `${cells.length}sqm`, stallCoords: cells.map(([c, r]) => ({ x: c * px, y: r * px })), borderCoords: borders }
  };
}

function importInto(rows: SelfcareStallRow[], layout = hall12aLayout()) {
  return importSelfcareStalls(rows, importSelfcareLayout(layout).source, 'hall-12a');
}

const codes = (issues: Array<{ code: string }>) => issues.map(i => i.code);
const hallFrame = { minX: -28.5, maxX: 28.5, minZ: -57.5, maxZ: 57.5 };

describe('SelfCare stall import: the documented Hall 12A sample', () => {
  it('reads the layout grid from the matched layout, not a hardcoded hall', () => {
    const source = importSelfcareLayout(hall12aLayout()).source;
    expect(source).toEqual(jasmine.objectContaining({ layoutId: 5, hallId: 67, stallWidth: 1, stallHeight: 1, length: 57, breadth: 115 }));
    expect(selfcareCellGrid(source)).toEqual(jasmine.objectContaining({ cellWidthPx: 20, cellHeightPx: 20, cols: 57, rows: 115 }));
  });

  it('imports the 12 cells as a 3 m x 4 m stall centred at (11, -3.5), open LEFT and FRONT', () => {
    const { stalls, issues } = importInto([sampleStall()]);
    expect(stalls.length).toBe(1);
    const s = stalls[0];
    expect([s.width, s.length, s.posX, s.posZ, s.rotation]).toEqual([3, 4, 11, -3.5, 0]);
    expect(s.footprint).toBeUndefined();
    expect([...s.openSides].sort()).toEqual(['FRONT', 'LEFT']);
    expect(s.stallNumber).toBeNull();
    expect(errorsOf(issues)).toEqual([]);
    // The 818 / 1118 px segments are matched to the 820 / 1120 cell edges and reported, not shifted.
    expect(issues.find(i => i.code === 'BORDER_OFFSET')?.message).toContain('2 px');
    expect(codes(issues)).not.toContain('AREA_DIFFERS');
    expect(codes(issues)).not.toContain('OPEN_SIDE_COUNT');
  });

  it('keeps source identity, saved area text and the raw row apart from planner fields', () => {
    const row = sampleStall();
    const s = importInto([row]).stalls[0];
    expect(s.id).not.toBe(row.id!);
    expect(s.selfcare).toEqual(jasmine.objectContaining({
      stallId: 'c628b705-85a3-4072-9ac3-ae5bef8f3b2d',
      hallId: 67,
      eventId: 'c71a3f90-297f-4a40-9517-73d453b110a1',
      eventHallId: '3902499c-24dc-4b7f-b883-2eeded0698c0',
      layoutId: 5,
      areaText: '12sqm',
      geometricArea: 12,
      heightSource: 'planner-default'
    }));
    expect(s.selfcare!.row).toEqual(row);
    expect(s.selfcare!.row).not.toBe(row);
    expect(s.selfcare!.row['category_id']).toEqual([114, 100]);
  });

  it('round-trips unchanged: the export writes back the source cells, borders, area text and id', () => {
    const row = sampleStall();
    const s = importInto([row]).stalls[0];
    expect(selfcareGeometryUnchanged(s)).toBeTrue();
    const out = portalExport('Hall 12A', hallFrame, [s]);
    expect(out.metersToPixels).toBe(20);
    expect([out.length, out.breadth]).toEqual([57, 115]);
    expect(out.default_stalls.length).toBe(1);
    const exported = out.default_stalls[0];
    expect(exported.source).toBe('unchanged');
    expect(exported.id).toBe(row.id!);
    expect(exported.area).toBe('12sqm');
    expect({ area: exported.area, stallCoords: exported.stallCoords, borderCoords: exported.borderCoords }).toEqual(row.layout_grid as never);
  });

  it('regenerates a moved stall on the cell grid, keeps its area text and says so', () => {
    const s = importInto([sampleStall()]).stalls[0];
    const moved: Stall = { ...s, posX: s.posX + 1 };
    expect(selfcareGeometryUnchanged(moved)).toBeFalse();
    const out = portalExport('Hall 12A', hallFrame, [moved]);
    const exported = out.default_stalls[0];
    expect(exported.source).toBe('changed');
    expect(exported.area).toBe('12sqm');
    expect(out.warnings[0].reason).toContain('changed since import');
    expect(exported.stallCoords[0]).toEqual({ x: 780, y: 1040 });
    const dashed = exported.borderCoords.filter(b => b.isDashed);
    expect(dashed.length).toBe(7);
    // Regenerated borders sit on the cell edges; no 2 px inset is invented.
    expect(dashed.filter(b => b.y1 === b.y2).every(b => b.y1 === 1120)).toBeTrue();
    expect(dashed.filter(b => b.x1 === b.x2).every(b => b.x1 === 780)).toBeTrue();
  });
});

describe('SelfCare stall import: shapes and openings', () => {
  it('keeps an L-shaped cell union as one custom footprint with its open edge', () => {
    // Cells (0,0), (0,1), (1,1): an L. Only the left side (x = 0) is open.
    const row = cellStall('L-1', [[0, 0], [0, 1], [1, 1]], e => !e.horizontal && e.line === 0);
    const { stalls, issues } = importInto([row]);
    expect(errorsOf(issues)).toEqual([]);
    const s = stalls[0];
    expect(s.footprint?.length).toBe(6);
    expect([s.width, s.length]).toEqual([2, 2]);
    expect([s.posX, s.posZ]).toEqual([-27.5, -56.5]);
    expect(s.openEdges?.length).toBe(1);
    expect(s.openSides).toEqual(['LEFT']);
    expect(s.selfcare!.geometricArea).toBe(3);
    const out = portalExport('Hall 12A', hallFrame, [{ ...s, selfcare: null }]);
    expect(out.default_stalls[0].stallCoords).toEqual([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 20, y: 20 }]);
    expect(out.default_stalls[0].borderCoords.filter(b => b.isDashed).length).toBe(2);
  });

  it('never widens a partial opening to a whole side', () => {
    // 3 x 1 at columns 10-12: the left side is open, and only the middle cell of the bottom.
    const row = cellStall('P-1', [[10, 5], [11, 5], [12, 5]], e =>
      (!e.horizontal && e.line === 10) || (e.horizontal && e.line === 6 && e.from === 11));
    const { stalls, issues } = importInto([row]);
    expect(stalls[0].openSides).toEqual(['LEFT']);
    const partial = issues.find(i => i.code === 'PARTIAL_OPENING');
    expect(partial?.severity).toBe('warning');
    expect(partial?.message).toContain('FRONT');
    // The original segments still export unchanged.
    expect(portalExport('Hall 12A', hallFrame, stalls).default_stalls[0].borderCoords).toEqual((row.layout_grid as { borderCoords: SelfcareBorder[] }).borderCoords);
  });

  it('reports shapes a planner stall cannot hold, instead of flattening them', () => {
    const ring: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
    const cases: Array<[SelfcareStallRow, string]> = [
      [cellStall('HOLE', ring, () => true), 'HOLES'],
      [cellStall('SPLIT', [[0, 0], [5, 5]], () => true), 'DISCONNECTED'],
      [cellStall('CLOSED', [[0, 0], [1, 0]], () => false), 'NO_WHOLE_OPEN_SIDE'],
      [{ ...cellStall('OFF', [[0, 0]], () => true), layout_grid: { area: '1sqm', stallCoords: [{ x: 765, y: 1040 }], borderCoords: [] } }, 'OFF_GRID'],
      [{ ...cellStall('OUT', [[57, 0]], () => true) }, 'OUTSIDE_HALL'],
      [{ ...cellStall('NOGRID', [[0, 0]], () => true), layout_grid: null }, 'NO_CELLS']
    ];
    const { stalls, issues } = importInto(cases.map(c => c[0]));
    expect(stalls.length).toBe(0);
    for (const [row, code] of cases) {
      expect(issues.find(i => i.stallId === row.id && i.severity === 'error')?.code).withContext(String(row.id)).toBe(code);
    }
  });
});

describe('SelfCare stall import: layouts, relationships and values', () => {
  it('uses the matched layout cell size (2 x 2 m cells at 40 px)', () => {
    const layout = { ...hall12aLayout(), length: 60, breadth: 40, layout_data: { shape: 'non-circular', stallWidth: 2, stallHeight: 2 } };
    const row = cellStall('BIG', [[0, 0], [1, 0]], e => e.horizontal && e.line === 1, 40);
    const { stalls } = importInto([row], layout);
    expect([stalls[0].width, stalls[0].length, stalls[0].posX, stalls[0].posZ]).toEqual([4, 2, -28, -19]);
    expect(stalls[0].openSides).toEqual(['FRONT']);
    expect(stalls[0].selfcare!.geometricArea).toBe(8);
    expect(codes(importInto([row], layout).issues)).toContain('AREA_DIFFERS');
  });

  it('refuses layouts whose cell sizing is not verified', () => {
    const circular = { ...hall12aLayout(), layout_data: { shape: 'circular', stallWidth: 1, stallHeight: 1 } };
    const stretched = { ...hall12aLayout(), length: 57.5 };
    const noGrid = { ...hall12aLayout(), layout_data: { shape: 'non-circular' } };
    for (const layout of [circular, stretched, noGrid]) {
      const { stalls, issues } = importInto([sampleStall()], layout);
      expect(stalls.length).toBe(0);
      expect(codes(issues)).toEqual(['LAYOUT_UNSUPPORTED']);
    }
  });

  it('matches stalls to their own hall, event and event hall', () => {
    const other = { ...sampleStall(), event_id: 'another-event' };
    const wrongHall = { ...sampleStall(), hall_id: 68 };
    const defaultLayout = { ...hall12aLayout(), event_id: undefined, event_hall_id: undefined };
    expect(errorsOf(importInto([other]).issues)).toEqual(['EVENT_MISMATCH']);
    expect(errorsOf(importInto([wrongHall]).issues)).toEqual(['HALL_MISMATCH']);
    expect(errorsOf(importInto([sampleStall()], defaultLayout).issues)).toEqual(['LAYOUT_NOT_EVENT_LAYOUT']);
    expect(errorsOf(importInto([sampleStall(), sampleStall()]).issues)).toEqual(['DUPLICATE_STALL']);
  });

  it('keeps string "null" statuses, nulls and unknown columns as they are', () => {
    const row = { ...sampleStall(), booking_status: 'null', is_premium: null, price: null, stall_type: 'Bare' };
    const { stalls, issues } = importInto([row]);
    expect(stalls[0].status).toBe('AVAILABLE');
    expect(issues.find(i => i.code === 'STATUS_UNMAPPED')?.message).toContain('"null"');
    expect(stalls[0].selfcare!.row).toEqual(row);
    expect(importInto([{ ...sampleStall(), booking_status: 'Booked' }]).stalls[0].status).toBe('BOOKED');
  });
});

describe('SelfCare stall import: existing placement rules', () => {
  const hall = () => hallFromSelfcare(hall12aLayout());
  const audit = (stalls: Stall[], h = hall()) => auditLayout(placementContextFor(h, stalls, 'B2B')).flatMap(e => e.violations.map(v => v.code));

  it('the sample passes the default checks where it stands', () => {
    expect(audit(importInto([sampleStall()]).stalls)).toEqual([]);
  });

  it('reports rule problems of imported geometry without moving anything', () => {
    // A 1 x 4 m stall right in front of the sample's LEFT opening (x 37..38 m).
    const blocker = cellStall('B-1', [[37, 52], [37, 53], [37, 54], [37, 55]], e => !e.horizontal && e.line === 37);
    const { stalls } = importInto([sampleStall(), blocker]);
    expect(audit(stalls)).toContain('OPEN_SIDE_BLOCKED');
    expect(stalls.map(s => s.posX)).toEqual([11, 9]);

    // The same layout with the open-side check switched off in the hall's own settings.
    const relaxed = { ...hall(), rules: { enabledRules: { openSideAccess: false } } };
    expect(audit(stalls, relaxed)).not.toContain('OPEN_SIDE_BLOCKED');
  });

  it('flags overlapping imported stalls', () => {
    const overlap = cellStall('O-1', [[39, 53], [40, 53]], e => e.horizontal && e.line === 54);
    expect(audit(importInto([sampleStall(), overlap]).stalls)).toContain('STALL_OVERLAP');
  });
});

function errorsOf(issues: Array<{ severity: string; code: string }>): string[] {
  return issues.filter(i => i.severity === 'error').map(i => i.code);
}
