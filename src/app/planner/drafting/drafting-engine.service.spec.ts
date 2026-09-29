import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../../core/api-base.token';
import { NotifyService } from '../../core/notify.service';
import { PlannerStore } from '../planner-store.service';
import { DraftingEngine } from './drafting-engine.service';

/** Lets the async command advance past the prompt it was waiting on. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('DraftingEngine', () => {
  let store: PlannerStore;
  let engine: DraftingEngine;

  async function type(...lines: string[]): Promise<void> {
    for (const line of lines) {
      engine.submit(line);
      await settle();
    }
  }

  const rows = () => store.currentStalls().map(s => [s.posX, s.posZ, s.width, s.length, s.openSides.join('+')]);
  const lastLog = () => engine.history().at(-1)?.text ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: NotifyService, useValue: jasmine.createSpyObj('NotifyService', ['error', 'success', 'confirm', 'showLoading', 'hideLoading']) },
        PlannerStore,
        DraftingEngine
      ]
    });
    store = TestBed.inject(PlannerStore);
    engine = TestBed.inject(DraftingEngine);
    // A 40 x 30 m hall: CAD (0,0) is its bottom-left corner, world (-20, 15).
    store.halls.set([{ id: 'h', name: 'Test hall', shape: 'SQUARE', width: 40, length: 30, radius: 0 }]);
    store.activeHallId.set('h');
    engine.setSize({ width: 3, depth: 3 });
  });

  it('places a stall at a typed insertion point (its bottom-left corner)', async () => {
    await type('STL', '2,2', '');
    expect(rows()).toEqual([[-16.5, 11.5, 3, 3, 'FRONT']]);
    expect(engine.active()).toBeNull();
  });

  it('runs a whole STALLROW from one line, as "SR 0,4 @12<0"', async () => {
    await type('SR 0,4 @12<0', '');
    expect(rows().length).toBe(4);
    expect(rows()[0]).toEqual([-18.5, 9.5, 3, 3, 'FRONT']);
    expect(engine.history().some(l => l.text.startsWith('4 stalls created'))).toBeTrue();
  });

  it('undoes and redoes a command as one step', async () => {
    await type('SR', '0,4', '@12<0', '');
    await type('U');
    expect(store.currentStalls().length).toBe(0);
    await type('REDO');
    expect(store.currentStalls().length).toBe(4);
  });

  it('repeats the last command on an empty Enter', async () => {
    await type('STL', '0,0', '');
    await type('', '10,0', '');
    expect(store.currentStalls().length).toBe(2);
  });

  it('moves the selection by a relative displacement', async () => {
    await type('STL', '0,0', '');
    engine.selectAll();
    await type('M', '0,0', '@2,1');
    expect(rows()).toEqual([[-16.5, 12.5, 3, 3, 'FRONT']]);
  });

  it('copies until Enter, and rotates 90° about a point', async () => {
    engine.setSize({ width: 3, depth: 2 });
    await type('STL', '0,0', '');
    engine.selectAll();
    await type('CO', '0,0', '@5,0', '@10,0', '');
    expect(store.currentStalls().length).toBe(3);
    engine.select([String(store.currentStalls()[0].id)]);
    await type('RO', '0,0', '90');
    const turned = store.currentStalls()[0];
    expect([turned.width, turned.length, turned.rotation, turned.openSides]).toEqual([2, 3, 0, ['RIGHT']]);
  });

  it('erases a new stall and cancels a saved one, keeping its number', async () => {
    await type('STL', '0,0', '10,0', '');
    const [a, b] = store.currentStalls();
    store.stalls.update(list => list.map(s => (s.id === b.id ? { ...s, stallNumber: 'STALL-001' } : s)));
    engine.selectAll();
    await type('E');
    expect(store.currentStalls().map(s => [s.stallNumber, s.status])).toEqual([['STALL-001', 'CANCELLED']]);
    expect(store.currentStalls().some(s => s.id === a.id)).toBeFalse();
    expect(engine.stalls().length).toBe(0);
  });

  it('names stalls in row order and orders unsaved ones for server numbering', async () => {
    await type('STL', '6,0', '0,0', '');
    engine.selectAll();
    await type('RN', 'R', 'B-', '7');
    expect(store.currentStalls().map(s => [s.name, s.posX])).toEqual([['B-07', -18.5], ['B-08', -12.5]]);
  });

  it('cancels a command with Esc without drawing anything', async () => {
    await type('SR', '0,0');
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

  it('changes the row size through the Size option', async () => {
    await type('SR', 'S', '4x2', '0,0', '@8<0', '');
    expect(rows().map(r => [r[2], r[3]])).toEqual([[4, 2], [4, 2]]);
  });
});
