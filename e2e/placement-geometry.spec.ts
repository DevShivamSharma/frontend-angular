import { test, expect } from '@playwright/test';
import { DEFAULT_LAYOUT_RULES, PlacementContext, Footprint, validatePlacement, isCornerStall } from '../src/app/planner/geometry/placement-rules';
import { placementContextFor } from '../src/app/planner/geometry/hall-rules';
import { previewSplit, splitSuffix } from '../src/app/planner/geometry/stall-split';
import { FreeSpaceMap } from '../src/app/planner/geometry/free-space';
import { GridSystem } from '../src/app/planner/geometry/grid-system';
import { Stall } from '../src/app/planner/models/stall.model';

const rect = (x: number, z: number, w: number, l: number) => [
  { x, z }, { x: x + w, z }, { x: x + w, z: z + l }, { x, z: z + l }
];
const context = (width = 3): PlacementContext => ({ boundary: rect(0, 0, 50, 50),
  zones: [], openings: [], stalls: [], eventType: 'B2B',
  rules: { ...DEFAULT_LAYOUT_RULES, minPassageWidth: { B2B: width, B2C: width } } });
const at = (x: number, z: number, side: 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' = 'FRONT'): Footprint =>
  ({ posX: x + 2, posZ: z + 2, width: 4, length: 4, openSides: [side] });
const codes = (f: Footprint, c: PlacementContext) => validatePlacement(f, c).violations.map(v => v.code);

for (const width of [3, 5]) {
  test(`geometry: ${width} m exact open-side passage accepted; 0.01 m too narrow rejected`, () => {
    const ctx = context(width);
    ctx.stalls = [{ ...at(1, 1), id: 'corner' }];
    // Closed sides: any gap or a shared wall, also at a hall corner.
    expect(validatePlacement(at(5 + width, 1), ctx).valid).toBe(true);
    expect(validatePlacement(at(5 + width - 0.01, 1), ctx).valid).toBe(true);
    expect(validatePlacement(at(5, 1, 'RIGHT'), ctx).valid).toBe(true);
    // In front of the open side the whole passage stays clear.
    expect(validatePlacement(at(1, 5 + width), ctx).valid).toBe(true);
    expect(codes(at(1, 5 + width - 0.01), ctx)).toContain('OPEN_SIDE_BLOCKED');
    expect(codes(at(5, 1, 'LEFT'), ctx)).toContain('OPEN_SIDE_BLOCKED');
  });
  test(`geometry: open frontage needs ${width} m inside actual floor`, () => {
    const ctx = context(width);
    expect(validatePlacement(at(20, 46 - width), ctx).valid).toBe(true);
    expect(codes(at(20, 46 - width + 0.01), ctx)).toContain('OPEN_SIDE_BLOCKED');
  });
}

test('geometry: shared walls are accepted on closed sides only, symmetrically', () => {
  const ctx = context();
  ctx.stalls = [{ ...at(10, 10, 'BACK'), id: 'a' }];
  expect(validatePlacement(at(10, 14, 'FRONT'), ctx).valid).toBe(true);
  expect(codes(at(10, 14, 'BACK'), ctx)).toContain('OPEN_SIDE_BLOCKED');
  expect(validatePlacement(at(10, 14, 'LEFT'), ctx).valid).toBe(true);
  expect(validatePlacement(at(14, 14), ctx).valid).toBe(true);
  ctx.stalls = [{ ...at(10, 14), id: 'b' }];
  expect(validatePlacement(at(10, 10, 'BACK'), ctx).valid).toBe(true);
  expect(codes(at(10, 10), ctx)).toContain('OPEN_SIDE_BLOCKED');
});

test('geometry: notch corners use the polygon, not its bounding box', () => {
  const ctx = context();
  ctx.boundary = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 },
    { x: 50, z: 20 }, { x: 50, z: 50 }, { x: 0, z: 50 }];
  const corner = at(25, 16, 'LEFT');
  expect(isCornerStall(corner, ctx)).toBe(true);
  ctx.stalls = [{ ...corner, id: 'notch' }];
  // Stands in the passage in front of the notch stall's open LEFT side.
  expect(codes(at(21, 16, 'LEFT'), ctx)).toContain('OPEN_SIDE_BLOCKED');
  expect(codes(at(31, 14), ctx)).toContain('OUTSIDE_HALL');
  expect(codes(at(26, 11, 'RIGHT'), { ...ctx, stalls: [] })).toContain('OPEN_SIDE_BLOCKED');
});

test('geometry: floor holes block open frontage, traversable passages do not', () => {
  const ctx = context();
  ctx.obstacles = [rect(10, 16, 4, 1)];
  expect(codes(at(10, 10), ctx)).toContain('OPEN_SIDE_BLOCKED');
  ctx.obstacles = [];
  ctx.zones = [{ id: 'p', kind: 'PASSAGE', label: 'Aisle', polygon: rect(10, 14, 4, 3) }];
  expect(validatePlacement(at(10, 10), ctx).valid).toBe(true);
});

