import type { PlanStall } from '../../../core/plans/plans.models';
import type { HallFloor } from '../../../core/api/api.models';
import { overlaps, plannerFloor, rectRing } from './planner-geometry';
import {
  boothsOf,
  defaultBrief,
  numberPlaces,
  PlanBrief,
  planOptions,
  PlanSetting,
} from './planner-plan';

function setting(width: number, depth: number, patch: Partial<PlanSetting> = {}): PlanSetting {
  const hallFloor: HallFloor = {
    schema: 'floor/1',
    width,
    depth,
    areas: [],
    labels: [],
    iconGroups: [],
    north: null,
    legend: [],
  };
  return {
    floor: plannerFloor(hallFloor),
    hallFloor,
    region: rectRing({ x: 0, y: 0, width, height: depth }),
    stalls: [],
    seats: [],
    zones: [],
    categories: [],
    rules: {
      on: () => true,
      passage: 3,
      wallClearance: 1,
      emergencyExitClearance: 3,
      curtainClearance: 1,
      facilityClearance: 1,
      maxUtilization: 0.7,
    },
    ...patch,
  };
}

function brief(s: PlanSetting, patch: Partial<PlanBrief> = {}): PlanBrief {
  return { ...defaultBrief(s), ...patch };
}

describe('planning a hall', () => {
  it('offers up to three different layouts, the most booths first, all inside the walls', () => {
    const s = setting(60, 40);
    const options = planOptions(brief(s), s);
    expect(options.length).toBeGreaterThan(1);
    expect(options.length).toBeLessThanOrEqual(3);
    const ok = options.filter((o) => !o.overLimit);
    expect(ok.map((o) => o.booths)).toEqual([...ok.map((o) => o.booths)].sort((a, b) => b - a));
    expect(new Set(options.map((o) => `${o.booths}|${o.key.split('-')[0]}`)).size).toBe(
      options.length,
    );
    for (const o of options) {
      for (const [i, p] of o.places.entries()) {
        // One grid square (and the wall rule's metre) from every wall.
        expect(p.x).toBeGreaterThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(1);
        expect(p.x + p.width).toBeLessThanOrEqual(59);
        expect(p.y + p.height).toBeLessThanOrEqual(39);
        expect(p.openSides.length).toBeGreaterThan(0);
        for (const q of o.places.slice(i + 1)) expect(overlaps(p, q)).toBeFalse();
      }
    }
  });

  it('lays rows down a deep hall too, inside its walls', () => {
    const s = setting(24, 60);
    const options = planOptions(brief(s, { wallLines: 'no' }), s);
    const down = options.find((o) => o.key.startsWith('down'));
    expect(down).toBeDefined();
    for (const p of down!.places) {
      expect(p.x).toBeGreaterThanOrEqual(1);
      expect(p.x + p.width).toBeLessThanOrEqual(23);
      expect(p.y + p.height).toBeLessThanOrEqual(59);
    }
  });

  it('keeps to the count asked for, and offers nothing when no booth fits', () => {
    const s = setting(60, 40);
    for (const o of planOptions(brief(s, { count: 12 }), s))
      expect(o.booths).toBeLessThanOrEqual(12);
    expect(planOptions(brief(s, { width: 80, depth: 80 }), s)).toEqual([]);
  });

  it('gives the corner booths the hall’s corner category, and every booth those asked for', () => {
    const s = setting(60, 40, {
      categories: [
        { id: 'p', name: 'Premium', status: 'active' },
        { id: 'c', name: 'Corner stall', status: 'active' },
      ] as PlanSetting['categories'],
    });
    const b = brief(s, { categoryIds: ['p'] });
    const option = planOptions(b, s)[0];
    const booths = boothsOf(option, b, s);
    expect(booths.length).toBe(option.booths);
    expect(booths.every((x) => x.categoryIds.includes('p'))).toBeTrue();
    const corners = booths.filter((x) => x.categoryIds.includes('c'));
    expect(corners.length).toBe(option.corners);
    expect(corners.length).toBeGreaterThan(0);
  });

  it('numbers by line, by island, or in order after the numbers already used', () => {
    const places = [
      { x: 0, y: 0, width: 3, height: 3, line: 0, island: 0 },
      { x: 3, y: 0, width: 3, height: 3, line: 0, island: 0 },
      { x: 0, y: 3, width: 3, height: 3, line: 1, island: 0 },
    ];
    const used = [{ islandNumber: 'H-A', stallNumber: '1' } as PlanStall];
    expect(numberPlaces(places, used, 'line', 'H-', '')).toEqual([
      { island: 'H-B', stall: '1' },
      { island: 'H-B', stall: '2' },
      { island: 'H-C', stall: '1' },
    ]);
    expect(numberPlaces(places, [], 'island', '', '').map((n) => n.island)).toEqual([
      '1-',
      '1-',
      '1-',
    ]);
    expect(numberPlaces(places, [], 'island', '', '').map((n) => n.stall)).toEqual(['A', 'B', 'C']);
    expect(
      numberPlaces(
        places,
        [{ islandNumber: null, stallNumber: '4' } as PlanStall],
        'numbers',
        '',
        '',
      ),
    ).toEqual([
      { island: null, stall: '5' },
      { island: null, stall: '6' },
      { island: null, stall: '7' },
    ]);
  });
});
