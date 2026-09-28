import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../../core/api-base.token';
import { NotifyService } from '../../core/notify.service';
import type { Hall } from '../models/hall.model';
import { PlannerStore } from '../planner-store.service';
import type { PdfGroup, PdfImportResult, PdfStall } from './pdf-import.model';
import {
  autoFit,
  cellCentres,
  centredAlignment,
  checkRules,
  FloorMask,
  frameOffsets,
  importHall,
  matchGroups,
  placeOutline,
  toPlannerStall,
  turn,
} from './pdf-import-plan';

const group = (id: string, originX: number, originY: number, usesHalfMetres = false): PdfGroup => ({
  group: id,
  pitchX: 5,
  pitchY: 5,
  originX,
  originY,
  rms: 0.01,
  gridLines: 40,
  dimensionChecks: 0,
  dimensionMaxError: null,
  usesHalfMetres,
});

let n = 0;
const stall = (grp: string, outline: Array<[number, number]>, openEdges: number[], extra: Partial<PdfStall> = {}): PdfStall => ({
  key: `s${++n}`,
  group: grp,
  blockId: `${grp}-01`,
  letter: 'A',
  name: `${grp}-01 ${n}`,
  outline: outline.map(([x, z]) => ({ x, z })),
  openEdges,
  area: 12,
  shape: outline.length === 4 ? 'rectangle' : 'L-shape',
  category: 'standard',
  labels: { area: null, dims: null, texts: [] },
  confidence: 'high',
  issues: [],
  include: true,
  outlinePt: [],
  ...extra,
});

/** A 4 x 3 m rectangle at (x, z), open at the bottom (edge 2 of the clockwise outline). */
const box = (grp: string, x: number, z: number, w = 4, l = 3) =>
  stall(grp, [[x, z], [x + w, z], [x + w, z + l], [x, z + l]], [2]);

/** The L-shaped stall "H" (30 m²): 7 x 3 m arm on top, 3 x 3 m arm down the right, open on the notch. */
const L_SHAPE: Array<[number, number]> = [[0, 0], [7, 0], [7, 6], [4, 6], [4, 3], [0, 3]];

function result(stalls: PdfStall[], groups: PdfGroup[]): PdfImportResult {
  return { page: { width: 1000, height: 800, rotation: 0 }, layers: [], usedLayers: true, groups, stalls, excluded: [], unresolved: [], issues: [] };
}

const plainHall = (width: number, length: number, rules: Hall['rules'] = { snapStep: 1 }): Hall => ({
  id: 7,
  name: 'Hall 8-9-10',
  shape: 'SQUARE',
  width,
  length,
  radius: 0,
  rules,
});

