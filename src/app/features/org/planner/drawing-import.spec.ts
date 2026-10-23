import type { DrawingImportResult, DrawingStall } from '../../../core/plans/drawing-import.models';
import {
  adjustOutline,
  autoFit,
  cellShapeOf,
  importNotes,
  matchGroups,
  notchOpenEdges,
  numberOf,
  openSidesOf,
  overrideText,
  placeStalls,
  rectOf,
  shrunkAlignment,
  toPlanStall,
  turn,
  twinNumbers,
} from './drawing-import';
import { plannerFloor } from './planner-geometry';

const floor = plannerFloor({
  schema: 'floor/1',
  width: 40,
  depth: 30,
  areas: [{ kind: 'passage', x: 0, y: 0, width: 4, height: 30 }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
});

const rect = (x: number, z: number, w: number, d: number) => [
  { x, z },
  { x: x + w, z },
  { x: x + w, z: z + d },
  { x, z: z + d },
];

/** A 6 × 6 box with its bottom-left 3 × 3 not the stall's: 27 m². */
const L = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: 6 },
  { x: 3, z: 6 },
  { x: 3, z: 3 },
  { x: 0, z: 3 },
];

function stall(
  key: string,
  outline: Array<{ x: number; z: number }>,
  extra: Partial<DrawingStall> = {},
): DrawingStall {
  return {
    key,
    group: '8',
    blockId: '08-01',
    letter: key,
    name: `08-01 ${key}`,
    outline,
    openEdges: [2],
    area: 0,
    shape: outline.length === 4 ? 'rectangle' : 'L-shape',
    category: 'standard',
    labels: { area: null, dims: null, texts: [] },
    confidence: 'high',
    issues: [],
    include: true,
    outlinePt: outline,
    ...extra,
  };
}

function drawing(stalls: DrawingStall[]): DrawingImportResult {
  return {
    page: { width: 1000, height: 1000, rotation: 0 },
    layers: [],
    usedLayers: true,
    groups: [
      {
        group: '8',
        pitchX: 10,
        pitchY: 10,
        originX: 0,
        originY: 0,
        rms: 0,
        gridLines: 10,
        dimensionChecks: 0,
        dimensionMaxError: null,
        usesHalfMetres: false,
      },
    ],
    stalls,
    excluded: [],
    unresolved: [],
    issues: [],
    hall: { groups: ['8'], drawingHalls: ['8'], matchedByName: true },
  };
}

