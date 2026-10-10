import {
  defaultParams,
  extent,
  HALL_SHAPES,
  outlineArea,
  outlineOf,
  parseCorners,
} from './hall-shapes';

describe('hall shapes', () => {
  it('makes a closed, clockwise outline from the origin for every shape', () => {
    for (const shape of HALL_SHAPES.filter((s) => s.id !== 'custom')) {
      const out = outlineOf(shape.id, defaultParams(shape.id));
      expect(out.error).withContext(shape.id).toBeNull();
      const ring = out.ring!;
      expect(Math.min(...ring.map((p) => p[0])))
        .withContext(shape.id)
        .toBe(0);
      expect(Math.min(...ring.map((p) => p[1])))
        .withContext(shape.id)
        .toBe(0);
      expect(outlineArea(ring)).withContext(shape.id).toBeGreaterThan(100);
    }
  });

  it('measures the plain shapes exactly', () => {
    expect(outlineArea(outlineOf('rectangle', { width: 60, depth: 40 }).ring!)).toBe(2400);
    const l = outlineOf('l', { width: 60, depth: 40, cutWidth: 20, cutDepth: 15 }).ring!;
    expect(outlineArea(l)).toBe(2400 - 300);
    expect(l.length).toBe(6);
    const u = outlineOf('u', { width: 80, depth: 50, gapWidth: 30, gapDepth: 20 }).ring!;
    expect(outlineArea(u)).toBe(4000 - 600);
    const t = outlineOf('t', { width: 80, barDepth: 20, stemWidth: 30, depth: 60 }).ring!;
    expect(outlineArea(t)).toBe(1600 + 1200);
    expect(outlineArea(outlineOf('wedge', { front: 40, back: 70, depth: 50 }).ring!)).toBe(2750);
  });

  it('draws curved halls close to their true area', () => {
    const round = outlineOf('round', { diameter: 40 }).ring!;
    expect(outlineArea(round)).toBeCloseTo(Math.PI * 400, -1);
    expect(extent(round)).toEqual({ width: 40, depth: 40 });
    const arena = outlineOf('stadium', { length: 100, width: 50 }).ring!;
    expect(outlineArea(arena)).toBeCloseTo(50 * 50 + Math.PI * 625, -1);
    // A cinema: the screen's width along the top, a wider curved back.
    const fan = outlineOf('fan', { stage: 16, depth: 30, angle: 60 }).ring!;
    const { width, depth } = extent(fan);
    expect(width).toBeGreaterThan(40);
    expect(depth).toBeGreaterThan(30);
    expect(outlineOf('polygon', { sides: 8, across: 40 }).ring!.length).toBe(8);
  });

  it('says why measurements make no hall', () => {
    expect(outlineOf('l', { width: 60, depth: 40, cutWidth: 60, cutDepth: 10 }).error).toContain(
      'cut-out',
    );
    expect(outlineOf('stadium', { length: 40, width: 50 }).error).toContain('longer');
    expect(outlineOf('rectangle', { width: 0, depth: 40 }).error).toContain('Width');
    expect(
      outlineOf('custom', {}, [
        [0, 0],
        [10, 0],
      ]).error,
    ).toContain('three corners');
    // A bow tie crosses itself.
    expect(
      outlineOf('custom', {}, [
        [0, 0],
        [20, 10],
        [20, 0],
        [0, 30],
      ]).error,
    ).toContain('crosses');
  });

  it('reads typed corners and turns them clockwise', () => {
    const points = parseCorners('0,0; 0,30\n40, 30; (40 0)')!;
    expect(points).toEqual([
      [0, 0],
      [0, 30],
      [40, 30],
      [40, 0],
    ]);
    const ring = outlineOf('custom', {}, points).ring!;
    expect(ring[1]).toEqual([40, 0]);
    expect(parseCorners('0,0; ten,4')).toBeNull();
  });
});
