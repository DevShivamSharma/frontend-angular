import { BlockedArea, Hall } from '../models/hall.model';
import { Stall } from '../models/stall.model';
import {
  hallSize,
  normalizeOpenSides,
  normalizeStall,
  num,
  overlaps,
  overlapsBlockedArea,
  shapeOf,
  snapValue,
  validGate,
  withinHall
} from './planner-geometry';

const squareHall: Hall = {
  id: 1,
  name: 'Square',
  shape: 'SQUARE',
  width: 40,
  length: 40,
  radius: 0
};

const circleHall: Hall = {
  id: 2,
  name: 'Circle',
  shape: 'CIRCLE',
  width: 0,
  length: 0,
  radius: 20
};

function stall(overrides: Partial<Stall> = {}): Stall {
  return {
    id: 'a',
    hallId: 1,
    name: 'Shop',
    width: 8,
    length: 8,
    height: 4,
    posX: 0,
    posZ: 0,
    color: '#3498db',
    gateSide: 'FRONT',
    openSides: ['FRONT'],
    stallNumber: null,
    status: 'AVAILABLE',
    stallTypeId: null,
    ...overrides
  };
}

describe('snapValue', () => {
  it('rounds to the nearest whole unit by default', () => {
    expect(snapValue(3.4)).toBe(3);
    expect(snapValue(3.6)).toBe(4);
    expect(snapValue(-3.6)).toBe(-4);
  });

  it('honours a custom step', () => {
    expect(snapValue(7, 5)).toBe(5);
    expect(snapValue(8, 5)).toBe(10);
  });
});

describe('num', () => {
  it('returns the fallback only for non-finite input', () => {
    expect(num('12')).toBe(12);
    expect(num('abc', 5)).toBe(5);
    expect(num(undefined, 5)).toBe(5);
    expect(num(Infinity, 5)).toBe(5);
    // Number('') and Number(null) are 0, which is finite - so no fallback.
    expect(num('', 5)).toBe(0);
    expect(num(null, 5)).toBe(0);
  });
});

describe('shapeOf / validGate', () => {
  it('normalizes shapes, defaulting to SQUARE', () => {
    expect(shapeOf('circle')).toBe('CIRCLE');
    expect(shapeOf('  Circle ')).toBe('CIRCLE');
    expect(shapeOf('hexagon')).toBe('SQUARE');
    expect(shapeOf(undefined)).toBe('SQUARE');
  });

  it('normalizes gate sides, defaulting to FRONT', () => {
    expect(validGate('left')).toBe('LEFT');
    expect(validGate('BACK')).toBe('BACK');
    expect(validGate('sideways')).toBe('FRONT');
    expect(validGate(null)).toBe('FRONT');
  });
});

describe('hallSize', () => {
  it('uses width/length for a square hall', () => {
    expect(hallSize(squareHall)).toEqual({ width: 40, length: 40 });
  });

  it('uses the diameter for a circular hall', () => {
    expect(hallSize(circleHall)).toEqual({ width: 40, length: 40 });
  });

  it('falls back to 40x40 when the hall is missing', () => {
    expect(hallSize(null)).toEqual({ width: 40, length: 40 });
  });
});

describe('withinHall - square', () => {
  it('accepts a stall sitting exactly on the boundary', () => {
    expect(withinHall(squareHall, stall({ posX: 16, posZ: 16 }))).toBe(true);
  });

  it('rejects a stall crossing the boundary', () => {
    expect(withinHall(squareHall, stall({ posX: 17, posZ: 0 }))).toBe(false);
    expect(withinHall(squareHall, stall({ posX: 0, posZ: -17 }))).toBe(false);
  });

  it('uses the explicit x/z arguments when given', () => {
    const candidate = stall({ posX: 0, posZ: 0 });
    expect(withinHall(squareHall, candidate, 30, 0)).toBe(false);
  });

  it('rejects zero-sized stalls', () => {
    expect(withinHall(squareHall, stall({ width: 0 }))).toBe(false);
  });
});

describe('withinHall - circle', () => {
  it('accepts a stall whose half-diagonal fits inside the radius', () => {
    // half-diagonal of an 8x8 stall is ~5.66, well inside r=20 at the centre.
    expect(withinHall(circleHall, stall({ posX: 0, posZ: 0 }))).toBe(true);
    expect(withinHall(circleHall, stall({ posX: 14, posZ: 0 }))).toBe(true);
  });

  it('rejects a stall whose corner would leave the circle', () => {
    // 15 + 5.66 > 20.
    expect(withinHall(circleHall, stall({ posX: 15, posZ: 0 }))).toBe(false);
  });
});

describe('overlaps', () => {
  const a = stall({ id: 'a', posX: 0, posZ: 0 });

  it('treats edge-touching stalls as not overlapping', () => {
    const b = stall({ id: 'b', posX: 8, posZ: 0 });
    expect(overlaps(a, [b])).toBe(false);
  });

  it('detects a real overlap', () => {
    const b = stall({ id: 'b', posX: 7, posZ: 0 });
    expect(overlaps(a, [b])).toBe(true);
  });

  it('needs an overlap on both axes', () => {
    const b = stall({ id: 'b', posX: 7, posZ: 20 });
    expect(overlaps(a, [b])).toBe(false);
  });

  it('ignores the stall being moved', () => {
    const self = stall({ id: 'a', posX: 0, posZ: 0 });
    expect(overlaps(a, [self], 'a')).toBe(false);
    expect(overlaps(a, [self], 'b')).toBe(true);
  });

  it('compares ids as strings', () => {
    const self = stall({ id: 7, posX: 0, posZ: 0 });
    expect(overlaps(a, [self], '7')).toBe(false);
  });
});

