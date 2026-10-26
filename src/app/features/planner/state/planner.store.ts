import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { NotifierService } from '../../../core/notification/notifier.service';
import { PlansApiService } from '../data/plans-api.service';
import type { CategoryRef } from '../domain/planner-hall.models';
import type { RateCardView } from '../domain/rate-card.models';
import { plannerFloor, PlannerFloor } from '../domain/planner-geometry';
import type {
  PlanContent,
  PlanFinding,
  PlannerView,
  PlanObject,
  PlanPricing,
  PlanSeat,
  PlanStall,
  PlanZone,
  StallPlanView,
} from '../domain/plan.models';
import { forSale, stallPrice, StallPrice } from '../domain/stall-price';

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
  private readonly api = inject(PlansApiService);
  private readonly notifier = inject(NotifierService);

  private target = { eventId: '', hallId: '' };
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
  /** When the plan was last saved: from the server on opening, and again after each save. */
  readonly savedAt = signal<Date | null>(null);
  /** Goes up when a change is refused, so fields that showed it go back to the plan. */
  readonly refused = signal(0);
  /** Why the last change was refused, as the toast said it; the assistant reports it. */
  readonly lastRefusal = signal<string | null>(null);
  /** A check or save is running; tools wait for it. */
  readonly busy = signal(false);

  private readonly undoStack = signal<PlanContent[]>([]);
  private readonly redoStack = signal<PlanContent[]>([]);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  readonly canEdit = computed(() => this.view()?.canEdit ?? false);

  /** The stalls' prices as saved; null when this member may not see prices. */
  readonly pricing = signal<PlanPricing | null>(null);
  /** Sets the rate card the stalls are priced by (after it is opened or saved). */
  setRateCard(card: RateCardView): void {
    this.pricing.set({
      card: card.card,
      prices: [],
      canManage: card.canManage,
      readOnlyReason: card.readOnlyReason,
    });
  }

  /** Each stall's price as the plan is now, unsaved changes too; null: none. */
  readonly prices = computed(() => {
    const pricing = this.pricing();
    const out = new Map<string, StallPrice | null>();
    if (!pricing) return out;
    const own = new Map(pricing.prices.map((p) => [p.stallId, p] as const));
    for (const s of this.plan().stalls) {
      // A price set on the stall comes before the rate card's.
      const alone = s.price != null ? { price: s.price, note: null } : own.get(s.id);
      out.set(s.id, stallPrice(s, pricing.card, alone));
    }
    return out;
  });
  /** Stalls for sale with no price yet. */
  readonly unpriced = computed(() =>
    this.pricing() ? this.plan().stalls.filter((s) => forSale(s) && !this.prices().get(s.id)) : [],
  );
  /** ₹ of every priced stall, before GST. */
  readonly planValue = computed(() =>
    [...this.prices().values()].reduce((sum, p) => sum + (p?.price ?? 0), 0),
  );
  /** Apart from `floor` so that a refresh of the view's flags does not rebuild the canvas. */
  private readonly hallFloor = computed(() => this.view()?.hall.floor ?? null);
  readonly floor = computed<PlannerFloor | null>(() => {
    const floor = this.hallFloor();
    return floor ? plannerFloor(floor) : null;
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

  load(eventId: string, hallId: string, view: PlannerView): void {
    this.target = { eventId, hallId };
    this.view.set(view);
    this.published.set(view.plan.published);
    this.pricing.set(view.pricing ?? null);
    const { zones, stalls, seats, revision } = view.plan;
    // A plan saved before drawings existed has none.
    const objects = view.plan.objects ?? [];
    this.plan.set({ zones, stalls, seats, objects });
    this.revision.set(revision);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.selection.set(null);
    this.dirty.set(false);
    this.savedAt.set(view.plan.updatedAt ? new Date(view.plan.updatedAt) : null);
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
  async addPassing(
    add: {
      stalls?: PlanStall[];
      seats?: PlanSeat[];
    },
    /** Booths taken away in the same step: a plan made afresh replaces them. */
    replacing: ReadonlySet<string> = new Set(),
  ): Promise<{ added: number; dropped: number } | null> {
    const now = this.plan();
    const base = replacing.size
      ? { ...now, stalls: now.stalls.filter((s) => !replacing.has(s.id)) }
      : now;
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

  /**
   * Back to a plan this store held before (the assistant's "Undo"), as one undo step. That plan
   * passed the rules when it was made, so it needs no check.
   */
  restore(earlier: PlanContent): void {
    this.commit(earlier, null);
  }

  /** The findings about `changed` were the plan to become `next`; null when the check failed. */
  async check(next: PlanContent, changed: string[]): Promise<PlanFinding[] | null> {
    this.busy.set(true);
    try {
      const { eventId, hallId } = this.target;
      return await firstValueFrom(this.api.check(eventId, hallId, next, changed));
    } catch (error) {
      this.notifier.fromError(error, 'The plan could not be checked');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  /** Says why a change was not made: the first broken rule, and how many more. */
  refuse(findings: PlanFinding[]): void {
    this.refused.update((n) => n + 1);
    const more = findings.length - 1;
    const message = `${findings[0].message}${more ? ` (${more} more ${more === 1 ? 'rule' : 'rules'} broken)` : ''}`;
    this.lastRefusal.set(message);
    this.notifier.warn(`Not done: ${message}`);
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
    const { eventId, hallId } = this.target;
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.save(eventId, hallId, this.plan(), this.revision()),
      );
      this.revision.set(saved.revision);
      this.savedAt.set(new Date());
      this.dirty.set(false);
      await this.refreshFlags();
      this.notifier.success('Stall plan saved.');
      return true;
    } catch (error) {
      this.notifier.fromError(error, 'The plan could not be saved');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * External events: sends the plan for approval, takes it back, or (the venue) approves it or
   * sends it back. Who may edit changes with each, so the planner opens again afterwards.
   */
  async review(
    step: 'submit' | 'withdraw' | 'approve' | 'reject' | 'reopen',
    note = '',
    files: File[] = [],
  ): Promise<boolean> {
    const { eventId, hallId } = this.target;
    const sent = this.view()?.plan.review?.revision ?? this.revision();
    const calls = {
      submit: () => this.api.submit(eventId, hallId, this.revision()),
      withdraw: () => this.api.withdraw(eventId, hallId),
      approve: () => this.api.approve(eventId, hallId, sent),
      reject: () => this.api.reject(eventId, hallId, sent, note, files),
      reopen: () => this.api.reopen(eventId, hallId),
    };
    const done = {
      submit: 'Sent to ITPO for approval.',
      withdraw: 'Taken back. You can change the plan again.',
      approve: 'Approved. The organiser can publish it now.',
      reject: 'Sent back to the organiser with your note.',
      reopen: 'Reopened. The organiser can change the plan and send it again.',
    };
    this.busy.set(true);
    try {
      await firstValueFrom(calls[step]());
      this.load(eventId, hallId, await firstValueFrom(this.api.get(eventId, hallId)));
      this.notifier.success(done[step]);
      return true;
    } catch (error) {
      this.notifier.fromError(error, 'The step could not be done');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Publishes the saved plan, after the server checks it against the rules again. */
  async publish(): Promise<boolean> {
    const { eventId, hallId } = this.target;
    this.busy.set(true);
    try {
      const done = await firstValueFrom(this.api.publish(eventId, hallId, this.revision()));
      this.published.set(done.published);
      await this.refreshFlags();
      this.notifier.success(`Stall plan published (version ${done.revision}).`);
      return true;
    } catch (error) {
      // A 409 is a refusal to read, not a failure: a booked stall would change, or the plan was
      // saved meanwhile. The message names each stall it is about.
      if (error instanceof ApiError && error.code === 409) this.notifier.warn(error.message);
      else this.notifier.fromError(error, 'The plan was not published');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  select(selection: Selection | null): void {
    this.selection.set(selection?.ids.length ? selection : null);
  }

  // ---- helpers ------------------------------------------------------------------------------

  /**
   * An external event's flags (publish, send for approval) follow the saved revision, which a
   * save or a publish just changed. Only the flags and the plan's review are taken from the
   * server: {@link PlannerStore.load} would also empty the undo history and the selection, and
   * the hall is kept as it is so the canvas does not refit. Internal events' flags do not move.
   */
  private async refreshFlags(): Promise<void> {
    if (!this.view()?.needsApproval) return;
    const { eventId, hallId } = this.target;
    try {
      const fresh = await firstValueFrom(this.api.get(eventId, hallId));
      this.view.update(
        (v) =>
          v && {
            ...v,
            readOnlyReason: fresh.readOnlyReason,
            canEdit: fresh.canEdit,
            canPublish: fresh.canPublish,
            canSubmit: fresh.canSubmit,
            canWithdraw: fresh.canWithdraw,
            canApprove: fresh.canApprove,
            plan: { ...v.plan, review: fresh.plan.review, published: fresh.plan.published },
          },
      );
      this.published.set(fresh.plan.published);
    } catch {
      // The save or publish went through; the page reload brings the flags right.
    }
  }

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
