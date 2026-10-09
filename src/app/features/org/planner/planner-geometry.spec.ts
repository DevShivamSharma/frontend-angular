import type { PlanStall } from '../../../core/plans/plans.models';
import {
  fillBooths,
  fillSeats,
  letterIndex,
  letters,
  plannerFloor,
  rectRing,
  stallNumbers,
} from './planner-geometry';

const floor = plannerFloor({
  schema: 'floor/1',
  width: 20,
  depth: 10,
  areas: [{ kind: 'column', x: 9.5, y: 4.5, width: 1, height: 1 }],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
});
const hall = rectRing({ x: 0, y: 0, width: 20, height: 10 });

function stall(stallNumber: string, islandNumber: string | null = null): PlanStall {
  return { stallNumber, islandNumber } as PlanStall;
}

describe('planner geometry', () => {
  it('counts rows A to Z, then AA', () => {
    expect([letters(0), letters(25), letters(26), letters(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
    expect(letterIndex('AB')).toBe(27);
  });

  it('numbers stalls after the highest used under the same island, skipping taken', () => {
    const stalls = [stall('1'), stall('2'), stall('5', 'B-'), stall('A', 'C-')];
    expect(stallNumbers(stalls, null, 'numbers', 2, '')).toEqual(['3', '4']);
    expect(stallNumbers(stalls, 'B-', 'numbers', 2, '4')).toEqual(['4', '6']);
    expect(stallNumbers(stalls, 'C-', 'letters', 2, '')).toEqual(['B', 'C']);
  });

  it('fills booths on a grid, skipping the pillar unless asked to sell it', () => {
    const fill = {
      region: hall,
      width: 3,
      depth: 3,
      aisle: 2,
      margin: 0,
      count: null,
      pillarClearance: 0,
      shiftForPillars: false,
      sellPillarStands: false,
    };
    const without = fillBooths(fill, floor, [], []);
    const all = fillBooths({ ...fill, sellPillarStands: true }, floor, [], []);
    expect(all.length).toBe(8);
    expect(without.length).toBe(7);
    expect(fillBooths({ ...fill, count: 3 }, floor, [], []).length).toBe(3);
  });

  it('fills seats in rows from the front, with aisles, around the pillar', () => {
    const seats = fillSeats(
      {
        region: hall,
        width: 0.5,
        depth: 0.5,
        gap: 0.1,
        rowGap: 0.9,
        aisleEvery: 10,
        aisleWidth: 1.2,
        front: 'bottom',
        most: 5000,
        clearance: 0.3,
      },
      floor,
      [],
      [],
    );
    expect(seats.length).toBeGreaterThan(100);
    // Row A is at the bottom.
    const rowA = seats.filter((s) => s.row === 0);
    expect(Math.min(...seats.map((s) => s.y))).toBeLessThan(rowA[0].y);
    // Nothing on or near the pillar.
    expect(
      seats.some((s) => s.x < 10.8 && s.x + s.width > 9.2 && s.y < 5.8 && s.y + s.height > 4.2),
    ).toBeFalse();
  });
});