describe('normalizeStall', () => {
  it('applies every default', () => {
    const result = normalizeStall({}, 'hall-1', 'Shop 3');

    expect(result.hallId).toBe('hall-1');
    expect(result.name).toBe('Shop 3');
    expect(result.width).toBe(5);
    expect(result.length).toBe(5);
    expect(result.height).toBe(4);
    expect(result.posX).toBe(0);
    expect(result.posZ).toBe(0);
    expect(result.color).toBe('#3498db');
    expect(result.gateSide).toBe('FRONT');
    expect(String(result.id)).toContain('stall-');
  });

  it('prefers name, then stallName, then the fallback', () => {
    expect(normalizeStall({ name: 'A', stallName: 'B' }, 1).name).toBe('A');
    expect(normalizeStall({ stallName: 'B' }, 1).name).toBe('B');
    expect(normalizeStall({ name: '   ' }, 1, 'Fallback').name).toBe('Fallback');
  });

  it('keeps a supplied id and coerces numeric strings', () => {
    const result = normalizeStall({ id: 12, posX: '-4', gateSide: 'left' }, 1);
    expect(result.id).toBe(12);
    expect(result.posX).toBe(-4);
    expect(result.gateSide).toBe('LEFT');
    expect(result.openSides).toEqual(['LEFT']);
  });

  it('prefers openSides over gateSide and keeps gateSide synced to the first', () => {
    const result = normalizeStall({ openSides: ['right', 'FRONT', 'right'], gateSide: 'BACK' }, 1);

    expect(result.openSides).toEqual(['RIGHT', 'FRONT']);
    expect(result.gateSide).toBe('RIGHT');
  });

  it('falls back to gateSide when openSides is missing or empty', () => {
    expect(normalizeStall({ gateSide: 'back' }, 1).openSides).toEqual(['BACK']);
    expect(normalizeStall({ openSides: [], gateSide: 'left' }, 1).openSides).toEqual(['LEFT']);
    expect(normalizeStall({}, 1).openSides).toEqual(['FRONT']);
  });
});

describe('normalizeOpenSides', () => {
  it('accepts an array and keeps order', () => {
    expect(normalizeOpenSides(['FRONT', 'RIGHT'], 'BACK')).toEqual(['FRONT', 'RIGHT']);
  });

  it('accepts a single value and wraps it', () => {
    expect(normalizeOpenSides('left', 'FRONT')).toEqual(['LEFT']);
  });

  it('is case-insensitive and dedupes', () => {
    expect(normalizeOpenSides(['front', 'FRONT', 'Back'], 'RIGHT')).toEqual(['FRONT', 'BACK']);
  });

  it('drops invalid entries', () => {
    expect(normalizeOpenSides(['UP', 'right', '', null], 'FRONT')).toEqual(['RIGHT']);
  });

  it('falls back when nothing valid remains', () => {
    expect(normalizeOpenSides(['UP'], 'back')).toEqual(['BACK']);
    expect(normalizeOpenSides(null, 'left')).toEqual(['LEFT']);
    expect(normalizeOpenSides(undefined, undefined)).toEqual(['FRONT']);
  });

  it('allows all four sides', () => {
    expect(normalizeOpenSides(['FRONT', 'BACK', 'LEFT', 'RIGHT'], 'FRONT')).toEqual([
      'FRONT', 'BACK', 'LEFT', 'RIGHT'
    ]);
  });
});

describe('overlapsBlockedArea', () => {
  const candidate = stall({ posX: 0, posZ: 0, width: 8, length: 8 });

  function area(overrides: Partial<BlockedArea> = {}): BlockedArea {
    return {
      posX: 0,
      posZ: 0,
      width: 8,
      length: 8,
      kind: 'outside',
      color: '#ffffff',
      ...overrides
    };
  }

  it('blocks on an "outside" area', () => {
    expect(overlapsBlockedArea(candidate, [area({ kind: 'outside' })])).toBe(true);
  });

  it('blocks on a "wall" area', () => {
    expect(overlapsBlockedArea(candidate, [area({ kind: 'wall' })])).toBe(true);
  });

  it('ignores a "zone" area (does not block)', () => {
    expect(overlapsBlockedArea(candidate, [area({ kind: 'zone' })])).toBe(false);
  });

  it('blocks on a hidden wall (hiding is display only)', () => {
    expect(overlapsBlockedArea(candidate, [area({ kind: 'wall', hidden: true })])).toBe(true);
  });

  it('edge-touching is allowed (1e-8 epsilon)', () => {
    // Candidate is 8 wide centred at 0, so its right edge is at x=4.
    // Area is 8 wide centred at 8, so its left edge is at x=4. Edge-touching only.
    expect(overlapsBlockedArea(candidate, [area({ posX: 8 })])).toBe(false);
  });

  it('detects a real overlap (not just edge-touching)', () => {
    expect(overlapsBlockedArea(candidate, [area({ posX: 7 })])).toBe(true);
  });

  it('needs overlap on both axes', () => {
    expect(overlapsBlockedArea(candidate, [area({ posX: 7, posZ: 20 })])).toBe(false);
  });

  it('returns false when areas is null', () => {
    expect(overlapsBlockedArea(candidate, null)).toBe(false);
  });

  it('returns false when areas is undefined', () => {
    expect(overlapsBlockedArea(candidate, undefined)).toBe(false);
  });

  it('returns false when areas is empty', () => {
    expect(overlapsBlockedArea(candidate, [])).toBe(false);
  });

  it('blocks when at least one outside/wall area overlaps among many', () => {
    expect(overlapsBlockedArea(candidate, [
      area({ kind: 'zone', posX: 0 }),       // zone, ignored
      area({ kind: 'outside', posX: 50 }),    // outside but far away
      area({ kind: 'wall', posX: 3 })         // wall, overlaps
    ])).toBe(true);
  });
});