describe('PDF import plan', () => {
  it('matches the drawing halls to a planner hall by the numbers in its name', () => {
    const groups = [group('11', 0, 0), group('10', 0, 0), group('9', 0, 0), group('8', 0, 0)];
    expect(matchGroups('Hall 8-9-10', groups)).toEqual(['10', '9', '8']);
    expect(matchGroups('Hall 12', groups)).toEqual([]);
    expect(matchGroups('Hall 08', groups)).toEqual(['8']);
  });

  it('keeps the drawing halls where the page has them, on the half-metre grid', () => {
    const r = result([], [group('10', 100, 50), group('9', 162.6, 40)]);
    // (162.6 - 100) / 5 = 12.52 m -> 12.5 m; (40 - 50) / 5 = -2 m.
    expect(frameOffsets(r, ['10', '9'])).toEqual({ '10': { x: 0, z: 0 }, '9': { x: 12.5, z: -2 } });
  });

  it('turns clockwise on the plan in quarter turns', () => {
    expect(turn({ x: 1, z: 0 }, 90)).toEqual({ x: -0, z: 1 });
    expect(turn({ x: 1, z: 0 }, 180)).toEqual({ x: -1, z: -0 });
    expect(turn({ x: 1, z: 0 }, 270)).toEqual({ x: 0, z: -1 });
  });

  it('turns an L-shaped stall into ONE custom planner stall with its exact outline and open edges', () => {
    const l = stall('11', L_SHAPE, [3, 4], { area: 30 });
    const s = toPlannerStall(l, placeOutline(l, { rotation: 0, offsets: { '11': { x: 10, z: 20 } } }), 'h1')!;
    expect(s.footprint?.length).toBe(6);
    expect([s.width, s.length]).toEqual([7, 6]);
    // Bounding-box centre: (10 + 3.5, 20 + 3).
    expect([s.posX, s.posZ]).toEqual([13.5, 23]);
    // Open edges are the notch edges, (4,6)->(4,3) and (4,3)->(0,3), in canonical numbering.
    const open = s.openEdges!.map(i => [s.footprint![i], s.footprint![(i + 1) % 6]]);
    expect(open).toEqual([
      [{ x: 0.5, z: 3 }, { x: 0.5, z: 0 }],
      [{ x: 0.5, z: 0 }, { x: -3.5, z: 0 }],
    ]);
    expect(String(s.id)).toBe(`h1:${l.key}`);
  });

  it('turns a rectangle into a plain stall with its open side', () => {
    const b = box('9', 0, 0);
    const s = toPlannerStall(b, placeOutline(b, { rotation: 0, offsets: { '9': { x: 0, z: 0 } } }), 'h1')!;
    expect(s.footprint).toBeUndefined();
    expect([s.width, s.length, s.posX, s.posZ]).toEqual([4, 3, 2, 1.5]);
    expect(s.openSides).toEqual(['FRONT']);
    // Turned a quarter clockwise, the bottom opening faces left.
    const t = toPlannerStall(b, placeOutline(b, { rotation: 90, offsets: { '9': { x: 0, z: 0 } } }), 'h1')!;
    expect([t.width, t.length]).toEqual([3, 4]);
    expect(t.openSides).toEqual(['LEFT']);
  });

  it('auto-fits the drawing onto the free floor, turning it when the hall runs the other way', () => {
    // 16 m of stalls in a row; the hall is 10 m wide and 30 m long: only a quarter turn fits.
    const stalls = [0, 4, 8, 12].map(x => box('10', x, 0));
    const r = result(stalls, [group('10', 0, 0)]);
    const hall = plainHall(10, 30);
    const fit = autoFit(r, ['10'], hall);
    expect([90, 270]).toContain(fit.alignment.rotation);
    expect(fit.total).toBe(4);
    const mask = FloorMask.forHall(hall);
    for (const s of stalls) expect(cellCentres(placeOutline(s, fit.alignment)).every(p => mask.free(p))).toBe(true);
  });

  it('keeps the drawing layout when everything fits as drawn', () => {
    const r = result([box('10', 0, 0), box('9', 0, 0)], [group('10', 0, 0), group('9', 50, 0)]);
    const hall = plainHall(60, 20);
    const a = centredAlignment(r, ['10', '9'], hall);
    // Hall 9 is 10 m (50 pt) right of hall 10 on the page, and stays so.
    expect(a.offsets['9'].x - a.offsets['10'].x).toBe(10);
    expect(a.offsets['9'].z).toBe(a.offsets['10'].z);
  });

  it('imports into a copy of the hall: same rules, only a 0.5 m size step when the drawing needs it', () => {
    const master = plainHall(40, 40, { snapStep: 1, peripheralClearance: 2 });
    const snapshot = JSON.stringify(master);
    const r = result([box('10', 0, 0)], [group('10', 0, 0, true)]);
    const copy = importHall(master, r, ['10'], 123);
    expect(copy.id).toBe('pdf-hall-123');
    expect(copy.name).toBe('Hall 8-9-10 (PDF import)');
    expect(copy.rules).toEqual({ snapStep: 0.5, peripheralClearance: 2 });
    expect(JSON.stringify(master)).toBe(snapshot);
    const whole = importHall(master, result([box('10', 0, 0)], [group('10', 0, 0)]), ['10'], 123);
    expect(whole.rules).toEqual(master.rules);
  });

  it('sizes a new hall to the drawing with room to spare', () => {
    const r = result([box('11', 0, 0), box('11', 20, 10)], [group('11', 0, 0)]);
    const hall = importHall(null, r, ['11'], 5);
    expect([hall.name, hall.width, hall.length]).toEqual(['Hall 11 (PDF import)', 28, 17]);
  });

  it('reports planner-rule conflicts and finds a subset that passes together', () => {
    const hall = plainHall(40, 40, { snapStep: 1, peripheralClearance: 1 });
    // Two stalls side by side, both open at the front: touching, not back-to-back.
    const a = box('10', 10, 10);
    const b = box('10', 14, 10);
    // A third one far away.
    const c = box('10', 25, 25);
    const align = { rotation: 0 as const, offsets: { '10': { x: -20, z: -20 } } };
    const stalls = [a, b, c].map(s => toPlannerStall(s, placeOutline(s, align), hall.id)!);
    const check = checkRules(hall, stalls, 'B2B');
    expect(check.violations.get(String(stalls[0].id))!.length).toBeGreaterThan(0);
    expect(check.violations.get(String(stalls[2].id))).toEqual([]);
    expect(check.compliant).toEqual([String(stalls[0].id), String(stalls[2].id)]);
    expect(Object.keys(check.codes).length).toBeGreaterThan(0);
  });

  describe('confirming into the planner', () => {
    let store: PlannerStore;
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: API_BASE_URL, useValue: 'http://test.local/api' },
          { provide: NotifyService, useValue: jasmine.createSpyObj('NotifyService', ['success', 'confirm', 'showLoading', 'hideLoading']) },
          PlannerStore,
        ],
      });
      store = TestBed.inject(PlannerStore);
    });

    it('opens a new unsaved layout on the working hall and leaves the other halls alone', () => {
      const master = store.halls()[0];
      const before = store.stalls().length;
      const r = result([stall('11', L_SHAPE, [3, 4], { area: 30 }), box('11', 10, 0)], [group('11', 0, 0)]);
      const hall = importHall(master, r, ['11'], 99);
      const align = centredAlignment(r, ['11'], hall);
      const stalls = r.stalls.map(s => toPlannerStall(s, placeOutline(s, align), hall.id)!);
      store.applyPdfImport(hall, stalls, 'Hall · plan');
      expect(store.currentHall()?.id).toBe('pdf-hall-99');
      expect(store.currentStalls().length).toBe(2);
      expect(store.currentStalls().some(s => s.footprint?.length === 6)).toBe(true);
      expect(store.selectedSavedId()).toBeNull();
      expect(store.layoutName()).toBe('Hall · plan');
      expect(store.halls().find(h => h.id === master.id)).toEqual(master);
      expect(store.stalls().length).toBe(before + 2);
    });
  });
});
