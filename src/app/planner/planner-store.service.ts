import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

import { extractErrorMessage } from '../core/http-error.util';
import { ExcelImportResult } from './excel/excel-layout.service';
import {
  hallSize,
  normalizeStall,
  num,
  overlaps,
  snapValue,
  validGate,
  withinHall
} from './geometry/planner-geometry';
import { buildApiPayload, LayoutApiService } from './layout-api.service';
import { Hall, HallShape } from './models/hall.model';
import { LayoutSummary } from './models/layout.model';
import { GateSide, Stall } from './models/stall.model';

/** Values collected by the Create Hall form. */
export interface HallFormValue {
  name: string;
  shape: HallShape;
  w: number;
  l: number;
  r: number;
}

/** Values collected by the Add Shop form. */
export interface NewStallValue {
  name: string;
  width: number;
  length: number;
  height: number;
  color: string;
  gateSide: GateSide;
}

/** How long a visible error stays on screen. App.js:498. */
const ERROR_TIMEOUT_MS = 4500;

/** The two halls the React app starts with. App.js:480. */
function defaultHalls(): Hall[] {
  return [
    { id: 1, name: 'Main Exhibition Hall A', shape: 'SQUARE', width: 40, length: 40, radius: 0 },
    { id: 2, name: 'Premium Circular Lounge', shape: 'CIRCLE', width: 0, length: 0, radius: 20 }
  ];
}

/**
 * All planner state and every state transition, ported from the React
 * component's useState block and handlers (App.js:479-577).
 *
 * Signals replace useState; computed replaces the derived constants.
 * Decision FD-003: no NgRx - the state is feature-scoped to one screen.
 */
@Injectable()
export class PlannerStore {
  private readonly api = inject(LayoutApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly halls = signal<Hall[]>(defaultHalls());
  readonly activeHallId = signal<string | number>(1);
  readonly stalls = signal<Stall[]>([]);
  readonly savedLayouts = signal<LayoutSummary[]>([]);
  readonly selectedSavedId = signal<string | number | null>(null);
  readonly selectedStallId = signal<string | number | null>(null);
  readonly dragging = signal(false);
  readonly snap = signal(true);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly layoutName = signal('');

  readonly currentHall = computed(() =>
    this.halls().find(h => String(h.id) === String(this.activeHallId()))
  );

  readonly currentStalls = computed(() =>
    this.stalls().filter(s => String(s.hallId) === String(this.activeHallId()))
  );

  readonly selectedStall = computed(() =>
    this.stalls().find(s => String(s.id) === String(this.selectedStallId()))
  );

  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // React leaks its setTimeout on unmount; clearing it here is the Phase 10
    // cleanup requirement and changes no visible behaviour.
    this.destroyRef.onDestroy(() => this.clearErrorTimer());
  }

  // --- notifications -------------------------------------------------------

  /** Show an error for 4500 ms. App.js:498. */
  showError(message: string): void {
    this.error.set(message);
    this.clearErrorTimer();
    this.errorTimer = setTimeout(() => {
      this.error.set('');
      this.errorTimer = null;
    }, ERROR_TIMEOUT_MS);
  }

  private clearErrorTimer(): void {
    if (this.errorTimer !== null) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
  }

  // --- selection -----------------------------------------------------------

  /** Switching halls clears the stall selection. App.js:583. */
  setActiveHall(id: string | number): void {
    this.activeHallId.set(id);
    this.selectedStallId.set(null);
  }

  selectStall(id: string | number | null): void {
    this.selectedStallId.set(id);
  }

  setDragging(value: boolean): void {
    this.dragging.set(value);
  }

  setSnap(value: boolean): void {
    this.snap.set(value);
  }

  setLayoutName(value: string): void {
    this.layoutName.set(value);
  }

  // --- stall transitions ---------------------------------------------------

  /** Patch one stall in place. App.js:502. */
  updateStall(id: string | number, patch: Partial<Stall>): void {
    this.stalls.update(prev =>
      prev.map(s => (String(s.id) === String(id) ? { ...s, ...patch } : s))
    );
  }

  /**
   * Move a stall, honouring the snap setting and rejecting moves that leave
   * the hall or collide with another stall. App.js:503-510.
   */
  moveStall(id: string | number, x: number, z: number): void {
    const s = this.stalls().find(v => String(v.id) === String(id));
    const currentHall = this.currentHall();
    if (!s || !currentHall) return;

    const useSnap = this.snap();
    const nx = useSnap ? snapValue(x) : x;
    const nz = useSnap ? snapValue(z) : z;
    const candidate: Stall = { ...s, posX: nx, posZ: nz };

    if (!withinHall(currentHall, candidate, nx, nz)) {
      this.showError('⚠️ Shop cannot move outside the hall boundary.');
      return;
    }

    if (overlaps(candidate, this.currentStalls(), id)) {
      this.showError('⚠️ Shop overlaps another shop. Move it to a free grid position.');
      return;
    }

    this.updateStall(id, { posX: nx, posZ: nz });
  }

  /** Validate and normalize the selected stall. App.js:511-516. */
  saveEdit(): void {
    const selected = this.selectedStall();
    if (!selected) return;

    const candidate: Stall = { ...selected };
    const currentHall = this.currentHall();

    if (
      !withinHall(currentHall, candidate) ||
      overlaps(candidate, this.currentStalls(), selected.id)
    ) {
      this.showError('⚠️ Updated shop position/dimensions are invalid or overlap another shop.');
      return;
    }

    this.updateStall(selected.id, {
      name: selected.name || 'Shop',
      width: num(selected.width, 5),
      length: num(selected.length, 5),
      height: num(selected.height, 4),
      gateSide: validGate(selected.gateSide)
    });
  }

