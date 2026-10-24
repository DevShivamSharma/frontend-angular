import {
  fitToGrid,
  resizeLayout,
  GrowFrom,
  lineAt,
  moveLine,
  removeLine,
  setLine,
  isPillar,
  LayoutArea,
  parseLayout,
  PILLAR_FILL,
  togglePillar,
  toLayoutData,
} from './hall-layout';

const WALL: LayoutArea = {
  x: 0,
  y: 0,
  width: 10,
  height: 1,
  fillColor: '#ffffff',
  strokeColor: '#ffffff',
};
const GRID = { columns: 20, rows: 10 };

describe('hall layout', () => {
  it('should put a pillar on bare floor, in the pillar colour', () => {
    const areas = togglePillar([WALL], { x: 5, y: 5 }, 1, GRID);

    expect((areas as unknown[]).length).toBe(2);
    expect(isPillar(areas[1])).toBe(true);
    expect(areas[1]).toEqual({
      x: 5,
      y: 5,
      width: 1,
      height: 1,
      fillColor: PILLAR_FILL,
      strokeColor: '#374151',
    });
  });

  it('should take a pillar away when its cell is clicked again, even a big one from another cell of it', () => {
    const placed = togglePillar([], { x: 5, y: 5 }, 3, GRID);
    const removed = togglePillar(placed, { x: 6, y: 6 }, 1, GRID);

    expect(removed).toEqual([]);
  });

  it('should put a pillar over a coloured wall line, which is not outside the floor', () => {
    const line: LayoutArea = {
      x: 3,
      y: 0,
      width: 0.5,
      height: 5,
      fillColor: '#742371',
      strokeColor: '#742371',
    };

    expect((togglePillar([line], { x: 3, y: 2 }, 1, GRID) as unknown[]).length).toBe(2);
  });

  it('should not put a pillar on a wall', () => {
    expect(togglePillar([WALL], { x: 3, y: 0 }, 1, GRID)).toEqual([WALL]);
  });

  it('should keep a big pillar inside the grid', () => {
    const [pillar] = togglePillar([], { x: 19, y: 9 }, 3, GRID);

    expect(pillar).toEqual(jasmine.objectContaining({ x: 17, y: 7, width: 3, height: 3 }));
  });

  it('should cut off the pillars a smaller grid leaves outside, and keep ITPO’s own areas', () => {
    const areas = togglePillar(
      togglePillar([WALL], { x: 15, y: 5 }, 1, GRID),
      { x: 2, y: 5 },
      1,
      GRID,
    );
    const fitted = fitToGrid(areas, { columns: 10, rows: 10 });

    expect((fitted as unknown[]).length).toBe(2);
    expect(fitted[0]).toBe(WALL);
  });

  it('should save ITPO’s other fields as they were, with the areas as they are', () => {
    const layout = parseLayout(
      [
        {
          length: 20,
          breadth: 10,
          layout_data: { shape: 'non-circular', stallWidth: 1, nonClickableAreas: [WALL] },
        },
      ],
      7,
    )!;
    const data = toLayoutData(layout, [WALL, { ...WALL, y: 4, fillColor: PILLAR_FILL }]);

    expect(data['shape']).toBe('non-circular');
    expect(data['stallWidth']).toBe(1);
    expect((data['nonClickableAreas'] as unknown[]).length).toBe(2);
  });

  it('should read ITPO’s answer, and answer null when there is no layout', () => {
    expect(parseLayout([], 7)).toBeNull();
    expect(parseLayout(null, 7)).toBeNull();
    expect(parseLayout([{ length: 0, breadth: 5, layout_data: {} }], 7)).toBeNull();
    const layout = parseLayout(
      [{ length: '84', breadth: '116', layout_data: { nonClickableAreas: [WALL, { x: 'bad' }] } }],
      7,
    )!;
    expect(layout).toEqual(jasmine.objectContaining({ hallId: 7, columns: 84, rows: 116 }));
    expect((layout.areas as unknown[]).length).toBe(1);
  });

  describe('wall lines', () => {
    const LINE: LayoutArea = {
      x: 2,
      y: 1.5,
      width: 0.5,
      height: 20,
      fillColor: '#742371',
      strokeColor: '#742371',
    };
    const OTHER: LayoutArea = {
      x: 5,
      y: 3,
      width: 8,
      height: 0.5,
      fillColor: '#742371',
      strokeColor: '#742371',
    };
    const big = { columns: 59, rows: 126 };

    it('should move a line by whole metres and keep its thickness and half-metre offset', () => {
      const moved = moveLine([LINE, OTHER], 0, { x: 3, y: -1 }, big);

      expect(moved[0]).toEqual({ ...LINE, x: 5, y: 0.5 });
      expect(moved[1]).toBe(OTHER);
    });

    it('should keep a moved line inside the grid', () => {
      expect(moveLine([LINE], 0, { x: -10, y: -10 }, big)[0]).toEqual(
        jasmine.objectContaining({ x: 0, y: 0 }),
      );
      expect(moveLine([LINE], 0, { x: 500, y: 500 }, big)[0]).toEqual(
        jasmine.objectContaining({ x: 58.5, y: 106 }),
      );
    });

    it('should make a line longer or shorter along its own direction, not across', () => {
      expect(setLine([LINE], 0, { length: 30 }, big)[0]).toEqual(
        jasmine.objectContaining({ width: 0.5, height: 30 }),
      );
      expect(setLine([OTHER], 0, { length: 4 }, big)[0]).toEqual(
        jasmine.objectContaining({ width: 4, height: 0.5 }),
      );
    });

    it('should not change or remove a pillar or the outside of the floor', () => {
      const pillar = togglePillar([], { x: 5, y: 5 }, 1, big);
      const outside: LayoutArea = {
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        fillColor: '#ffffff',
        strokeColor: '#ffffff',
      };

      expect(setLine(pillar, 0, { x: 9 }, big)).toEqual(pillar);
      expect(removeLine([outside], 0)).toEqual([outside]);
      expect(removeLine([LINE, OTHER], 0)).toEqual([OTHER]);
    });

    it('should find the wall line near a point, the nearest one, and none when far', () => {
      expect(lineAt([LINE, OTHER], { x: 2.2, y: 10 }, 0.75)).toBe(0);
      expect(lineAt([LINE, OTHER], { x: 8, y: 3.8 }, 0.75)).toBe(1);
      expect(lineAt([LINE, OTHER], { x: 30, y: 60 }, 0.75)).toBeNull();
    });
  });

  describe('resizing the grid', () => {
    const purple = (x: number, y: number, width: number, height: number): LayoutArea => ({
      x,
      y,
      width,
      height,
      fillColor: '#742371',
      strokeColor: '#742371',
    });
    const white = (x: number, y: number, width: number, height: number): LayoutArea => ({
      x,
      y,
      width,
      height,
      fillColor: '#ffffff',
      strokeColor: '#ffffff',
    });
    const from = { columns: 59, rows: 126 };

    it('should move the wall on the right edge with it, and stretch the lines that reach it', () => {
      const [top, left, right] = resizeLayout(
        [purple(1.5, 0.5, 57, 0.5), purple(1.5, 0.5, 0.5, 125), purple(58, 0.5, 0.5, 125)],
        from,
        { columns: 80, rows: 126 },
      );

      expect(top).toEqual(jasmine.objectContaining({ x: 1.5, width: 78 }));
      expect(left).toEqual(jasmine.objectContaining({ x: 1.5, width: 0.5 }));
      expect(right).toEqual(jasmine.objectContaining({ x: 79, width: 0.5 }));
    });

    it('should move the wall on the bottom edge with it, and stretch the lines that reach it', () => {
      const [bottom, left] = resizeLayout(
        [purple(1.5, 125, 57, 0.5), purple(1.5, 0.5, 0.5, 125)],
        from,
        {
          columns: 59,
          rows: 150,
        },
      );

      expect(bottom).toEqual(jasmine.objectContaining({ y: 149, height: 0.5 }));
      expect(left).toEqual(jasmine.objectContaining({ y: 0.5, height: 149 }));
    });

    it('should make a block of outside floor on the edge bigger, and not the pillars or what is not on the edge', () => {
      const pillar = togglePillar([], { x: 10, y: 10 }, 1, from)[0];
      const [block, middle, kept] = resizeLayout(
        [white(41, 0, 18, 84), purple(30, 0.5, 0.5, 50), pillar],
        from,
        {
          columns: 70,
          rows: 126,
        },
      );

      expect(block).toEqual(jasmine.objectContaining({ x: 41, width: 29 }));
      expect(middle).toEqual(jasmine.objectContaining({ x: 30 }));
      expect(kept).toEqual(pillar);
    });

    it('should bring the right wall back when the grid is made smaller, and cut off the pillars outside', () => {
      const pillar = togglePillar([], { x: 50, y: 10 }, 1, from)[0];
      const resized = resizeLayout([purple(58, 0.5, 0.5, 125), pillar], from, {
        columns: 40,
        rows: 126,
      });

      expect(resized).toEqual([jasmine.objectContaining({ x: 39, width: 0.5 })]);
    });

    const LEFT_TOP: GrowFrom = { horizontal: 'left', vertical: 'top' };

    it('should grow at the left: the left wall stays on the left edge, the rest of the hall moves along', () => {
      const pillar = togglePillar([], { x: 10, y: 10 }, 1, from)[0];
      const [top, left, right, moved] = resizeLayout(
        [purple(1.5, 0.5, 57, 0.5), purple(1.5, 0.5, 0.5, 125), purple(58, 0.5, 0.5, 125), pillar],
        from,
        { columns: 80, rows: 126 },
        LEFT_TOP,
      );

      expect(top).toEqual(jasmine.objectContaining({ x: 1.5, width: 78 }));
      expect(left).toEqual(jasmine.objectContaining({ x: 1.5 }));
      expect(right).toEqual(jasmine.objectContaining({ x: 79 }));
      expect(moved).toEqual(jasmine.objectContaining({ x: 31, y: 10 }));
    });

    it('should grow at the top: the top wall stays, the rest moves down', () => {
      const [top, left, pillar] = resizeLayout(
        [
          purple(1.5, 0.5, 57, 0.5),
          purple(1.5, 0.5, 0.5, 125),
          togglePillar([], { x: 10, y: 10 }, 1, from)[0],
        ],
        from,
        { columns: 59, rows: 150 },
        LEFT_TOP,
      );

      expect(top).toEqual(jasmine.objectContaining({ y: 0.5, height: 0.5 }));
      expect(left).toEqual(jasmine.objectContaining({ y: 0.5, height: 149 }));
      expect(pillar).toEqual(jasmine.objectContaining({ y: 34 }));
    });

    it('should cut off a pillar that a smaller grid, cut at the left, no longer holds', () => {
      const pillar = togglePillar([], { x: 3, y: 10 }, 1, from)[0];

      expect(resizeLayout([pillar], from, { columns: 40, rows: 126 }, LEFT_TOP)).toEqual([]);
    });

    it('should leave everything alone when the grid is the same size', () => {
      const areas = [purple(58, 0.5, 0.5, 125)];

      expect(resizeLayout(areas, from, from)).toEqual(areas);
    });
  });
});
