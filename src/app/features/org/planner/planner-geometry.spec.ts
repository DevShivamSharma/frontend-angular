import type { PlanStall } from '../../../core/plans/plans.models';
import {
  fillBooths,
  fillRows,
  fillSeats,
  keepClearOf,
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

  describe('rows, as a hall is cut', () => {
    const open = plannerFloor({
      schema: 'floor/1',
      width: 40,
      depth: 30,
      areas: [],
      labels: [],
      iconGroups: [],
      north: null,
      legend: [],
    });
    const rows = {
      region: rectRing({ x: 0, y: 0, width: 40, height: 30 }),
      width: 3,
      depth: 3,
      aisle: 3,
      margin: 1,
      crossEvery: 10,
      count: null,
      pillarClearance: 0.5,
      shiftForPillars: false,
      sellPillarStands: false,
      corners: true,
      keepClear: [],
      cornerClear: 0,
      wallLines: false,
      grid: 1,
    };

    it('starts a grid square in from the walls, on the grid, with what is left shared out', () => {
      const places = fillRows(rows, open, [], []);
      expect(places.length).toBe(66);
      expect(Math.min(...places.map((p) => p.x))).toBe(2);
      expect(Math.min(...places.map((p) => p.y))).toBe(1);
      expect(places.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBeTrue();
      expect(Math.max(...places.map((p) => p.x + p.width))).toBeLessThanOrEqual(39);
    });

    it('puts lines back to back, each opening onto an aisle', () => {
      const places = fillRows(rows, open, [], []);
      const sideOf = (line: number) => places.find((p) => p.line === line && !p.corner)!.openSides;
      expect([0, 1, 2, 3, 4, 5].map(sideOf)).toEqual([
        ['bottom'],
        ['top'],
        ['bottom'],
        ['top'],
        ['bottom'],
        ['top'],
      ]);
      // Lines 1 and 2 are one island, back to back; an aisle lies between the islands.
      const yOf = (line: number) => places.find((p) => p.line === line)!.y;
      expect(yOf(2) - yOf(1)).toBe(3);
      expect(yOf(1) - (yOf(0) + 3)).toBe(3);
    });

    it('breaks lines with a cross-aisle, and opens the ends onto it', () => {
      const line = fillRows(rows, open, [], []).filter((p) => p.line === 0);
      expect(line[10].x - (line[9].x + 3)).toBe(3);
      expect(line[9].openSides).toEqual(['bottom', 'right']);
      expect(line[10].openSides).toEqual(['bottom', 'left']);
      // Next to the wall there is no aisle to open onto.
      expect(line[0].openSides).toEqual(['bottom']);
      expect(line.filter((p) => p.corner).length).toBe(2);
    });

    it('leaves the corners of the hall open when the corner rule asks', () => {
      const places = fillRows({ ...rows, cornerClear: 3 }, open, [], []);
      // The top and bottom lines run close to the walls: their end booths would close corners.
      expect(places.length).toBe(62);
      const top = places.filter((p) => p.line === 0);
      expect(top[0].x).toBeGreaterThanOrEqual(3);
      expect(40 - (top[top.length - 1].x + 3)).toBeGreaterThanOrEqual(3);
    });

    it('puts a line along each side wall, facing in, and starts the rows past its aisle', () => {
      const places = fillRows({ ...rows, wallLines: true, cornerClear: 3 }, open, [], []);
      const sides = places.filter((p) => p.line >= 6);
      const leftWall = sides.filter((p) => p.x === 1);
      const rightWall = sides.filter((p) => p.x === 36);
      expect(leftWall.length).toBeGreaterThan(0);
      expect(rightWall.length).toBe(leftWall.length);
      // Turned to face in: three deep from the wall, three along it.
      expect(leftWall.every((p) => p.width === 3 && p.openSides[0] === 'right')).toBeTrue();
      expect(rightWall.every((p) => p.openSides[0] === 'left')).toBeTrue();
      // Clear of the corners, and the rows inside past an aisle from the side lines.
      expect(Math.min(...leftWall.map((p) => p.y))).toBeGreaterThanOrEqual(3);
      const inside = places.filter((p) => p.line < 6);
      expect(Math.min(...inside.map((p) => p.x))).toBeGreaterThanOrEqual(1 + 3 + 3);
      // Their ends open onto that aisle, so nothing faces the back of a booth.
      const firstOfLine = inside.filter((p) => p.place === 0 && p.line > 0);
      expect(firstOfLine.every((p) => p.openSides.includes('left'))).toBeTrue();
    });

    it('keeps clear of an emergency exit by the rules', () => {
      const withExit = {
        schema: 'floor/1' as const,
        width: 40,
        depth: 30,
        areas: [],
        labels: [],
        iconGroups: [{ x: 20, y: 2, icons: [{ kind: 'emergency-exit', label: 'Exit' }] }],
        north: null,
        legend: [],
      };
      const keepClear = keepClearOf(
        withExit,
        { emergencyExitClearance: 3, curtainClearance: 1, facilityClearance: 1 },
        () => true,
      );
      const places = fillRows({ ...rows, keepClear }, plannerFloor(withExit), [], []);
      expect(places.some((p) => p.x < 23 && p.x + 3 > 17 && p.y < 5)).toBeFalse();
      expect(places.length).toBeLessThan(66);
    });
  });
});