describe('importing stalls from a CAD plan', () => {
  it('matches halls of the drawing by the numbers in the hall name or code', () => {
    const groups = drawing([]).groups.concat({ ...drawing([]).groups[0], group: '9' });
    expect(matchGroups(['Hall 8-9', null], groups)).toEqual(['8', '9']);
    expect(matchGroups(['Hall 8G'], groups)).toEqual(['8']);
    expect(matchGroups(['Main hall', 'H9'], groups)).toEqual(['9']);
    expect(matchGroups(['Hall 5'], groups)).toEqual([]);
  });

  it('turns a quarter clockwise on the plan', () => {
    expect(turn({ x: 1, z: 0 }, 90)).toEqual({ x: -0, z: 1 });
    expect(turn({ x: 1, z: 2 }, 180)).toEqual({ x: -1, z: -2 });
  });

  it('keeps rectangles, brings L-shapes in as cut boxes, and leaves slants to draw by hand', () => {
    expect(rectOf(rect(2, 3, 3, 4))).toEqual({ x: 2, y: 3, width: 3, height: 4 });
    const slant = [
      { x: 0, z: 0 },
      { x: 4, z: 1 },
      { x: 4, z: 4 },
      { x: 0, z: 4 },
    ];
    expect(rectOf(slant)).toBeNull();
    const result = drawing([
      stall('A', rect(0, 0, 3, 3)),
      stall('C', L),
      stall(
        'S',
        slant.map((p) => ({ x: p.x + 10, z: p.z })),
      ),
    ]);
    const fit = autoFit(result, ['8'], floor);
    const placed = placeStalls(result, ['8'], fit.alignment, floor);
    const by = (key: string) => placed.find((p) => p.stall.key === key)!;
    expect(by('A').skip).toBeNull();
    expect(by('C').skip).toBeNull();
    expect(by('C').cutCells.length).toBe(9);
    expect(by('S').skip).toBe('Has a slanted edge: draw it by hand');
  });

  it('moves the drawing in whole metres, so its grid lines stay on the hall grid', () => {
    // A stall on a half metre does not move the rest off the grid: it stays on its half metre.
    const result = drawing([stall('A', rect(0, 0, 3, 3)), stall('B', rect(3, 0, 2.5, 3))]);
    result.groups[0].usesHalfMetres = true;
    const o = autoFit(result, ['8'], floor).alignment.offsets['8'];
    expect(Number.isInteger(o.x)).toBeTrue();
    expect(Number.isInteger(o.z)).toBeTrue();
  });

  it('fits a drawing bigger than the hall onto it, each stall sold at its drawn area', () => {
    // 80 m of stalls on a 40 × 30 hall: half size, all on the floor.
    const result = drawing([
      stall('A', rect(0, 0, 40, 6)),
      stall('B', rect(40, 0, 40, 6), { labels: { area: 250, dims: null, texts: [] } }),
    ]);
    const a = shrunkAlignment(result, ['8'], floor, 0);
    expect(a.scale).toBe(0.5);
    const placed = placeStalls(result, ['8'], a, floor);
    expect(placed.every((p) => p.onFloor)).toBeTrue();
    const by = (key: string) => toPlanStall(placed.find((p) => p.stall.key === key)!, [], []);
    expect(by('A').width).toBe(20);
    expect(by('A').labelArea).toBe(240);
    expect(by('B').labelArea).toBe(250);
    // A drawing that fits already keeps its size.
    expect(shrunkAlignment(drawing([stall('A', rect(0, 0, 3, 3))]), ['8'], floor, 0).scale).toBe(
      1,
    );
  });

  describe('as whole cells', () => {
    it('cuts the corner out of an L', () => {
      const shape = cellShapeOf(L)!;
      expect(shape.rect).toEqual({ x: 0, y: 0, width: 6, height: 6 });
      // The bottom-left 3 × 3 is not the stall's.
      const want: Array<[number, number]> = [];
      for (let r = 3; r < 6; r++) for (let c = 0; c < 3; c++) want.push([c, r]);
      expect(shape.cutCells).toEqual(want);
    });

    it('cuts the middle out of a U', () => {
      const u = [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 2 },
        { x: 2, z: 2 },
        { x: 2, z: 0 },
        { x: 3, z: 0 },
        { x: 3, z: 3 },
        { x: 0, z: 3 },
      ];
      expect(cellShapeOf(u)!.cutCells).toEqual([
        [1, 0],
        [1, 1],
      ]);
    });

    it('cuts a notch out of a box, and none out of a rectangle', () => {
      const notched = [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 2 },
        { x: 3, z: 2 },
        { x: 3, z: 3 },
        { x: 0, z: 3 },
      ];
      expect(cellShapeOf(notched)!.cutCells).toEqual([[3, 2]]);
      expect(cellShapeOf(rect(1, 1, 3, 2))!.cutCells).toEqual([]);
    });

    it('makes nothing of a slanted outline', () => {
      expect(
        cellShapeOf([
          { x: 0, z: 0 },
          { x: 3, z: 0 },
          { x: 0, z: 3 },
        ]),
      ).toBeNull();
      expect(
        cellShapeOf([
          { x: 0, z: 0 },
          { x: 4, z: 0 },
          { x: 4, z: 2 },
          { x: 2, z: 4 },
          { x: 0, z: 4 },
        ]),
      ).toBeNull();
    });
  });

  it('opens a side of the box, and closes an open edge round the notch', () => {
    // Edge 1 is the box's right side; edge 3 is a side of the notch, inside the box.
    const s = stall('C', L, { openEdges: [1, 3] });
    expect(openSidesOf(s, s.outline)).toEqual(['right']);
    expect(notchOpenEdges(s, s.outline)).toBe(1);
    const placed = placeStalls(
      drawing([s]),
      ['8'],
      { rotation: 0, offsets: { '8': { x: 10, z: 10 } } },
      floor,
    )[0];
    const made = toPlanStall(placed, [], []);
    expect(made.cutCells.length).toBe(9);
    expect(importNotes(placed, made)).toEqual([
      '08-01 C: an open side round its notch drawn closed.',
    ]);
    const off = { ...placed, stall: { ...s, labels: { area: 30, dims: null, texts: [] } } };
    expect(importNotes(off, made)[1]).toBe(
      '08-01 C: the drawing says 30 m², the cells give 27 m².',
    );
  });

  describe('one stall changed by hand', () => {
    const at = { rotation: 0 as const, offsets: { '8': { x: 10, z: 10 } } };
    const result = drawing([stall('A', rect(0, 0, 3, 2)), stall('B', rect(5, 0, 3, 3))]);

    it('moves, turns and resizes it after the alignment, and leaves the others', () => {
      const overrides = new Map([['A', { dx: 1, dz: -1, turn: 90 as const, width: 4 }]]);
      const placed = placeStalls(result, ['8'], at, floor, new Set(), overrides);
      // Turned about its box: 3 × 2 becomes 2 × 3, then 4 wide, then moved.
      expect(placed[0].rect).toEqual({ x: 11, y: 9, width: 4, height: 3 });
      expect(placed[1].rect).toEqual({ x: 15, y: 10, width: 3, height: 3 });
    });

    it('keeps the change through a new alignment, as it is relative', () => {
      const overrides = new Map([['A', { dx: -1, dz: 0 }]]);
      const moved = { rotation: 0 as const, offsets: { '8': { x: 20, z: 5 } } };
      expect(placeStalls(result, ['8'], moved, floor, new Set(), overrides)[0].rect).toEqual({
        x: 19,
        y: 5,
        width: 3,
        height: 2,
      });
    });

    it('says what was changed, and leaves out what is left out', () => {
      expect(overrideText({ dx: -1, dz: 0.5 })).toBe('moved 1 m left and 0.5 m down');
      expect(overrideText({ dx: 0, dz: 0, name: '08-01 A3' })).toBe('numbered 08-01 A3');
      // A number the drawing repeats, given anew, splits like the drawn one.
      const first = placeStalls(result, ['8'], at, floor)[0];
      expect(toPlanStall(first, [], [], '08-01 A3')).toEqual(
        jasmine.objectContaining({ islandNumber: '08-01', stallNumber: 'A3' }),
      );
      expect(adjustOutline(rect(0, 0, 3, 2), { dx: 0, dz: 0 })).toEqual(rect(0, 0, 3, 2));
      const placed = placeStalls(result, ['8'], at, floor, new Set(['B']));
      expect(placed[1].skip).toBe('Left out in the review');
    });

    it('numbers on a number the drawing repeats: the first in reading order keeps it', () => {
      const twice = drawing([
        stall('A', rect(0, 0, 3, 2), { name: '08-01 A1', letter: 'A1' }),
        stall('B', rect(0, 5, 3, 2), { name: '08-01 A1', letter: 'A1' }),
        stall('C', rect(5, 0, 3, 2), { name: '08-01 A2', letter: 'A2' }),
      ]);
      const placed = placeStalls(twice, ['8'], at, floor);
      // A2 is taken, so the lower A1 becomes A3.
      expect(twinNumbers(placed)).toEqual(new Map([['B', '08-01 A3']]));
      // A number given by hand is the stall's own.
      const own = new Map([['B', { dx: 0, dz: 0, name: '08-01 A9' }]]);
      expect(twinNumbers(placed, own).size).toBe(0);
    });

    it('brings in an outline the server doubted, once the review takes it as a stall', () => {
      const doubted = drawing([
        stall('A', rect(0, 0, 3, 2), {
          include: false,
          letter: null,
          issues: [
            {
              code: 'NO_LABEL',
              severity: 'warning',
              message:
                'Named area "HALL MASTER", not a lettered stall; import it only if it should be bookable.',
            },
          ],
        }),
      ]);
      expect(placeStalls(doubted, ['8'], at, floor)[0].skip).toContain('Not a stall');
      const taken = new Map([['A', { dx: 0, dz: 0, isStall: true }]]);
      expect(placeStalls(doubted, ['8'], at, floor, new Set(), taken)[0].skip).toBeNull();
    });

    it('leaves out an outline the drawing gives no letter, until the review takes it', () => {
      // "4F-13 (s239)": a block was read near it, but no letter is drawn in it.
      const bare = drawing([stall('A', rect(0, 0, 3, 2), { name: '08-01 (s1)', letter: null })]);
      expect(placeStalls(bare, ['8'], at, floor)[0].skip).toBe('No stall letter in the drawing');
      const taken = new Map([['A', { dx: 0, dz: 0, isStall: true }]]);
      expect(placeStalls(bare, ['8'], at, floor, new Set(), taken)[0].skip).toBeNull();
    });
  });

  it('fits the drawing on the open floor, off the passage', () => {
    const result = drawing([stall('A', rect(0, 0, 3, 3)), stall('B', rect(3, 0, 3, 3))]);
    const fit = autoFit(result, ['8'], floor);
    expect(fit.onFloor).toBe(2);
    for (const p of placeStalls(result, ['8'], fit.alignment, floor)) {
      expect(p.onFloor).toBeTrue();
      expect(p.rect!.x).toBeGreaterThanOrEqual(4);
    }
  });

  it('opens the sides the fascia is drawn on, and names the stall as drawn', () => {
    const s = stall('A', rect(10, 10, 3, 3));
    // Edge 2 runs from the bottom right corner to the bottom left: the bottom side.
    expect(openSidesOf(s, s.outline)).toEqual(['bottom']);
    expect(openSidesOf({ ...s, openEdges: [0, 1] }, s.outline)).toEqual(['top', 'right']);
    expect(numberOf(s)).toEqual({ islandNumber: '08-01', stallNumber: 'A' });
    expect(numberOf({ ...s, letter: null, name: '12' })).toEqual({
      islandNumber: null,
      stallNumber: '12',
    });
  });

  it('makes a planner stall, premium as the drawing marks it', () => {
    const s = stall('A', rect(10, 10, 3, 3), { category: 'premium' });
    const placed = placeStalls(
      drawing([s]),
      ['8'],
      { rotation: 0, offsets: { '8': { x: 0, z: 0 } } },
      floor,
    )[0];
    const made = toPlanStall(placed, [], [{ id: 'p', name: 'Premium', status: 'active' }]);
    expect(made).toEqual(
      jasmine.objectContaining({
        x: 10,
        y: 10,
        width: 3,
        depth: 3,
        islandNumber: '08-01',
        stallNumber: 'A',
        openSides: ['bottom'],
        isPremium: true,
        categoryIds: ['p'],
      }),
    );
  });
});
