import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../../core/api-base.token';
import { NotifyService } from '../../core/notify.service';
import { buildApiPayload } from '../layout-api.service';
import { PlannerStore } from '../planner-store.service';
import { stallArea, interiorPoint } from './footprint-view';
import { normalizeStall } from './planner-geometry';
import { DEFAULT_LAYOUT_RULES, PlacementContext, PlacementStall, validatePlacement } from './placement-rules';
import { stallPolygon } from './polygon-geometry';
import { polygonArea } from './stall-footprint';

/*
 * The 30 m² L-shaped stall "H" of block 11-13/11-14 (IITF 2026, Hall 8-11): a 7 x 3 m arm along
 * the top and a 3 x 3 m arm down the right. Local metres, X right, Z down; notch bottom-left.
 */
const L = [
  { x: 0, z: 0 },
  { x: 7, z: 0 },
  { x: 7, z: 6 },
  { x: 4, z: 6 },
  { x: 4, z: 3 },
  { x: 0, z: 3 }
];

const HALL = [
  { x: -20, z: -20 },
  { x: 20, z: -20 },
  { x: 20, z: 20 },
  { x: -20, z: 20 }
];

function ctx(stalls: PlacementStall[]): PlacementContext {
  return {
    boundary: HALL,
    zones: [],
    openings: [],
    rules: { ...DEFAULT_LAYOUT_RULES, peripheralClearance: 0, minPassageWidth: { B2B: 3, B2C: 3 } },
    eventType: 'B2B',
    stalls
  };
}

describe('custom (L-shaped) stalls', () => {
  const loaded = normalizeStall({ name: '11-14 H', width: 7, length: 6, posX: -10, posZ: -10, footprint: L, openEdges: [3, 4] }, 'h');

  it('loads as ONE stall with its real outline, bounding box and open edges', () => {
    expect(loaded.footprint!.length).toBe(6);
    expect([loaded.width, loaded.length]).toEqual([7, 6]);
    // The outline was given from its corner at (-10, -10): the position is its box centre.
    expect([loaded.posX, loaded.posZ]).toEqual([-6.5, -7]);
    expect(loaded.openEdges).toEqual([3, 4]);
    expect(loaded.openSides).toEqual(['LEFT', 'FRONT']);
    expect(stallArea(loaded)).toBe(30);
  });

  it('keeps the notch empty: collisions use the outline, not the bounding box', () => {
    const l: PlacementStall = { ...loaded, id: 'L' };
    const onArm: PlacementStall = { id: 'a', posX: -4, posZ: -9, width: 1, length: 1, openSides: ['BACK'] };
    const inNotch: PlacementStall = { id: 'n', posX: -9.5, posZ: -5.5, width: 1, length: 1, openSides: ['FRONT'] };
    expect(validatePlacement(onArm, ctx([l, onArm]), 'a').violations.map(v => v.code)).toContain('STALL_OVERLAP');
    expect(validatePlacement(inNotch, ctx([l, inNotch]), 'n').violations.map(v => v.code)).not.toContain('STALL_OVERLAP');
  });

  it('is valid alone and still an L of 30 m² after a 90 degree rotation', () => {
    const l: PlacementStall = { ...loaded, id: 'L' };
    expect(validatePlacement(l, ctx([l]), 'L').valid).toBeTrue();
    const turned = stallPolygon({ ...l, rotation: 90 });
    expect(turned.length).toBe(6);
    expect(polygonArea(turned)).toBeCloseTo(30, 9);
  });

  it('labels it inside the arms, never in the notch', () => {
    const p = interiorPoint(loaded.footprint!);
    // Notch (local, centred): x -3.5..0.5, z 0..3.
    expect(p.x > -3.5 && p.x < 0.5 && p.z > 0 && p.z < 3).toBeFalse();
  });

  it('sends its outline on save and nothing extra for rectangles', () => {
    const rect = normalizeStall({ name: 'R', width: 3, length: 4 }, 'h');
    const payload = buildApiPayload(
      { id: 'h', name: 'Hall', shape: 'SQUARE', width: 40, length: 40, radius: 0 },
      [loaded, rect],
      'x'
    );
    expect(payload.stalls[0].footprint).toEqual(loaded.footprint!);
    expect(payload.stalls[0].openEdges).toEqual([3, 4]);
    expect('footprint' in payload.stalls[1]).toBeFalse();
  });

  describe('in the store', () => {
    let store: PlannerStore;
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: API_BASE_URL, useValue: 'http://test.local/api' },
          { provide: NotifyService, useValue: jasmine.createSpyObj('NotifyService', ['success', 'confirm', 'showLoading', 'hideLoading']) },
          PlannerStore
        ]
      });
      store = TestBed.inject(PlannerStore);
      store.stalls.set([{ ...loaded, id: 'L', hallId: store.activeHallId(), posX: 0, posZ: 0 }]);
    });

    it('turns the whole L a quarter, as one stall, open edges with it', () => {
      store.rotateStall('L');
      const s = store.currentStalls()[0];
      expect(store.currentStalls().length).toBe(1);
      expect([s.width, s.length]).toEqual([6, 7]);
      expect(s.footprint!.length).toBe(6);
      expect(stallArea(s)).toBe(30);
      // The notch edges faced left and front; a clockwise quarter turn makes them back and left.
      expect(s.openSides).toEqual(['BACK', 'LEFT']);
    });

    it('moves the L without changing its shape', () => {
      store.moveStall('L', 3, 2);
      const s = store.currentStalls()[0];
      expect(s.footprint).toEqual(loaded.footprint!);
      expect(stallArea(s)).toBe(30);
    });

    it('toggles open edges but never closes the last one', () => {
      store.toggleOpenEdge('L', 0);
      expect(store.currentStalls()[0].openEdges).toEqual([0, 3, 4]);
      store.toggleOpenEdge('L', 0);
      store.toggleOpenEdge('L', 3);
      store.toggleOpenEdge('L', 4);
      expect(store.currentStalls()[0].openEdges).toEqual([4]);
    });

    it('refuses to split or duplicate it', () => {
      store.selectedStallId.set('L');
      store.previewStallSplit({ count: 2, axis: 'X', arrangement: 'PASSAGE' });
      expect(store.splitPreview()?.error).toContain('cannot be split');
      store.duplicateStall('L');
      expect(store.currentStalls().length).toBe(1);
    });
  });
});