test('geometry: circular halls use exact frontage corners and have no synthetic polygon corners', () => {
  const ctx = placementContextFor({ id: 1, name: 'Circle', shape: 'CIRCLE', width: 0, length: 0, radius: 20 }, [], 'B2B');
  expect(isCornerStall(at(0, 0), ctx)).toBe(false);
  expect(validatePlacement(at(0, 0), ctx).valid).toBe(true);
  expect(codes(at(0, 14), ctx)).toContain('OPEN_SIDE_BLOCKED');
});

test('geometry: disconnected floor regions remain available in free-space search', () => {
  const ctx = context();
  ctx.boundary = rect(0, 0, 10, 10);
  ctx.regions = [rect(20, 0, 10, 10)];
  const map = new FreeSpaceMap(new GridSystem(0, 0, 30, 10), ctx);
  const spot = map.nearestPlacement(2, 2, { x: 24, z: 4 });
  expect(spot?.posX).toBeGreaterThan(20);
});

test('geometry: width range, multiple open sides and cancelled neighbours', () => {
  for (const width of [2, 6, NaN]) expect(codes(at(10, 10), context(width))).toContain('INVALID_PASSAGE_WIDTH');
  expect(codes({ ...at(10, 10), openSides: [] }, context())).toContain('INVALID_OPEN_SIDES');
  const ctx = context();
  ctx.stalls = [{ ...at(10, 10), id: 'cancelled', status: 'CANCELLED' }];
  expect(validatePlacement(at(10, 10), ctx).valid).toBe(true);
  expect(codes({ ...at(1, 1), openSides: ['FRONT', 'LEFT'] }, ctx)).toContain('OPEN_SIDE_BLOCKED');
});

test('split: parent identifier, gaps, suffixes after Z and invalid atomic preview', () => {
  expect([0, 1, 25, 26, 27, 51, 52].map(splitSuffix)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  const parent = { ...at(10, 10), id: 9, hallId: 1, stallNumber: '5-10', name: 'Parent',
    status: 'AVAILABLE', width: 11, height: 4, color: '#3498db', gateSide: 'FRONT', stallTypeId: null } as Stall;
  const preview = previewSplit(parent, { count: 2, axis: 'X', arrangement: 'PASSAGE' }, context());
  expect(preview.error).toBeNull();
  expect(preview.violations).toEqual([]);
  expect(preview.children.map(c => c.stallNumber)).toEqual(['5-10-A', '5-10-B']);
  expect(preview.children[1].posX - preview.children[0].posX - preview.children[0].width).toBe(3);
  expect(previewSplit(parent, { count: 3, axis: 'X', arrangement: 'PASSAGE' }, context()).error).toBeTruthy();
  expect(parent.stallNumber).toBe('5-10');
});

test('geometry: rotated rectangles use actual edges and rotated open-side normals', () => {
  const ctx = context();
  const a = { posX: 20, posZ: 20, width: 4, length: 4, rotation: 45, openSides: ['BACK'] as const };
  ctx.stalls = [{ ...a, openSides: ['BACK'], id: 'rotated' }];
  const b: Footprint = { ...a, posX: 20 - 4 / Math.SQRT2, posZ: 20 + 4 / Math.SQRT2, openSides: ['FRONT'] };
  expect(validatePlacement(b, ctx).valid).toBe(true);
  expect(validatePlacement({ ...b, openSides: ['BACK'] }, ctx).valid).toBe(false);
  expect(codes({ ...b, posX: b.posX + 0.1 }, ctx)).toContain('STALL_OVERLAP');
});

test('geometry: rotated nearest placement does not reject free floor inside its unrotated bounds', () => {
  const ctx = context();
  ctx.stalls = [{ id: 'neighbour', posX: 25, posZ: 20, width: 2, length: 2, openSides: ['FRONT'] }];
  const map = new FreeSpaceMap(new GridSystem(0, 0, 50, 50), ctx);
  const spot = map.nearestPlacement(10, 2, { x: 20, z: 20 }, null, ['FRONT'], false, 90);
  expect(spot).toMatchObject({ posX: 20, posZ: 20, width: 10, length: 2, rotation: 90 });
});

test('geometry: closed sides either side of an exterior notch need no passage between them', () => {
  const ctx = context();
  ctx.boundary = [{ x: 0, z: 0 }, { x: 15, z: 0 }, { x: 15, z: 30 }, { x: 25, z: 30 },
    { x: 25, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 }];
  ctx.stalls = [{ ...at(26, 1), id: 'across-notch' }];
  expect(validatePlacement(at(10, 1), ctx).valid).toBe(true);
  ctx.stalls = [{ ...at(10, 1), id: 'existing-corner' }];
  expect(isCornerStall(at(26, 8), ctx)).toBe(false);
  expect(validatePlacement(at(26, 8), ctx).valid).toBe(true);
});