  /**
   * Add a stall at the first free grid position, scanning from -Z/-X.
   * App.js:517-527. Returns the created stall, or null when the hall is full
   * so the caller can skip its own follow-up work.
   */
  addStall(form: NewStallValue): Stall | null {
    const currentHall = this.currentHall();
    if (!currentHall) return null;

    const currentStalls = this.currentStalls();

    const base = {
      ...form,
      width: num(form.width, 5),
      length: num(form.length, 5),
      height: num(form.height, 4),
      posX: 0,
      posZ: 0,
      gateSide: validGate(form.gateSide),
      hallId: this.activeHallId(),
      name: form.name.trim() || `Shop ${currentStalls.length + 1}`
    };

    let pos: { x: number; z: number } | null = null;
    const { width, length } = hallSize(currentHall);
    const maxX = Math.floor(width / 2 - base.width / 2);
    const maxZ = Math.floor(length / 2 - base.length / 2);

    for (let z = -maxZ; z <= maxZ && !pos; z += 1) {
      for (let x = -maxX; x <= maxX && !pos; x += 1) {
        if (
          withinHall(currentHall, base, x, z) &&
          !overlaps({ ...base, posX: x, posZ: z }, currentStalls)
        ) {
          pos = { x, z };
        }
      }
    }

    if (!pos) {
      this.showError('⚠️ No free grid position is available for this shop.');
      return null;
    }

    const stall: Stall = {
      ...base,
      posX: pos.x,
      posZ: pos.z,
      id: `local-${Date.now()}-${Math.random()}`
    };

    this.stalls.update(p => [...p, stall]);
    this.selectedStallId.set(stall.id);
    return stall;
  }

  /** App.js:528. */
  deleteStall(id: string | number): void {
    this.stalls.update(p => p.filter(s => String(s.id) !== String(id)));
    if (String(this.selectedStallId()) === String(id)) {
      this.selectedStallId.set(null);
    }
  }

  // --- hall transitions ----------------------------------------------------

  /** App.js:529. */
  createHall(form: HallFormValue): Hall {
    const id = `hall-${Date.now()}`;
    const hall: Hall = {
      id,
      name: form.name.trim() || `Custom Hall ${this.halls().length + 1}`,
      shape: form.shape,
      width: form.shape === 'SQUARE' ? num(form.w, 40) : 0,
      length: form.shape === 'SQUARE' ? num(form.l, 40) : 0,
      radius: form.shape === 'CIRCLE' ? num(form.r, 20) : 0
    };

    this.halls.update(p => [...p, hall]);
    this.activeHallId.set(id);
    this.layoutName.set(hall.name);
    return hall;
  }

  /** Apply a parsed workbook to state. App.js:544. */
  applyExcelImport(result: ExcelImportResult): void {
    const { hall, valid } = result;

    this.halls.update(p => [...p, hall]);
    this.activeHallId.set(hall.id);
    this.stalls.update(p => [...p.filter(s => String(s.hallId) !== String(hall.id)), ...valid]);
    this.selectedStallId.set(valid[0]?.id ?? null);
    this.layoutName.set(hall.name);
  }

  // --- saved layout workflow ----------------------------------------------

  /** App.js:499. A failed list stays silent, exactly as in React. */
  async loadList(): Promise<void> {
    try {
      this.savedLayouts.set(await this.api.list());
    } catch (e) {
      console.warn('Layout list unavailable:', extractErrorMessage(e));
    }
  }

  /** App.js:570-574. */
  async saveLayout(): Promise<void> {
    if (!this.currentHall()) return;

    this.busy.set(true);
    this.error.set('');

    try {
      const payload = buildApiPayload(this.currentHall(), this.currentStalls(), this.layoutName());
      const saved = await this.api.save(payload);
      this.selectedSavedId.set(saved.layout?.id ?? saved.id ?? null);
      await this.loadList();
      window.alert('✅ Layout saved successfully.');
    } catch (e) {
      this.showError(`❌ Save Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** App.js:575. */
  async openLayout(id: string | number): Promise<void> {
    this.busy.set(true);

    try {
      const d = await this.api.open(id);
      const h = d.hall;
      if (!h) throw new Error('Saved layout does not contain hall data.');

      this.halls.update(p => [...p.filter(x => String(x.id) !== String(h.id)), h]);
      this.activeHallId.set(h.id);
      this.stalls.update(p => [
        ...p.filter(s => String(s.hallId) !== String(h.id)),
        ...(d.stalls || []).map(s => normalizeStall(s, h.id))
      ]);
      this.selectedStallId.set(null);
      this.selectedSavedId.set(id);
      this.layoutName.set(d.layout?.name || d.name || h.name || '');
    } catch (e) {
      this.showError(`❌ Open Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** App.js:576. Native confirm is kept deliberately (decision FD-008). */
  async deleteLayout(id: string | number): Promise<void> {
    if (!window.confirm('Delete this saved layout?')) return;

    try {
      await this.api.delete(id);
      this.savedLayouts.update(p => p.filter(x => String(x.id) !== String(id)));
      if (String(this.selectedSavedId()) === String(id)) {
        this.selectedSavedId.set(null);
      }
      window.alert('✅ Layout deleted.');
    } catch (e) {
      this.showError(`❌ Delete Error: ${extractErrorMessage(e)}`);
    }
  }

  /** App.js:577. */
  async updateLayout(): Promise<void> {
    const savedId = this.selectedSavedId();
    if (!savedId) {
      this.showError('Select/open a saved layout first.');
      return;
    }

    this.busy.set(true);

    try {
      const payload = buildApiPayload(this.currentHall(), this.currentStalls(), this.layoutName());
      await this.api.update(savedId, payload);
      await this.loadList();
      window.alert('✅ Layout updated successfully.');
    } catch (e) {
      this.showError(`❌ Update Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }
}
