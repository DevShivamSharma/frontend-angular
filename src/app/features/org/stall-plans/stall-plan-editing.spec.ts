import type { StallPlanView } from '../../../core/stall-plans/stall-plans.models';
import {
  EditStall,
  editStalls,
  isDirty,
  nextStallNumber,
  planActions,
  planInput,
  planProblems,
  readOnlyReason,
  withoutStall,
} from './stall-plan-editing';

function plan(change: Partial<StallPlanView> = {}): StallPlanView {
  return {
    id: 'plan-1',
    event: { id: 'e1', name: 'Book Fair', status: 'scheduled', eventType: 'B2C' },
    hall: { id: 'h1', name: 'Hall 5', floorVersion: 2, currentVersion: 3 },
    status: 'draft',
    revision: 4,
    stalls: [
      {
        id: 's1',
        number: '1',
        x: 2,
        y: 2,
        width: 3,
        depth: 3,
        area: 9,
        openSides: ['bottom', 'top'],
        stallType: 'shell',
      },
    ],
    overrides: [{ ruleId: 'sizeStep', stallIds: ['s1'], reason: 'Corner stall', by: 'a@b.test' }],
    approvedAt: null,
    publishedAt: null,
    activeBookings: 0,
    floor: {
      schema: 'floor/1',
      width: 40,
      depth: 30,
      areas: [],
      labels: [],
      iconGroups: [],
      north: null,
      legend: [],
    },
    report: { passed: true, violations: [], rules: [], utilisation: 0.1 },
    ...change,
  };
}

const allowed =
  (...permissions: string[]) =>
  (p: string) =>
    permissions.includes(p);

function stall(change: Partial<EditStall> = {}): EditStall {
  return {
    key: 'new-1',
    id: null,
    number: '2',
    x: 10,
    y: 4,
    width: 3,
    depth: 2,
    openSides: ['bottom'],
    stallType: null,
    ...change,
  };
}

describe('planActions', () => {
  const every = allowed('layouts.edit', 'layouts.approve', 'layouts.publish');

  it('offers drawing, approving and deleting on a saved draft', () => {
    expect(planActions(plan(), every)).toEqual({
      edit: true,
      approve: true,
      publish: false,
      reopen: false,
      remove: true,
    });
  });

  it('offers neither approving nor deleting before the first save', () => {
    const actions = planActions(plan({ id: null, revision: 0, stalls: [] }), every);
    expect(actions.edit).toBeTrue();
    expect(actions.approve).toBeFalse();
    expect(actions.remove).toBeFalse();
  });

  it('offers publishing and reopening an approved plan', () => {
    expect(planActions(plan({ status: 'approved' }), every)).toEqual({
      edit: false,
      approve: false,
      publish: true,
      reopen: true,
      remove: false,
    });
  });

  it('offers only reopening a published plan', () => {
    const actions = planActions(plan({ status: 'published' }), every);
    expect(actions.reopen).toBeTrue();
    expect(actions.publish).toBeFalse();
  });

  it('follows each permission on its own', () => {
    expect(planActions(plan(), allowed('layouts.approve')).edit).toBeFalse();
    expect(planActions(plan(), allowed('layouts.approve')).approve).toBeTrue();
    expect(planActions(plan({ status: 'approved' }), allowed('layouts.edit')).publish).toBeFalse();
    expect(planActions(plan({ status: 'published' }), allowed('layouts.view')).reopen).toBeFalse();
  });

  it('offers nothing once the event is completed or cancelled', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const view = plan({ event: { ...plan().event, status } });
      expect(Object.values(planActions(view, every))).toEqual([false, false, false, false, false]);
    }
  });
});

describe('readOnlyReason', () => {
  it('is null for a draft the member draws', () => {
    expect(readOnlyReason(plan(), allowed('layouts.edit'))).toBeNull();
  });

  it('explains a closed event, an approved or published plan and a viewer', () => {
    const closed = plan({ event: { ...plan().event, status: 'completed' } });
    expect(readOnlyReason(closed, allowed('layouts.edit'))).toContain('completed');
    expect(readOnlyReason(plan({ status: 'approved' }), allowed('layouts.edit'))).toContain(
      'Reopen',
    );
    expect(readOnlyReason(plan({ status: 'published' }), allowed('layouts.view'))).toBe(
      'Published to booking.',
    );
    expect(readOnlyReason(plan(), allowed('layouts.view'))).toContain('Draw layouts');
  });
});

describe('nextStallNumber', () => {
  it('follows the highest plain number', () => {
    expect(nextStallNumber([{ number: '1' }, { number: '7' }, { number: 'A-3' }])).toBe('8');
  });

  it('counts the stalls when none has a plain number, skipping numbers taken', () => {
    expect(nextStallNumber([])).toBe('1');
    expect(nextStallNumber([{ number: 'A-1' }, { number: 'A-2' }])).toBe('3');
  });
});

describe('planInput', () => {
  it('sends only what the backend accepts', () => {
    const view = plan();
    const input = planInput(4, [...editStalls(view), stall({ number: ' 2 ' })], view.overrides);
    expect(input).toEqual({
      revision: 4,
      stalls: [
        {
          id: 's1',
          number: '1',
          x: 2,
          y: 2,
          width: 3,
          depth: 3,
          openSides: ['top', 'bottom'],
          stallType: 'shell',
        },
        {
          number: '2',
          x: 10,
          y: 4,
          width: 3,
          depth: 2,
          openSides: ['bottom'],
          stallType: null,
        },
      ],
      overrides: [{ ruleId: 'sizeStep', stallIds: ['s1'], reason: 'Corner stall' }],
    });
  });
});

describe('isDirty', () => {
  it('is false for the plan as loaded, whatever order its open sides came in', () => {
    const view = plan();
    const stalls = editStalls(view).map((s) => ({ ...s, openSides: [...s.openSides].reverse() }));
    expect(isDirty(view, stalls, view.overrides)).toBeFalse();
  });

  it('sees a moved, added or removed stall and a changed rule set aside', () => {
    const view = plan();
    const [first] = editStalls(view);
    expect(isDirty(view, [{ ...first, x: 3 }], view.overrides)).toBeTrue();
    expect(isDirty(view, [first, stall()], view.overrides)).toBeTrue();
    expect(isDirty(view, [], view.overrides)).toBeTrue();
    expect(isDirty(view, [first], [])).toBeTrue();
  });
});

describe('planProblems', () => {
  it('finds missing and repeated numbers and sizes of 0', () => {
    expect(planProblems([stall({ number: '1' }), stall({ number: '2' })])).toEqual([]);
    expect(planProblems([stall({ number: ' ' })])).toEqual(['Every stall needs a number.']);
    expect(planProblems([stall({ number: '4' }), stall({ number: '4 ' })])).toEqual([
      'Stall number 4 appears twice.',
    ]);
    expect(planProblems([stall({ width: 0 })])).toEqual([
      'Stall 2 needs a width and depth above 0 m.',
    ]);
  });
});

describe('withoutStall', () => {
  it('drops the stall from each rule set aside, and a rule left with no stall', () => {
    expect(
      withoutStall(
        [
          { ruleId: 'sizeStep', stallIds: ['s1'], reason: 'One' },
          { ruleId: 'stallOverlap', stallIds: ['s1', 's2'], reason: 'Two' },
          { ruleId: 'maxUtilization', stallIds: null, reason: 'All' },
        ],
        's1',
      ),
    ).toEqual([
      { ruleId: 'stallOverlap', stallIds: ['s2'], reason: 'Two' },
      { ruleId: 'maxUtilization', stallIds: null, reason: 'All' },
    ]);
  });
});
