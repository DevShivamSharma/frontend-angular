import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../core/api-base.token';
import { NotifyService } from '../core/notify.service';
import { PlannerStore } from './planner-store.service';

const API = 'http://test.local/api';

/** Lets the store's awaited HTTP promise settle. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve));

describe('PlannerStore', () => {
  let store: PlannerStore;
  let notify: jasmine.SpyObj<NotifyService>;

  beforeEach(() => {
    // The real service opens SweetAlert2 popups; specs only care that it was asked to.
    notify = jasmine.createSpyObj<NotifyService>('NotifyService', [
      'success',
      'confirm',
      'showLoading',
      'hideLoading'
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
        { provide: NotifyService, useValue: notify },
        PlannerStore
      ]
    });

    store = TestBed.inject(PlannerStore);
  });

  it('starts on the imported SelfCare Hall 8-9-10, with the blank hall behind it', () => {
    // Real halls arrive from GET /api/halls; this is what shows before that answers. Hall
    // 8-9-10 comes from the checked-in SelfCare response, so the plan is never blank on open.
    expect(store.halls().map(h => h.name)).toEqual(['Hall 8-9-10', 'Sample Hall (offline)']);
    expect(store.currentHall()?.name).toBe('Hall 8-9-10');
    expect(store.currentHall()?.width).toBe(133);
    expect(store.currentHall()?.length).toBe(43);
    expect(store.currentStalls()).toEqual([]);
  });

  it('carries the SelfCare amenities, markers and compass onto the starting hall', () => {
    const hall = store.currentHall()!;

    expect(hall.amenities?.map(a => a.kind)).toEqual([
      'toilet-male',
      'toilet-female',
      'stairs',
      'toilet-male',
      'toilet-female',
      'stairs',
      'entry-up'
    ]);
    expect(hall.markers?.map(m => m.text)).toContain('HALL 10');
    expect(hall.compass?.label).toBe('N');
    // The official plan marks no compulsory passage for this hall, so the planner draws none.
    expect(hall.zones).toEqual([]);
  });

  describe('loadHalls', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    it('replaces the fallback with the real halls and selects the first', async () => {
      const promise = store.loadHalls();
      http.expectOne({ url: `${API}/halls?standalone=true`, method: 'GET' }).flush([
        { id: 1014, name: 'Hall 1GF', shape: 'SQUARE', width: 84, length: 116, radius: 0 },
        { id: 1016, name: 'Hall 12', shape: 'SQUARE', width: 58, length: 41, radius: 0 }
      ]);
      await promise;

      expect(store.halls().length).toBe(2);
      expect(store.activeHallId()).toBe(1014);
      expect(store.currentHall()?.name).toBe('Hall 1GF');
      expect(store.hallsStatus()).toBe('ready');
    });

    it('keeps the fallback when the backend is unreachable', async () => {
      const promise = store.loadHalls();
      expect(store.hallsStatus()).toBe('loading');
      http.expectOne(`${API}/halls?standalone=true`).error(new ProgressEvent('network error'));
      await promise;

      expect(store.currentHall()?.name).toBe('Hall 8-9-10');
      expect(store.hallsStatus()).toBe('unavailable');
    });

    it('keeps the fallback when the backend returns no halls', async () => {
      const promise = store.loadHalls();
      http.expectOne(`${API}/halls?standalone=true`).flush([]);
      await promise;

      expect(store.halls().length).toBe(2);
      expect(store.currentHall()?.name).toBe('Hall 8-9-10');
      expect(store.hallsStatus()).toBe('empty');
    });

    it('keeps a hall the user switched to before the list arrived', async () => {
      const custom = store.createHall({ name: 'My Hall', shape: 'SQUARE', w: 30, l: 20, r: 0 });

      const promise = store.loadHalls();
      http.expectOne(`${API}/halls?standalone=true`).flush([
        { id: 1014, name: 'Hall 1GF', shape: 'SQUARE', width: 84, length: 116, radius: 0 }
      ]);
      await promise;

      expect(store.halls().map(h => h.id)).toEqual([1014, custom.id]);
      expect(store.activeHallId()).toBe(custom.id);
    });
  });

  describe('loadList', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    it('reports a failed request through listStatus and keeps the old list', async () => {
      store.savedLayouts.set([{ id: 1000 } as never]);

      const promise = store.loadList();
      expect(store.listStatus()).toBe('loading');
      http.expectOne(`${API}/layouts`).error(new ProgressEvent('network error'));
      await promise;

      expect(store.listStatus()).toBe('error');
      expect(store.savedLayouts().length).toBe(1);
    });
  });

  describe('dismissError', () => {
    it('clears the error before its timeout', () => {
      store.showError('boom');
      store.dismissError();

      expect(store.error()).toBe('');
    });
  });

  /**
   * The placement specs below measure against a 40 x 40 hall. The planner now opens on the
   * imported SelfCare Hall 8-9-10 (133 x 43), so they select the blank sample hall explicitly
   * rather than relying on whichever hall happens to be first.
   */
  function useSampleHall(): void {
    store.setActiveHall('local-fallback-hall');
  }

  describe('addStall', () => {
    beforeEach(useSampleHall);

    it('places the first shop at the far -X/-Z corner', () => {
      const created = store.addStall({
        name: '',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      });

      expect(created).toBeTruthy();
      // maxX = floor(40/2 - 8/2) = 16, and the scan starts at -maxZ/-maxX.
      expect(created!.posX).toBe(-16);
      expect(created!.posZ).toBe(-16);
      expect(created!.name).toBe('Shop 1');
      expect(store.selectedStallId()).toBe(created!.id);
    });

    it('places the second shop at the next free position on the same row', () => {
      const form = {
        name: '',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT' as const
      };

      store.addStall(form);
      const second = store.addStall(form);

      expect(second!.posZ).toBe(-16);
      expect(second!.posX).toBe(-8);
      expect(second!.name).toBe('Shop 2');
    });

    it('reports an error when nothing fits', () => {
      const created = store.addStall({
        name: '',
        width: 100,
        length: 100,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      });

      expect(created).toBeNull();
      expect(store.error()).toContain('No free grid position');
    });

    it('skips positions that overlap blocked areas', () => {
      // Create a hall where the -16/-16 corner (where the scan starts) is blocked
      store.halls.set([{
        id: 'blocked-hall',
        name: 'Hall With Block',
        shape: 'SQUARE',
        width: 40,
        length: 40,
        radius: 0,
        blockedAreas: [
          { posX: -16, posZ: -16, width: 4, length: 4, kind: 'wall', color: '#742371' }
        ]
      }]);
      store.setActiveHall('blocked-hall');

      const shop = store.addStall({
        name: '',
        width: 2,
        length: 2,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      });

      expect(shop).toBeTruthy();
      // The first-row, first-column position (-19,-19) is valid but the scan would have
      // skipped positions overlapping the blocked area at -16,-16.
      // The stall should NOT be placed at exactly the blocked area's centre.
      const isOnBlockedArea =
        Math.abs(shop!.posX - (-16)) < (shop!.width + 4) / 2 - 1e-8 &&
        Math.abs(shop!.posZ - (-16)) < (shop!.length + 4) / 2 - 1e-8;
      expect(isOnBlockedArea).toBe(false);
    });
  });

  describe('moveStall', () => {
    beforeEach(useSampleHall);

    function addShop() {
      return store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;
    }

    it('snaps to whole units while snap is on', () => {
      const shop = addShop();
      store.moveStall(shop.id, 2.4, -3.6);

      expect(store.selectedStall()!.posX).toBe(2);
      expect(store.selectedStall()!.posZ).toBe(-4);
    });

    it('keeps fractional positions while snap is off', () => {
      const shop = addShop();
      store.setSnap(false);
      store.moveStall(shop.id, 2.4, -3.6);

      expect(store.selectedStall()!.posX).toBe(2.4);
      expect(store.selectedStall()!.posZ).toBe(-3.6);
    });

    it('rejects a move outside the hall and keeps the old position', () => {
      const shop = addShop();
      store.moveStall(shop.id, 100, 0);

      expect(store.selectedStall()!.posX).toBe(-16);
      expect(store.error()).toContain('outside the hall boundary');
    });

    it('rejects a move onto another shop', () => {
      const first = addShop();
      const second = store.addStall({
        name: 'B',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      store.moveStall(second.id, first.posX, first.posZ);

      expect(store.stalls().find(s => s.id === second.id)!.posX).toBe(-8);
      expect(store.error()).toContain('overlaps another shop');
    });

    it('rejects a move into a blocked area and keeps the old position', () => {
      // Replace the default hall with one that has a blocked area at posX=10, posZ=0
      store.halls.set([{
        id: 'blocked-hall',
        name: 'Hall With Block',
        shape: 'SQUARE',
        width: 40,
        length: 40,
        radius: 0,
        blockedAreas: [
          { posX: 10, posZ: 0, width: 6, length: 6, kind: 'outside', color: '#ffffff' }
        ]
      }]);
      store.setActiveHall('blocked-hall');

      const shop = store.addStall({
        name: 'A',
        width: 4,
        length: 4,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      const origX = shop.posX;
      const origZ = shop.posZ;

      // Try moving into the blocked area
      store.moveStall(shop.id, 10, 0);

      expect(store.selectedStall()!.posX).toBe(origX);
      expect(store.selectedStall()!.posZ).toBe(origZ);
      expect(store.error()).toContain('outside the hall boundary');
    });

    it('allows a move onto a zone blocked area', () => {
      store.halls.set([{
        id: 'zone-hall',
        name: 'Hall With Zone',
        shape: 'SQUARE',
        width: 40,
        length: 40,
        radius: 0,
        blockedAreas: [
          { posX: 5, posZ: 5, width: 6, length: 6, kind: 'zone', color: '#8A2BE2' }
        ]
      }]);
      store.setActiveHall('zone-hall');

      const shop = store.addStall({
        name: 'A',
        width: 4,
        length: 4,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      // Move onto the zone — should succeed because zones don't block
      store.moveStall(shop.id, 5, 5);

      expect(store.selectedStall()!.posX).toBe(5);
      expect(store.selectedStall()!.posZ).toBe(5);
    });
  });

  describe('createHall', () => {
    it('creates a square hall, activates it and sets the layout name', () => {
      const hall = store.createHall({ name: ' Expo ', shape: 'SQUARE', w: 30, l: 20, r: 9 });

      expect(hall.name).toBe('Expo');
      expect(hall.width).toBe(30);
      expect(hall.length).toBe(20);
      expect(hall.radius).toBe(0);
      expect(store.activeHallId()).toBe(hall.id);
      expect(store.layoutName()).toBe('Expo');
    });

    it('zeroes width/length for a circular hall and names it by default', () => {
      const hall = store.createHall({ name: '', shape: 'CIRCLE', w: 30, l: 20, r: 9 });

      expect(hall.name).toBe('Custom Hall 3');
      expect(hall.width).toBe(0);
      expect(hall.length).toBe(0);
      expect(hall.radius).toBe(9);
    });
  });

  describe('selection', () => {
    it('clears the selected stall when the hall changes', () => {
      const shop = store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      expect(store.selectedStallId()).toBe(shop.id);
      store.setActiveHall('some-other-hall');
      expect(store.selectedStallId()).toBeNull();
    });

    it('clears the selection when the selected stall is deleted', () => {
      const shop = store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      store.deleteStall(shop.id);

      expect(store.stalls()).toEqual([]);
      expect(store.selectedStallId()).toBeNull();
    });
  });

  describe('saveEdit', () => {
    it('normalizes the selected stall', () => {
      const shop = store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      store.updateStall(shop.id, {
        name: '',
        height: NaN,
        gateSide: 'nonsense' as never
      });
      store.saveEdit();

      const updated = store.selectedStall()!;
      expect(updated.name).toBe('Shop');
      expect(updated.height).toBe(4);
      expect(updated.gateSide).toBe('FRONT');
    });

    it('refuses dimensions that no longer fit the hall', () => {
      const shop = store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;

      store.updateStall(shop.id, { width: 100 });
      store.saveEdit();

      expect(store.error()).toContain('invalid or overlap');
    });
  });

  describe('open sides', () => {
    function addShop() {
      return store.addStall({
        name: 'A',
        width: 8,
        length: 8,
        height: 4,
        color: '#3498db',
        gateSide: 'FRONT'
      })!;
    }

    it('a new stall starts with exactly its gate side open', () => {
      const shop = addShop();
      expect(shop.openSides).toEqual(['FRONT']);
      expect(shop.gateSide).toBe('FRONT');
    });

    it('toggleOpenSide adds a closed side and keeps gateSide synced', () => {
      const shop = addShop();

      store.toggleOpenSide(shop.id, 'RIGHT');

      const updated = store.currentStalls()[0];
      expect(updated.openSides).toEqual(['FRONT', 'RIGHT']);
      expect(updated.gateSide).toBe('FRONT');
    });

    it('toggleOpenSide removes an open side when more than one is open', () => {
      const shop = addShop();
      store.toggleOpenSide(shop.id, 'RIGHT');
      store.toggleOpenSide(shop.id, 'FRONT');

      const updated = store.currentStalls()[0];
      expect(updated.openSides).toEqual(['RIGHT']);
      expect(updated.gateSide).toBe('RIGHT');
    });

    it('the last remaining open side cannot be toggled off', () => {
      const shop = addShop();

      store.toggleOpenSide(shop.id, 'FRONT');

      expect(store.currentStalls()[0].openSides).toEqual(['FRONT']);
    });

    it('openSide is add-only and idempotent (3D wall click)', () => {
      const shop = addShop();

      store.openSide(shop.id, 'LEFT');
      store.openSide(shop.id, 'LEFT');
      store.openSide(shop.id, 'FRONT');

      expect(store.currentStalls()[0].openSides).toEqual(['FRONT', 'LEFT']);
    });

    it('updateStall syncs gateSide to the first open side', () => {
      const shop = addShop();

      store.updateStall(shop.id, { openSides: ['BACK', 'LEFT'] });

      const updated = store.currentStalls()[0];
      expect(updated.gateSide).toBe('BACK');
      expect(updated.openSides).toEqual(['BACK', 'LEFT']);
    });

    it('saveEdit normalizes a broken openSides list', () => {
      const shop = addShop();

      store.updateStall(shop.id, { openSides: [] });
      store.saveEdit();

      expect(store.selectedStall()!.openSides).toEqual(['FRONT']);
    });
  });

  describe('showError', () => {
    it('clears the message after 4500 ms', fakeAsync(() => {
      store.showError('boom');
      expect(store.error()).toBe('boom');

      tick(4499);
      expect(store.error()).toBe('boom');

      tick(1);
      expect(store.error()).toBe('');
    }));

    it('restarts the timer for a second error instead of leaking the first', fakeAsync(() => {
      store.showError('first');
      tick(4000);
      store.showError('second');

      tick(1000);
      expect(store.error()).toBe('second');

      tick(3500);
      expect(store.error()).toBe('');
    }));
  });

  describe('saved layout workflow - messages and loader (FD-013)', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('save: loader, then a success toast, and the loader is always released', async () => {
      const done = store.saveLayout();

      expect(notify.showLoading).toHaveBeenCalledOnceWith('Saving layout…');
      expect(store.busy()).toBeTrue();

      http.expectOne(`${API}/layout/save`).flush({ layout: { id: 1000 } });
      await settle();
      http.expectOne(`${API}/layouts`).flush([]);
      await done;

      expect(notify.success).toHaveBeenCalledOnceWith('Layout saved successfully.');
      expect(notify.hideLoading).toHaveBeenCalled();
      expect(store.busy()).toBeFalse();
      expect(store.selectedSavedId()).toBe(1000);
    });

    it('save failure: the server message reaches the error box, no toast, loader released', async () => {
      const done = store.saveLayout();

      http
        .expectOne(`${API}/layout/save`)
        .flush(
          { success: false, status: 400, message: 'Stall 1 (B) overlaps stall 0 (A).' },
          { status: 400, statusText: 'Bad Request' }
        );
      await done;

      expect(store.error()).toBe('❌ Save Error: Stall 1 (B) overlaps stall 0 (A).');
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.hideLoading).toHaveBeenCalled();
      expect(store.busy()).toBeFalse();
    });

    it('delete: nothing is sent when the dialog is cancelled', async () => {
      notify.confirm.and.resolveTo(false);

      await store.deleteLayout(1000);

      expect(notify.confirm).toHaveBeenCalledTimes(1);
      expect(notify.confirm.calls.mostRecent().args[0].danger).toBeTrue();
      expect(notify.showLoading).not.toHaveBeenCalled();
      // http.verify() in afterEach proves no DELETE went out.
    });

    it('delete: confirmed -> DELETE, row removed, success toast', async () => {
      notify.confirm.and.resolveTo(true);
      store.savedLayouts.set([{ id: 1000 } as never, { id: 1001 } as never]);
      store.selectedSavedId.set(1000);

      const done = store.deleteLayout(1000);
      await settle();
      http.expectOne({ method: 'DELETE', url: `${API}/layout/1000` }).flush({ id: 1000 });
      await done;

      expect(store.savedLayouts().map(l => l.id)).toEqual([1001]);
      expect(store.selectedSavedId()).toBeNull();
      expect(notify.success).toHaveBeenCalledOnceWith('Layout deleted.');
      expect(notify.hideLoading).toHaveBeenCalled();
    });

    it('open: loader only - no success toast', async () => {
      const done = store.openLayout(1000);

      expect(notify.showLoading).toHaveBeenCalledOnceWith('Opening layout…');

      http.expectOne(`${API}/layout/1000`).flush({
        layout: { id: 1000, name: 'Expo' },
        hall: { id: 1000, name: 'Hall', shape: 'SQUARE', width: 40, length: 40, radius: 0 },
        stalls: []
      });
      await done;

      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.hideLoading).toHaveBeenCalled();
      expect(store.layoutName()).toBe('Expo');
    });
  });

  describe('rule-driven editor', () => {
    // A 40 x 20 m hall with a 10 x 8 notch top-right (centre origin: x -20..20, z -10..10),
    // carrying rules so every placement goes through placement-rules.ts.
    const ruledHall = {
      id: 'ruled',
      name: 'Ruled Hall',
      shape: 'SQUARE' as const,
      width: 40,
      length: 20,
      radius: 0,
      boundary: [
        { x: -20, z: -10 },
        { x: 10, z: -10 },
        { x: 10, z: -2 },
        { x: 20, z: -2 },
        { x: 20, z: 10 },
        { x: -20, z: 10 }
      ],
      rules: {}
    };
    const type3x2 = { id: 'stall-3x2', label: '3 × 2', width: 3, height: 2, unit: 'meter' as const };

    beforeEach(() => {
      store.halls.set([ruledHall]);
      store.setActiveHall('ruled');
      store.stallTypes.set([type3x2]);
      store.setMode('draw');
      store.selectStallType('stall-3x2');
    });

    /** Draw with the mouse: press at `from`, drag to `to`, release. */
    function draw(from: { x: number; z: number }, to: { x: number; z: number }): void {
      store.draftStart(from);
      store.draftMove(to);
      store.draftEnd();
    }

    it('creates a snapped stall from a valid drag, unnumbered until saved', () => {
      draw({ x: -10.3, z: 0.4 }, { x: -5, z: 1 });

      const [created] = store.currentStalls();
      expect(created).toEqual(
        jasmine.objectContaining({ posX: -9.5, posZ: 1, width: 3, length: 2, stallTypeId: 'stall-3x2', stallNumber: null })
      );
      expect(store.rejection()).toBeNull();
    });

    it('previews live while dragging, with valid/invalid state', () => {
      store.draftStart({ x: -10.3, z: 0.4 });
      store.draftMove({ x: -5, z: 1 });
      expect(store.draft()?.valid).toBeTrue();

      store.draftMove({ x: -10, z: 8 }); // mostly vertical: the 3 x 2 turns into 2 x 3
      expect([store.draft()?.footprint.width, store.draft()?.footprint.length]).toEqual([2, 3]);
      store.draftEnd();

      store.draftStart({ x: -19.6, z: 0 }); // against the left wall
      store.draftMove({ x: -15, z: 0.2 });
      expect(store.draft()?.valid).toBeFalse();
      expect(store.draft()?.violations[0].code).toBe('PERIPHERAL_CLEARANCE');
    });

    it('rejects a stall in the notch, creates nothing and suggests the nearest valid spot', () => {
      draw({ x: 14, z: -8 }, { x: 16, z: -8 });

      expect(store.currentStalls()).toEqual([]);
      const rejection = store.rejection();
      expect(rejection?.violations[0].code).toBe('OUTSIDE_HALL');
      expect(rejection?.suggestion).not.toBeNull();
      expect(store.error()).toContain('Placement rejected: Stall is outside the hall boundary.');

      store.acceptSuggestion();
      expect(store.currentStalls().length).toBe(1);
      expect(store.rejection()).toBeNull();
    });

    it('a large stall cannot overwrite smaller ones', () => {
      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 });
      draw({ x: -7, z: 0 }, { x: -2, z: 0.2 });
      expect(store.currentStalls().length).toBe(2);

      store.selectStallType(null); // Custom: the dragged rectangle
      draw({ x: -10.5, z: -1.5 }, { x: -1.5, z: 5.5 });

      expect(store.currentStalls().length).toBe(2);
      expect(store.rejection()?.violations[0].message).toMatch(/^Overlaps 2 existing stalls/);
    });

    it('rejects a 2 m gap for B2B and accepts it once touching', () => {
      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 }); // x -10..-7
      draw({ x: -5, z: 0 }, { x: 0, z: 0.2 }); // x -5..-2: 2 m gap
      expect(store.currentStalls().length).toBe(1);
      expect(store.rejection()?.violations[0].code).toBe('PATHWAY_WIDTH');

      draw({ x: -7, z: 0 }, { x: 0, z: 0.2 }); // touching: one island
      expect(store.currentStalls().length).toBe(2);
    });

    it('snaps a dropped move back when it breaks a rule', () => {
      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 });
      const stall = store.currentStalls()[0];
      store.setMode('select');

      store.selectStall(stall.id);
      store.setDragging(true);
      store.moveStall(stall.id, -18.4, 1); // edges snap to x -20..-17: 0 m from the wall
      store.setDragging(false);

      expect(store.currentStalls()[0].posX).toBe(stall.posX);
      expect(store.rejection()?.violations[0].code).toBe('PERIPHERAL_CLEARANCE');
    });

    it('cancelling a numbered stall keeps its number and frees its space', () => {
      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 });
      const stall = store.currentStalls()[0];
      store.updateStall(stall.id, { stallNumber: 'STALL-002' });

      store.cancelStall(stall.id);
      expect(store.currentStalls()[0]).toEqual(jasmine.objectContaining({ stallNumber: 'STALL-002', status: 'CANCELLED' }));

      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 }); // same place: allowed now
      expect(store.currentStalls().length).toBe(2);
    });

    it('removes an unsaved stall outright', () => {
      draw({ x: -10, z: 0 }, { x: -5, z: 0.2 });
      store.cancelStall(store.currentStalls()[0].id);
      expect(store.currentStalls()).toEqual([]);
    });

    it('audits existing problems without blocking them', () => {
      store.stalls.set([
        { id: 's1', hallId: 'ruled', name: 'A', width: 3, length: 2, height: 4, posX: -18.5, posZ: 0, color: '#3498db', gateSide: 'FRONT', openSides: ['FRONT'], stallNumber: 'STALL-001', status: 'AVAILABLE', stallTypeId: null }
      ]);
      expect(store.audit().length).toBe(1);
      expect(store.audit()[0].violations[0].code).toBe('PERIPHERAL_CLEARANCE');
    });
  });
});
