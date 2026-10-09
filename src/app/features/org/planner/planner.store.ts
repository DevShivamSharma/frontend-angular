import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { CategoryRef } from '../../../core/categories/categories.models';
import { PlansApi } from '../../../core/plans/plans-api.service';
import type {
  PlanContent,
  PlanFinding,
  PlannerView,
  PlanObject,
  PlanSeat,
  PlanStall,
  PlanZone,
  StallPlanView,
} from '../../../core/plans/plans.models';
import { Notifier } from '../../../core/ui/notifier.service';
import { plannerFloor, PlannerFloor } from './planner-geometry';

export type SelectionKind = 'zone' | 'stall' | 'seat' | 'object';
export interface Selection {
  kind: SelectionKind;
  ids: string[];
}

const EMPTY: PlanContent = { zones: [], stalls: [], seats: [], objects: [] };
/** Undo steps kept. */
const HISTORY = 100;

/**
 * The plan being drawn: what is on it, the selection, undo and redo, and saving.
 *
 * Every change goes through {@link PlannerStore.change}: the server checks the plan as it would
 * be against the rules of the event hall, and a change that breaks one is not made; the toast
 * says which rule. So the plan held here never breaks a rule the server knows of.
 */
@Injectable()
export class PlannerStore {
  private readonly api = inject(PlansApi);
  private readonly notifier = inject(Notifier);

  private target = { slug: '', eventId: '', hallId: '' };
  readonly view = signal<PlannerView | null>(null);
  readonly plan = signal<PlanContent>(EMPTY);
  readonly selection = signal<Selection | null>(null);
  readonly revision = signal(0);
  /** The published revision, if any. */
  readonly published = signal<StallPlanView['published']>(null);
  /** Saved, and that saved revision is the published one. */
  readonly upToDate = computed(
    () => !this.dirty() && this.revision() > 0 && this.published()?.revision === this.revision(),
  );
  readonly dirty = signal(false);
  /** Goes up when a change is refused, so fields that showed it go back to the plan. */
  readonly refused = signal(0);
  /** A check or save is running; tools wait for it. */
  readonly busy = signal(false);

  private readonly undoStack = signal<PlanContent[]>([]);
  private readonly redoStack = signal<PlanContent[]>([]);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  readonly canEdit = computed(() => this.view()?.canEdit ?? false);
  readonly floor = computed<PlannerFloor | null>(() => {
    const v = this.view();
    return v ? plannerFloor(v.hall.floor) : null;
  });
  /** The categories this hall sells; inactive ones only where already used. */
  readonly categories = computed<CategoryRef[]>(() => this.view()?.hall.categories ?? []);
  readonly categoryName = computed(
    () => new Map(this.categories().map((c) => [c.id, c.name] as const)),
  );

  readonly selectedZone = computed(() => this.selected('zone', this.plan().zones));
  readonly selectedStalls = computed(() => this.selectedAll('stall', this.plan().stalls));
  readonly selectedSeats = computed(() => this.selectedAll('seat', this.plan().seats));
  readonly selectedObjects = computed(() => this.selectedAll('object', this.plan().objects));

  load(slug: string, eventId: string, hallId: string, view: PlannerView): void {
    this.target = { slug, eventId, hallId };
    this.view.set(view);
    this.published.set(view.plan.published);
    const { zones, stalls, seats, revision } = view.plan;
    // A plan saved before drawings existed has none.
    const objects = view.plan.objects ?? [];
    this.plan.set({ zones, stalls, seats, objects });
    this.revision.set(revision);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.selection.set(null);
    this.dirty.set(false);
  }

  /**
   * Makes a change when it breaks no rule. `changed` are the ids added or altered; findings
   * about them, or about the whole plan, refuse the change. Returns whether it was made.
   */
  async change(next: PlanContent, changed: string[], select?: Selection | null): Promise<boolean> {
    const findings = await this.check(next, changed);
    if (findings === null) return false;
    if (findings.length) {
      this.refuse(findings);
      return false;
    }
    this.commit(next, select);
    return true;
  }

