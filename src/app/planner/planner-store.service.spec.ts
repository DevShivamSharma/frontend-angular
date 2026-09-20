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

  it('starts on the offline fallback hall with no stalls', () => {
    // Real halls arrive from GET /api/halls; this is only what shows before that answers.
    expect(store.halls().length).toBe(1);
    expect(store.currentHall()?.name).toBe('Sample Hall (offline)');
    expect(store.currentHall()?.width).toBe(40);
    expect(store.currentStalls()).toEqual([]);
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
    });

    it('keeps the fallback when the backend is unreachable', async () => {
      const promise = store.loadHalls();
      http.expectOne(`${API}/halls?standalone=true`).error(new ProgressEvent('network error'));
      await promise;

      expect(store.currentHall()?.name).toBe('Sample Hall (offline)');
    });

    it('keeps the fallback when the backend returns no halls', async () => {
      const promise = store.loadHalls();
      http.expectOne(`${API}/halls?standalone=true`).flush([]);
      await promise;

      expect(store.halls().length).toBe(1);
      expect(store.currentHall()?.name).toBe('Sample Hall (offline)');
    });
  });

  describe('addStall', () => {
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

      expect(hall.name).toBe('Custom Hall 2');
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
});
