import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../../core/api-base.token';
import { NotifyService } from '../../core/notify.service';
import { PlannerStore } from '../planner-store.service';
import { DraftingEngine } from './drafting-engine.service';

/** Lets the async command advance past the prompt it was waiting on. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/*
 * A 60 x 40 m hall with the default venue rules (3 m passages, 1 m from the walls, 3 m clear in
 * front of an open side, touching only back to back). CAD (0,0) is its bottom-left corner, which
 * is world (-30, 20). Stalls drawn around CAD (10,10) are well inside it.
 */
describe('DraftingEngine', () => {
  let store: PlannerStore;
  let engine: DraftingEngine;
  let notify: jasmine.SpyObj<NotifyService>;

  async function type(...lines: string[]): Promise<void> {
    for (const line of lines) {
      engine.submit(line);
      await settle();
    }
  }

  const rows = () => store.currentStalls().map(s => [s.posX, s.posZ, s.width, s.length, s.openSides.join('+')]);
  const lastLog = () => engine.history().at(-1)?.text ?? '';
  const logged = (text: string) => engine.history().some(l => l.text.includes(text));

  beforeEach(() => {
    notify = jasmine.createSpyObj('NotifyService', ['error', 'success', 'confirm', 'showLoading', 'hideLoading']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: NotifyService, useValue: notify },
        PlannerStore,
        DraftingEngine
      ]
    });
    store = TestBed.inject(PlannerStore);
    engine = TestBed.inject(DraftingEngine);
    store.halls.set([{ id: 'h', name: 'Test hall', shape: 'SQUARE', width: 60, length: 40, radius: 0 }]);
    store.activeHallId.set('h');
    engine.setSize({ width: 3, depth: 3 });
  });

  describe('drawing', () => {
    it('places a stall at a typed insertion point (its bottom-left corner)', async () => {
      await type('STL', '10,10', '');
      expect(rows()).toEqual([[-18.5, 8.5, 3, 3, 'FRONT']]);
      expect(engine.active()).toBeNull();
    });

    it('runs a whole STALLROW from one line, with a 3 m passage between stalls', async () => {
      await type('SR G 3 10,10 @15<0', '');
      expect(rows().map(r => r[0])).toEqual([-18.5, -12.5, -6.5]);
      expect(logged('3 stalls created')).toBeTrue();
    });

    it('changes the row size through the Size option', async () => {
      await type('SR S 4x2 G 3 10,10 @11<0', '');
      expect(rows().map(r => [r[2], r[3]])).toEqual([[4, 2], [4, 2]]);
    });

    it('draws a stall corner to corner with REC, any size', async () => {
      await type('REC', '10,10', '@6,3', '');
      expect(rows()).toEqual([[-17, 8.5, 6, 3, 'FRONT']]);
    });

    it('REC takes typed dimensions, a quadrant click and a chosen open side', async () => {
      await type('REC', 'O', '10,10', 'D', '4', '3', '@1,1', '');
      expect(rows()).toEqual([[-18, 8.5, 4, 3, 'RIGHT']]);
    });

    it('refuses a REC thinner than half a metre and keeps asking', async () => {
      await type('REC', '10,10', '@6,0.2');
      expect(store.currentStalls().length).toBe(0);
      expect(engine.request()?.message).toBe('Specify other corner');
    });

    it('draws an L-shaped stall point by point with PL, first segment open', async () => {
      await type('PL', '10,10', '@6,0', '@0,3', '@-3,0', '@0,3', '@-3,0', 'C');
      const [s] = store.currentStalls();
      expect(s.footprint?.length).toBe(6);
      expect([s.width, s.length]).toEqual([6, 6]);
      expect(s.openEdges?.length).toBe(1);
      expect(s.openSides).toEqual(['FRONT']);
      expect(logged('6-corner shape, 27 m²')).toBeTrue();
    });

    it('keeps a four-corner PL as an ordinary rectangle, and needs three points', async () => {
      await type('PL', '10,10', '@0,4', '@3,0', '@0,-4', '');
      const [s] = store.currentStalls();
      expect([s.width, s.length, s.footprint ?? null, s.openSides]).toEqual([3, 4, null, ['LEFT']]);
      await type('PL', '30,10', '@2,0', '');
      expect(store.currentStalls().length).toBe(1);
    });
  });

  describe('the rules gate: nothing that breaks a rule is drawn', () => {
    it('refuses a stall against the wall, says why, and keeps the command going', async () => {
      await type('STL', '0.5,0.5');
      expect(store.currentStalls().length).toBe(0);
      expect(lastLog()).toMatch(/^Not done: /);
      expect(notify.error).toHaveBeenCalled();
      expect(engine.request()?.kind).toBe('point');
      await type('10,10', '');
      expect(store.currentStalls().length).toBe(1);
    });

    it('refuses a whole row when any stall in it would break a rule (no half rows)', async () => {
      // The third stall of the row would run past the hall's right wall (x = 60).
      await type('SR', '52,10', '@9<0', '');
      expect(store.currentStalls().length).toBe(0);
      expect(logged('Not done: stall 3 of 3')).toBeTrue();
    });

    it('draws a row of stalls sharing walls: closed sides need no passage', async () => {
      await type('SR', '10,10', '@9<0', '');
      expect(rows().map(r => r[0])).toEqual([-18.5, -15.5, -12.5]);
    });

    it('refuses a move into the wall and asks for another point', async () => {
      await type('STL', '10,10', '');
      engine.selectAll();
      await type('M', '0,0', '@-9.5,0');
      expect(rows()).toEqual([[-18.5, 8.5, 3, 3, 'FRONT']]);
      expect(engine.request()?.message).toBe('Specify second point');
      await type('@2,1');
      expect(rows()).toEqual([[-16.5, 7.5, 3, 3, 'FRONT']]);
    });

    it('refuses a properties change that would break a rule', async () => {
      await type('STL', '10,10', '20,10', '');
      const first = String(store.currentStalls()[0].id);
      expect(engine.updateStalls(new Set([first]), s => ({ ...s, width: 18 }), 'Size')).toBeFalse();
      expect(store.currentStalls()[0].width).toBe(3);
      expect(engine.updateStalls(new Set([first]), s => ({ ...s, color: '#ff0000' }), 'Colour')).toBeTrue();
    });

    it('marks the preview red where the stall would be refused', async () => {
      await type('STL');
      engine.pointerMove({ x: -29.5, z: 19.5 }, 0.01);
      expect(engine.preview()?.invalid).toEqual([true]);
      engine.pointerMove({ x: -20, z: 10 }, 0.01);
      expect(engine.preview()?.invalid).toEqual([false]);
    });

    it('still lets a stall that already breaks a rule be moved, as long as it gets no worse', async () => {
      // As a PDF import can bring in: a stall against the wall.
      await type('STL', '10,10', '');
      store.stalls.update(list => list.map(s => ({ ...s, posX: -28.5 })));
      engine.selectAll();
      await type('M', '0,0', '@9,0');
      expect(store.currentStalls()[0].posX).toBe(-19.5);
    });
  });

  describe('modify', () => {
    it('undoes and redoes a command as one step', async () => {
      await type('SR G 3 10,10 @15<0', '');
      await type('U');
      expect(store.currentStalls().length).toBe(0);
      await type('REDO');
      expect(store.currentStalls().length).toBe(3);
    });

    it('repeats the last command on an empty Enter', async () => {
      await type('STL', '10,10', '');
      await type('', '20,10', '');
      expect(store.currentStalls().length).toBe(2);
    });

    it('copies until Enter, and rotates 90° about a point', async () => {
      engine.setSize({ width: 3, depth: 2 });
      await type('STL', '10,10', '');
      engine.selectAll();
      await type('CO', '0,0', '@6,0', '@12,0', '');
      expect(store.currentStalls().length).toBe(3);
      engine.select([String(store.currentStalls()[0].id)]);
      await type('RO', '10,10', '90');
      const turned = store.currentStalls()[0];
      expect([turned.width, turned.length, turned.rotation, turned.openSides]).toEqual([2, 3, 0, ['RIGHT']]);
    });

    it('erases a new stall and cancels a saved one, keeping its number', async () => {
      await type('STL', '10,10', '20,10', '');
      const [a, b] = store.currentStalls();
      store.stalls.update(list => list.map(s => (s.id === b.id ? { ...s, stallNumber: 'STALL-001' } : s)));
      engine.selectAll();
      await type('E');
      expect(store.currentStalls().map(s => [s.stallNumber, s.status])).toEqual([['STALL-001', 'CANCELLED']]);
      expect(store.currentStalls().some(s => s.id === a.id)).toBeFalse();
      expect(engine.stalls().length).toBe(0);
    });

    it('names stalls in row order and orders unsaved ones for server numbering', async () => {
      await type('STL', '16,10', '10,10', '');
      engine.selectAll();
      await type('RN', 'R', 'B-', '7');
      expect(store.currentStalls().map(s => [s.name, s.posX])).toEqual([['B-07', -18.5], ['B-08', -12.5]]);
    });
  });

  describe('command line', () => {
    it('cancels a command with Esc without drawing anything', async () => {
      await type('SR', '10,10');
      engine.escape();
      await settle();
      expect(engine.active()).toBeNull();
      expect(engine.request()).toBeNull();
      expect(store.currentStalls().length).toBe(0);
    });

    it('starts another command typed at a prompt', async () => {
      await type('SR');
      await type('STL');
      await settle();
      expect(engine.active()).toBe('STALL');
    });

    it('measures with DIST and reports unknown commands', async () => {
      await type('DI', '0,0', '@3,4');
      expect(lastLog()).toContain('Distance = 5 m');
      await type('FOO');
      expect(lastLog()).toContain('Unknown command "FOO"');
    });
  });
});