  /**
   * Adds many stalls or seats at once (the auto-fill tools): those that break a rule are left
   * out, and the rest are added as one undo step. A rule broken by the plan as a whole refuses
   * them all. Returns how many were added and left out.
   */
  async addPassing(add: {
    stalls?: PlanStall[];
    seats?: PlanSeat[];
  }): Promise<{ added: number; dropped: number } | null> {
    const base = this.plan();
    let stalls = add.stalls ?? [];
    let seats = add.seats ?? [];
    const total = stalls.length + seats.length;
    for (let round = 0; round < 4 && stalls.length + seats.length; round++) {
      const next = {
        ...base,
        stalls: [...base.stalls, ...stalls],
        seats: [...base.seats, ...seats],
      };
      const ids = [...stalls, ...seats].map((i) => i.id);
      const findings = await this.check(next, ids);
      if (findings === null) return null;
      if (!findings.length) {
        const kind = stalls.length ? 'stall' : 'seat';
        this.commit(next, { kind, ids });
        return { added: ids.length, dropped: total - ids.length };
      }
      const whole = findings.find((f) => !f.ids.length);
      if (whole) {
        this.refuse([whole]);
        return null;
      }
      const bad = new Set(findings.flatMap((f) => f.ids));
      stalls = stalls.filter((s) => !bad.has(s.id));
      seats = seats.filter((s) => !bad.has(s.id));
    }
    this.notifier.warn(
      stalls.length + seats.length
        ? 'Nothing was added: the places kept breaking rules of this hall. Try a smaller fill.'
        : 'Nothing was added: every place breaks a rule of this hall.',
    );
    return null;
  }

  /** Removing never breaks a rule the plan kept, so it needs no check. */
  remove(next: PlanContent): void {
    this.commit(next, null);
  }

  /** The findings about `changed` were the plan to become `next`; null when the check failed. */
  async check(next: PlanContent, changed: string[]): Promise<PlanFinding[] | null> {
    this.busy.set(true);
    try {
      const { slug, eventId, hallId } = this.target;
      return await firstValueFrom(this.api.check(slug, eventId, hallId, next, changed));
    } catch {
      // The error interceptor has shown it.
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  /** Says why a change was not made: the first broken rule, and how many more. */
  refuse(findings: PlanFinding[]): void {
    this.refused.update((n) => n + 1);
    const more = findings.length - 1;
    this.notifier.warn(
      `Not done: ${findings[0].message}${more ? ` (${more} more ${more === 1 ? 'rule' : 'rules'} broken)` : ''}`,
    );
  }

  undo(): void {
    const stack = this.undoStack();
    if (!stack.length) return;
    this.redoStack.update((r) => [...r, this.plan()]);
    this.plan.set(stack[stack.length - 1]);
    this.undoStack.set(stack.slice(0, -1));
    this.afterHistoryMove();
  }

  redo(): void {
    const stack = this.redoStack();
    if (!stack.length) return;
    this.undoStack.update((u) => [...u, this.plan()]);
    this.plan.set(stack[stack.length - 1]);
    this.redoStack.set(stack.slice(0, -1));
    this.afterHistoryMove();
  }

  async save(): Promise<boolean> {
    const { slug, eventId, hallId } = this.target;
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.save(slug, eventId, hallId, this.plan(), this.revision()),
      );
      this.revision.set(saved.revision);
      this.dirty.set(false);
      this.notifier.success('Stall plan saved.');
      return true;
    } catch {
      // The error interceptor has shown it.
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Publishes the saved plan, after the server checks it against the rules again. */
  async publish(): Promise<boolean> {
    const { slug, eventId, hallId } = this.target;
    this.busy.set(true);
    try {
      const done = await firstValueFrom(this.api.publish(slug, eventId, hallId, this.revision()));
      this.published.set(done.published);
      this.notifier.success(`Stall plan published (version ${done.revision}).`);
      return true;
    } catch {
      // The error interceptor has shown it.
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  select(selection: Selection | null): void {
    this.selection.set(selection?.ids.length ? selection : null);
  }

  // ---- helpers ------------------------------------------------------------------------------

  private commit(next: PlanContent, select?: Selection | null): void {
    this.undoStack.update((u) => [...u.slice(-HISTORY + 1), this.plan()]);
    this.redoStack.set([]);
    this.plan.set(next);
    this.dirty.set(true);
    if (select !== undefined) this.select(select);
    else this.dropMissingSelection();
  }

  private afterHistoryMove(): void {
    this.dirty.set(true);
    this.dropMissingSelection();
  }

  private dropMissingSelection(): void {
    const s = this.selection();
    if (!s) return;
    const list: Array<{ id: string }> =
      s.kind === 'zone'
        ? this.plan().zones
        : s.kind === 'stall'
          ? this.plan().stalls
          : s.kind === 'object'
            ? this.plan().objects
            : this.plan().seats;
    const have = new Set(list.map((i) => i.id));
    this.select({ kind: s.kind, ids: s.ids.filter((id) => have.has(id)) });
  }

  private selected(kind: 'zone', list: PlanZone[]): PlanZone | null {
    const s = this.selection();
    return s?.kind === kind && s.ids.length === 1
      ? (list.find((z) => z.id === s.ids[0]) ?? null)
      : null;
  }

  private selectedAll<T extends PlanStall | PlanSeat | PlanObject>(
    kind: SelectionKind,
    list: T[],
  ): T[] {
    const s = this.selection();
    if (s?.kind !== kind) return [];
    const ids = new Set(s.ids);
    return list.filter((i) => ids.has(i.id));
  }
}
