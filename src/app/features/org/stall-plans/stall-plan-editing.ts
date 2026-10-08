import { isOpen } from '../../../core/events/event-rules';
import type { RuleOverride, StallSide } from '../../../core/rules/rules.models';
import type {
  PlanStallInput,
  SavePlanInput,
  StallPlanView,
  StallType,
} from '../../../core/stall-plans/stall-plans.models';

/**
 * The stall plan editor's rules that need no Angular: the stalls as the editor holds them, what
 * is saved, what changed and which steps the member may take. Pure, so they are unit-tested on
 * their own. The backend stays the authority; these only decide what the page offers.
 */

export const SIDES: readonly StallSide[] = ['top', 'bottom', 'left', 'right'];

/** The longest stall number the backend takes. */
const MAX_NUMBER = 40;

/** A stall as the editor holds it. `key` is its id once saved, a local one before. */
export interface EditStall {
  key: string;
  id: string | null;
  number: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  openSides: StallSide[];
  stallType: StallType | null;
}

/** What the member may do with the plan now, from its state, the event's and the permissions. */
export interface PlanActions {
  /** Draw stalls and set rules aside, and save them. */
  edit: boolean;
  approve: boolean;
  publish: boolean;
  reopen: boolean;
  /** Delete the draft. */
  remove: boolean;
}

export function planActions(
  view: StallPlanView,
  can: (permission: string) => boolean,
): PlanActions {
  const open = isOpen(view.event.status);
  const draft = view.status === 'draft';
  const saved = view.id !== null;
  return {
    edit: open && draft && can('layouts.edit'),
    approve: open && draft && saved && can('layouts.approve'),
    publish: open && view.status === 'approved' && can('layouts.publish'),
    reopen: open && !draft && can('layouts.edit'),
    remove: open && draft && saved && can('layouts.edit'),
  };
}

/** Why the plan cannot be drawn on, or null when it can. */
export function readOnlyReason(
  view: StallPlanView,
  can: (permission: string) => boolean,
): string | null {
  if (!isOpen(view.event.status)) {
    return `The event is ${view.event.status}: its stall plans no longer change.`;
  }
  if (view.status === 'approved') {
    return can('layouts.edit')
      ? 'Approved plans are not edited. Reopen it as a draft to change its stalls.'
      : 'Approved: waiting to be published to booking.';
  }
  if (view.status === 'published') {
    return can('layouts.edit')
      ? 'Published to booking. Reopen it as a draft to change its stalls; not possible while a stall is held or booked.'
      : 'Published to booking.';
  }
  if (!can('layouts.edit'))
    return 'You can see this draft; drawing it needs the Draw layouts permission.';
  return null;
}

export function editStalls(view: StallPlanView): EditStall[] {
  return view.stalls.map((s) => ({
    key: s.id,
    id: s.id,
    number: s.number,
    x: s.x,
    y: s.y,
    width: s.width,
    depth: s.depth,
    openSides: [...s.openSides],
    stallType: s.stallType,
  }));
}

/** The next free number: one above the highest plain number, else one above the stall count. */
export function nextStallNumber(stalls: readonly Pick<EditStall, 'number'>[]): string {
  const numbers = stalls.map((s) => s.number.trim());
  const taken = new Set(numbers);
  const plain = numbers.filter((n) => /^\d+$/.test(n)).map(Number);
  let next = plain.length ? Math.max(...plain) + 1 : stalls.length + 1;
  while (taken.has(String(next))) next++;
  return String(next);
}

/** The save body: only what the backend accepts, open sides in one order. */
export function planInput(
  revision: number,
  stalls: readonly EditStall[],
  overrides: readonly RuleOverride[],
): SavePlanInput {
  return {
    revision,
    stalls: stalls.map((s): PlanStallInput => ({
      ...(s.id ? { id: s.id } : {}),
      number: s.number.trim(),
      x: s.x,
      y: s.y,
      width: s.width,
      depth: s.depth,
      openSides: SIDES.filter((side) => s.openSides.includes(side)),
      stallType: s.stallType,
    })),
    overrides: overrides.map((o) => ({
      ruleId: o.ruleId,
      stallIds: o.stallIds ?? null,
      reason: o.reason.trim(),
    })),
  };
}

/** True when the stalls or the rules set aside differ from the saved plan. */
export function isDirty(
  view: StallPlanView,
  stalls: readonly EditStall[],
  overrides: readonly RuleOverride[],
): boolean {
  const saved = planInput(view.revision, editStalls(view), view.overrides);
  return JSON.stringify(saved) !== JSON.stringify(planInput(view.revision, stalls, overrides));
}

/** What would make the backend refuse the save, in its words where it has them. */
export function planProblems(stalls: readonly EditStall[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const s of stalls) {
    const number = s.number.trim();
    if (!number) {
      problems.push('Every stall needs a number.');
      continue;
    }
    if (number.length > MAX_NUMBER) {
      problems.push(`Stall number ${number} is longer than ${MAX_NUMBER} characters.`);
    }
    if (seen.has(number)) twice.add(number);
    seen.add(number);
    if (!(s.width > 0) || !(s.depth > 0)) {
      problems.push(`Stall ${number} needs a width and depth above 0 m.`);
    }
  }
  for (const number of twice) problems.push(`Stall number ${number} appears twice.`);
  return [...new Set(problems)];
}

/** The rules set aside without a removed stall; one that named only that stall goes. */
export function withoutStall<T extends RuleOverride>(
  overrides: readonly T[],
  stallId: string,
): T[] {
  return overrides.flatMap((o) => {
    if (!o.stallIds?.includes(stallId)) return [o];
    const rest = o.stallIds.filter((id) => id !== stallId);
    return rest.length ? [{ ...o, stallIds: rest }] : [];
  });
}
