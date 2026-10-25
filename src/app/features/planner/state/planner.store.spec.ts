import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { PlansApiService } from '../data/plans-api.service';
import type { HallFloor } from '../domain/floor.models';
import type { PlanFinding, PlannerView, PlanStall } from '../domain/plan.models';
import { PlannerStore } from './planner.store';

const FLOOR: HallFloor = {
  schema: 'floor/1',
  width: 60,
  depth: 40,
  areas: [],
  labels: [],
  iconGroups: [],
  north: null,
  legend: [],
};

const stall = (id: string, x: number): PlanStall => ({
  id,
  zoneId: null,
  islandNumber: null,
  stallNumber: id,
  x,
  y: 10,
  width: 3,
  depth: 3,
  openSides: ['top'],
  cutCells: [],
  labelArea: null,
  scheme: 'shell',
  categoryIds: [],
  isPremium: false,
  isBlocked: false,
  isFnb: false,
  isBranding: false,
  isHorseshoe: false,
  isMarqueeAvailable: false,
  isRestrictedForOverseas: false,
  isActive: true,
  location: null,
  description: null,
});

function view(overrides: Partial<PlannerView> = {}): PlannerView {
  return {
    hall: {
      event: {
        id: 'e1',
        name: 'Fair',
        kind: 'internal',
        status: 'Approved',
        audience: 'B2B',
        organiserName: null,
      },
      hall: {
        hallId: 'h1',
        name: 'Hall 1',
        code: null,
        level: null,
        venue: { id: 'itpo', name: 'ITPO' },
        width: 60,
        depth: 40,
        floorArea: 2400,
        floorVersion: 1,
        latestFloorVersion: 1,
        rulesOn: 0,
        drawingProfile: 'free',
        overlaps: [],
      },
      floor: FLOOR,
      rules: { switches: {}, values: {} as never, drawingProfile: 'free' },
      categories: [],
      plan: { stalls: 0, seats: 0, revision: 0 },
    },
    plan: {
      zones: [],
      stalls: [],
      seats: [],
      objects: [],
      revision: 0,
      updatedAt: null,
      published: null,
      review: null,
    },
    findings: null,
    pricing: null,
    canEdit: true,
    readOnlyReason: null,
    canPublish: false,
    needsApproval: false,
    canSubmit: false,
    canWithdraw: false,
    canApprove: false,
    canReopen: false,
    ...overrides,
  };
}

function build(api: Partial<Record<keyof PlansApiService, unknown>>) {
  const warnings: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      PlannerStore,
      { provide: PlansApiService, useValue: api },
      {
        provide: MessageService,
        useValue: {
          add: (m: { severity: string; summary: string }) =>
            m.severity === 'warn' && warnings.push(m.summary),
        },
      },
    ],
  });
  const store = TestBed.inject(PlannerStore);
  store.load('e1', 'h1', view());
  return { store, warnings };
}

describe('PlannerStore', () => {
  it('should add a stall the server finds no rule broken by, and let it be undone', async () => {
    const { store } = build({ check: () => of<PlanFinding[]>([]) });
    const a = stall('a', 10);

    const made = await store.change({ ...store.plan(), stalls: [a] }, ['a'], {
      kind: 'stall',
      ids: ['a'],
    });

    expect(made).toBe(true);
    expect(store.plan().stalls).toEqual([a]);
    expect(store.dirty()).toBe(true);
    expect(store.selectedStalls()).toEqual([a]);

    store.undo();
    expect(store.plan().stalls).toEqual([]);
    store.redo();
    expect(store.plan().stalls).toEqual([a]);
  });

  it('should refuse a change that breaks a rule, and say which', async () => {
    const finding: PlanFinding = {
      ruleId: 'overlap',
      message: 'Stalls 1 and 2 overlap.',
      ids: ['a'],
    };
    const { store, warnings } = build({ check: () => of([finding]) });

    const made = await store.change({ ...store.plan(), stalls: [stall('a', 10)] }, ['a']);

    expect(made).toBe(false);
    expect(store.plan().stalls).toEqual([]);
    expect(store.dirty()).toBe(false);
    expect(warnings[0]).toContain('Stalls 1 and 2 overlap.');
    expect(store.refused()).toBe(1);
  });

  it('should leave a failed check as it was', async () => {
    const { store } = build({ check: () => throwError(() => new ApiError('Down', 500)) });

    expect(await store.change({ ...store.plan(), stalls: [stall('a', 10)] }, ['a'])).toBe(false);
    expect(store.plan().stalls).toEqual([]);
  });

  it('should leave out of an auto-fill the places that break a rule, and add the rest as one step', async () => {
    const bad = stall('bad', 30);
    const { store } = build({
      check: (_e: string, _h: string, plan: { stalls: PlanStall[] }) =>
        of<PlanFinding[]>(
          plan.stalls.some((s) => s.id === 'bad')
            ? [{ ruleId: 'wall', message: 'Too near a wall.', ids: ['bad'] }]
            : [],
        ),
    });

    const result = await store.addPassing({ stalls: [stall('a', 10), bad, stall('c', 20)] });

    expect(result).toEqual({ added: 2, dropped: 1 });
    expect(store.plan().stalls.map((s) => s.id)).toEqual(['a', 'c']);
    store.undo();
    expect(store.plan().stalls).toEqual([]);
  });

  it('should save at the revision it opened on, then take the saved one', async () => {
    const sent: number[] = [];
    const { store } = build({
      check: () => of<PlanFinding[]>([]),
      save: (_e: string, _h: string, _p: unknown, revision: number) => {
        sent.push(revision);
        return of({ ...view().plan, revision: revision + 1 });
      },
    });
    await store.change({ ...store.plan(), stalls: [stall('a', 10)] }, ['a']);

    expect(await store.save()).toBe(true);

    expect(sent).toEqual([0]);
    expect(store.revision()).toBe(1);
    expect(store.dirty()).toBe(false);
  });

  it('should show a refused publish in full, as a warning', async () => {
    const { store, warnings } = build({
      publish: () =>
        throwError(
          () => new ApiError('The plan was not published: 1 booked stall would change.', 409),
        ),
    });

    expect(await store.publish()).toBe(false);
    expect(warnings[0]).toContain('booked stall would change');
  });
});
