import { Hall } from '../models/hall.model';
import { GridSystem } from './grid-system';

describe('GridSystem', () => {
  // Hall 8-9-10 is 133 x 43 m: its edges are at +-66.5 / +-21.5, not on whole metres.
  const hall8910: Hall = { id: 1, name: 'Hall 8-9-10', shape: 'SQUARE', width: 133, length: 43, radius: 0 };

  it('starts the grid at the hall corner so lines run along the walls', () => {
    const grid = GridSystem.forHall(hall8910);
    expect(grid.originX).toBe(-66.5);
    expect(grid.originZ).toBe(-21.5);
    expect(grid.toWorld(0, 0)).toEqual({ x: -66.5, z: -21.5 });
    expect(grid.toGrid({ x: -63.5, z: -20.5 })).toEqual({ col: 3, row: 1 });
  });

  it('uses the boundary bounding box for an irregular hall', () => {
    const grid = GridSystem.forHall({
      ...hall8910,
      boundary: [
        { x: -64.5, z: -20.5 },
        { x: 64.5, z: -20.5 },
        { x: 64.5, z: 20.5 },
        { x: -64.5, z: 20.5 }
      ],
      rules: { snapStep: 0.5, gridUnit: 1 }
    });
    expect(grid.bounds).toEqual({ minX: -64.5, minZ: -20.5, maxX: 64.5, maxZ: 20.5 });
    expect(grid.snapStep).toBe(0.5);
  });

  it('snaps stall EDGES to the grid, so a 3 m stall gets a half-metre centre', () => {
    const grid = GridSystem.forHall(hall8910);
    const snapped = grid.snapFootprint({ posX: 0.2, posZ: 0.1, width: 3, length: 2 });
    // Edges: -66.5 + 65 = -1.5 .. 1.5  and  -21.5 + 21 = -0.5 .. 1.5
    expect(snapped).toEqual({ posX: 0, posZ: 0.5, width: 3, length: 2 });
  });

  describe('draftFootprint', () => {
    const grid = new GridSystem(0, 0, 40, 20);
    const type = { id: 'stall-3x2', label: '3 × 2', width: 3, height: 2, unit: 'meter' as const };

    it('custom: covers every cell the drag touched', () => {
      expect(grid.draftFootprint({ x: 2.3, z: 1.4 }, { x: 6.2, z: 3.1 }, null, true)).toEqual({
        posX: 4.5,
        posZ: 2.5,
        width: 5,
        length: 3
      });
    });

    it('custom: a click without movement is one snap cell', () => {
      expect(grid.draftFootprint({ x: 2.3, z: 1.4 }, { x: 2.3, z: 1.4 }, null, true)).toEqual({
        posX: 2.5,
        posZ: 1.5,
        width: 1,
        length: 1
      });
    });

    it('typed: anchored at the start corner, extending towards the pointer', () => {
      expect(grid.draftFootprint({ x: 2.3, z: 1.4 }, { x: 9, z: 2 }, type, true)).toEqual({
        posX: 3.5,
        posZ: 2,
        width: 3,
        length: 2
      });
      // Dragging left/up from the same start extends the other way.
      expect(grid.draftFootprint({ x: 2.3, z: 1.4 }, { x: -5, z: 1 }, type, true)).toEqual({
        posX: 1.5,
        posZ: 1,
        width: 3,
        length: 2
      });
    });

    it('typed: a vertical drag rotates the type (3 x 2 becomes 2 x 3)', () => {
      const f = grid.draftFootprint({ x: 2.3, z: 1.4 }, { x: 2.5, z: 8 }, type, true);
      expect([f.width, f.length]).toEqual([2, 3]);
    });

    it('typed hover: centred on the pointer, snapped', () => {
      expect(grid.draftFootprint({ x: 0, z: 0 }, { x: 10.2, z: 5.1 }, type, false)).toEqual({
        posX: 10.5,
        posZ: 5,
        width: 3,
        length: 2
      });
    });
  });
});
