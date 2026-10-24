import { defaultParams, HALL_SHAPES, outlineOf, shapeById } from './hall-shapes';
import { isNtaCategory } from './hall-category';
import { extent, outlineArea, parseCorners } from './outline-geometry';

describe('hall shapes', () => {
  for (const { id } of HALL_SHAPES.filter((s) => s.id !== 'custom')) {
    it(`should make a valid outline for ${id} from its default measurements`, () => {
      const outline = outlineOf(id, defaultParams(id));

      expect(outline.error).toBeNull();
      expect(outline.ring?.length).toBeGreaterThanOrEqual(3);
    });
  }

  it('should make a rectangle of its width and depth', () => {
    const outline = outlineOf('rectangle', { width: 40, depth: 30 });

    expect(outline.ring).toEqual([
      [0, 0],
      [40, 0],
      [40, 30],
      [0, 30],
    ]);
    expect(outline.ring && outlineArea(outline.ring)).toBe(1200);
  });

  it('should cut the corner of an L-shape out of its floor', () => {
    const outline = outlineOf('l', { width: 10, depth: 8, cutWidth: 4, cutDepth: 3 });

    expect(outline.ring && outlineArea(outline.ring)).toBe(80 - 12);
    expect(outline.ring && extent(outline.ring)).toEqual({ width: 10, depth: 8 });
  });

  it('should refuse measurements outside their range, naming the measurement', () => {
    const outline = outlineOf('rectangle', { width: 0, depth: 30 });

    expect(outline.error).toContain('Width');
  });

  it('should refuse a cut-out as big as the hall', () => {
    expect(outlineOf('l', { width: 10, depth: 8, cutWidth: 10, cutDepth: 3 }).error).toMatch(
      /smaller/,
    );
  });

  it('should take the corners of a custom outline and refuse too few', () => {
    expect(
      outlineOf('custom', {}, [
        [0, 0],
        [5, 0],
      ]).error,
    ).toMatch(/three corners/);
    expect(
      outlineOf('custom', {}, [
        [0, 0],
        [10, 0],
        [10, 10],
      ]).ring?.length,
    ).toBe(3);
  });

  it('should refuse an outline that crosses itself', () => {
    const bowtie: [number, number][] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 14],
    ];

    expect(outlineOf('custom', {}, bowtie).error).toMatch(/crosses itself/);
  });

  it('should move an outline to the origin and draw it clockwise', () => {
    const counterClockwise: [number, number][] = [
      [5, 5],
      [5, 15],
      [25, 15],
      [25, 5],
    ];
    const { ring } = outlineOf('custom', {}, counterClockwise);

    expect(ring?.[0]).toEqual([0, 0]);
    expect(ring && extent(ring)).toEqual({ width: 20, depth: 10 });
    expect(ring && outlineArea(ring)).toBe(200);
  });

  it('should fall back to the rectangle for an unknown shape', () => {
    expect(shapeById('nope').id).toBe('rectangle');
  });
});

describe('typed corners', () => {
  it('should read pairs separated by semicolons or new lines', () => {
    expect(parseCorners('0,0; 40,0\n40,30; (0, 30)')).toEqual([
      [0, 0],
      [40, 0],
      [40, 30],
      [0, 30],
    ]);
  });

  it('should return null for a pair it cannot read', () => {
    expect(parseCorners('0,0; abc')).toBeNull();
  });
});

describe('NTA category', () => {
  const cases: [string | null, boolean][] = [
    ['NTA (Non-Tower Area.)', true],
    ['nta', true],
    ['New Exhibition Halls (Ground Floor)', false],
    [null, false],
  ];
  for (const [name, expected] of cases) {
    it(`should read ${name} as ${expected}`, () => {
      expect(isNtaCategory(name)).toBe(expected);
    });
  }
});
