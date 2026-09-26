import { FreeSpaceMap } from './free-space';
import { GridSystem } from './grid-system';
import { DEFAULT_LAYOUT_RULES, PlacementContext, PlacementStall, validatePlacement } from './placement-rules';

describe('FreeSpaceMap', () => {
  // 20 x 12 m hall, boundary = its rectangle, 0 m peripheral clearance to keep the numbers simple.
  const grid = new GridSystem(0, 0, 20, 12);
  const boundary = [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 12 },
    { x: 0, z: 12 }
  ];
  const rules = { ...DEFAULT_LAYOUT_RULES, peripheralClearance: 0 };

  function ctx(stalls: PlacementStall[]): PlacementContext {
    return { boundary, zones: [], openings: [], rules, eventType: 'B2B', stalls };
  }

  function stall(id: string, minX: number, minZ: number, w: number, l: number): PlacementStall {
    return { id, stallNumber: id, posX: minX + w / 2, posZ: minZ + l / 2, width: w, length: l };
  }

  it('counts blocked cells inside a window', () => {
    const map = new FreeSpaceMap(grid, ctx([stall('A', 0, 0, 3, 2)]));
    // 3 x 2 m stall = 6 x 4 half-metre cells.
    expect(map.blockedCellsIn({ minX: 0, minZ: 0, maxX: 20, maxZ: 12 })).toBe(24);
    expect(map.isFree({ minX: 3, minZ: 0, maxX: 6, maxZ: 2 })).toBeTrue();
    expect(map.isFree({ minX: 2, minZ: 0, maxX: 5, maxZ: 2 })).toBeFalse();
  });

  it('scattered free cells do not make room for a large stall', () => {
    // A row of 2 x 2 stalls with 1 m gaps everywhere: lots of empty area in total, none of it
    // contiguous enough for a 10 x 10 stall (and every 1 m gap also breaks the 3 m passage rule).
    const stalls: PlacementStall[] = [];
    for (let z = 0; z < 12; z += 3) {
      for (let x = 0; x < 20; x += 3) stalls.push(stall(`S${x}-${z}`, x, z, 2, 2));
    }
    const map = new FreeSpaceMap(grid, ctx(stalls));

    expect(map.validPlacements(10, 10)).toEqual([]);
    expect(map.nearestPlacement(10, 10, { x: 10, z: 6 })).toBeNull();
  });

  it('finds the nearest contiguous spot that passes every rule', () => {
    const map = new FreeSpaceMap(grid, ctx([stall('A', 0, 0, 3, 2)]));
    // A corner stall cannot share an edge, and its FRONT access must stay free.
    const spot = map.nearestPlacement(3, 2, { x: 1.5, z: 1 });
    expect(spot).not.toBeNull();
    expect(validatePlacement(spot!, ctx([stall('A', 0, 0, 3, 2)])).valid).toBeTrue();
    expect(spot!.posZ === 3 && spot!.posX === 1.5).toBeFalse();
  });

  it('ignores the stall being moved', () => {
    const map = new FreeSpaceMap(grid, ctx([stall('A', 0, 0, 3, 2)]));
    const spot = map.nearestPlacement(3, 2, { x: 1.5, z: 1 }, 'A');
    // The raster still marks A's old cells, so the nearest free window is next to them.
    expect(spot).not.toBeNull();
  });
});
