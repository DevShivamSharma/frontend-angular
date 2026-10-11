import type { DrawingImportResult, DrawingStall } from '../../../core/plans/drawing-import.models';
import {
  autoFit,
  matchGroups,
  numberOf,
  openSidesOf,
  placeStalls,
  rectOf,
  toPlanStall,
  turn,
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

  it('keeps rectangles, and leaves L-shapes and slanted outlines to draw by hand', () => {
    expect(rectOf(rect(2, 3, 3, 4))).toEqual({ x: 2, y: 3, width: 3, height: 4 });
    expect(
      rectOf([
        { x: 0, z: 0 },
        { x: 4, z: 1 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
      ]),
    ).toBeNull();
    const l = stall('C', [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 6 },
      { x: 3, z: 6 },
      { x: 3, z: 3 },
      { x: 0, z: 3 },
    ]);
    const result = drawing([stall('A', rect(0, 0, 3, 3)), l]);
    const fit = autoFit(result, ['8'], floor);
    const placed = placeStalls(result, ['8'], fit.alignment, floor);
    expect(placed.find((p) => p.stall.key === 'C')?.skip).toContain('L-shaped');
    expect(placed.find((p) => p.stall.key === 'A')?.skip).toBeNull();
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
