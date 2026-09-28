import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

import { extractErrorMessage, extractViolations } from '../core/http-error.util';
import { NotifyService } from '../core/notify.service';
import { ExcelImportResult } from './excel/excel-layout.service';
import { FreeSpaceMap } from './geometry/free-space';
import { previewSplit, SplitOptions } from './geometry/stall-split';
import { GridSystem } from './geometry/grid-system';
import { isRuleDriven, placementContextFor } from './geometry/hall-rules';
import {
  AuditEntry,
  auditLayout,
  effectiveRules,
  Footprint,
  PlacementStall,
  footprintRect,
  Point,
  Rect,
  validatePlacement,
  Violation,
  ViolationGeometry
} from './geometry/placement-rules';
import {
  normalizeOpenSides,
  normalizeStall,
  num,
  overlaps,
  snapValue,
  validGate
} from './geometry/planner-geometry';
import { blockedInPlan, planBounds, withinPlan } from './geometry/hall-plan';
import { normalizeFootprint, sidesOfEdges } from './geometry/stall-footprint';
import {
  applySelfcareLayout,
  hallFromSelfcare,
  SelfcareLayoutRow,
  unwrapSelfcareData
} from './geometry/selfcare-layout';
import { buildApiPayload, LayoutApiService } from './layout-api.service';
import { EventType, Hall, HallShape, StallType } from './models/hall.model';
import { LayoutSummary, ServerViolation } from './models/layout.model';
import { GateSide, Stall, StallInput } from './models/stall.model';

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
  rotation?: number;
  name: string;
  width: number;
  length: number;
  height: number;
  color: string;
  gateSide: GateSide;
  openSides?: GateSide[];
}

/** Select = click/drag existing stalls. Draw = drag on the grid to create a stall. */
export type EditorMode = 'select' | 'draw';

/** The live stall preview while hovering or dragging in draw mode. */
export interface StallDraft {
  footprint: Footprint;
  valid: boolean;
  violations: Violation[];
  /** false while only hovering; true between pointer down and up. */
  dragging: boolean;
  start: Point;
}

/** A placement that was just rejected: what, where, and the nearest spot that would work. */
export interface PlacementFeedback {
  title: string;
  footprint: Footprint;
  violations: Violation[];
  /** Nearest valid position for the same size, or null when no contiguous space is left. */
  suggestion: Footprint | null;
}

/** A camera focus request; `seq` makes repeated requests for the same area distinct. */
export interface FocusTarget {
  rect: Rect;
  seq: number;
}

/** Everything the 3D scene draws on top of the hall and the stalls. */
export interface EditorOverlay {
  draft: StallDraft | null;
  /** Red geometry: where the current draft, rejection or live move is wrong. */
  violations: ViolationGeometry[];
  suggestion: Footprint | null;
  /** Placements where the selected stall size fits ("Show free space"). */
  freeSpace: Footprint[] | null;
  /** Amber highlight of one problem the user asked to locate. */
  highlight: ViolationGeometry[];
  /** Passage width drawn as a halo around the draft or the stall being moved. */
  passageWidth: number | null;
  /** A plan from the Assist tab, shown as outlines until it is applied. */
  proposals: ReadonlyArray<{ footprint: Footprint; valid: boolean; label?: string }> | null;
}

/** One stall of a proposed plan, with the result of checking it against this hall. */
export interface ProposedStall {
  footprint: Footprint;
  name: string;
  height: number;
  color: string;
  openSides: GateSide[];
  valid: boolean;
  violations: Violation[];
}

/** A stall as the assistant returns it, before it has been checked against anything. */
export interface PlannedStall {
  rotation?: number;
  name?: string;
  width: number;
  length: number;
  height?: number;
  posX: number;
  posZ: number;
  color?: string;
  openSides?: GateSide[];
}

/**
 * Where the hall list request stands. `empty` = the server answered with no halls and
 * `unavailable` = it did not answer; both leave the offline fallback hall in place.
 */
export type HallsStatus = 'loading' | 'ready' | 'empty' | 'unavailable';

/** Where the saved layout list request stands. */
export type ListStatus = 'loading' | 'ready' | 'error';

/** How long a visible error stays on screen. App.js:498. */
const ERROR_TIMEOUT_MS = 4500;

const FALLBACK_HALL_ID = 'local-fallback-hall';

/** A quarter turn clockwise seen from above: the side that faced +Z now faces +X. */
const ROTATED_SIDE: Record<GateSide, GateSide> = {
  FRONT: 'RIGHT',
  RIGHT: 'BACK',
  BACK: 'LEFT',
  LEFT: 'FRONT'
};

/**
 * The halls shown before `GET /api/halls` answers, and the fallback if it never does.
 *
 * The React app started from two invented halls (App.js:480). The planner now loads real halls
 * from the backend instead; this single local hall exists only so the 3D view is never blank
 * while that request is in flight, or if the API is unreachable during a demo. It is named so
 * that nobody mistakes it for real master data.
 */
function fallbackHalls(): Hall[] {
  return [
    { id: FALLBACK_HALL_ID, name: 'Sample Hall (offline)', shape: 'SQUARE', width: 40, length: 40, radius: 0 }
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
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);

  readonly halls = signal<Hall[]>(fallbackHalls());
  readonly activeHallId = signal<string | number>(fallbackHalls()[0].id);
  readonly stalls = signal<Stall[]>([]);
  readonly savedLayouts = signal<LayoutSummary[]>([]);
  readonly selectedSavedId = signal<string | number | null>(null);
  readonly selectedStallId = signal<string | number | null>(null);
  readonly dragging = signal(false);
  readonly snap = signal(true);
  // Repeating the same rejected action must show a fresh notification too.
  readonly error = signal('', { equal: () => false });
  readonly busy = signal(false);
  readonly layoutName = signal('');
  /** Shown in the sidebar so the offline fallback hall is never mistaken for real data. */
  readonly hallsStatus = signal<HallsStatus>('loading');
  /** Drives the loading and error states of the saved layout list. */
  readonly listStatus = signal<ListStatus>('loading');

  // --- rule-driven editor state -------------------------------------------

  readonly mode = signal<EditorMode>('select');
  /** Offered stall sizes, from GET /api/stall-types. */
  readonly stallTypes = signal<StallType[]>([]);
  /** null = Custom (the dragged rectangle is the stall). */
  readonly selectedStallTypeId = signal<string | null>(null);
  readonly eventType = signal<EventType>('B2B');
  readonly draftOpenSide = signal<GateSide>('FRONT');
  readonly passageWidth = computed(() => this.placementContext()?.rules.minPassageWidth[this.eventType()] ?? 3);
  readonly showFreeSpace = signal(false);
  readonly showClearances = signal(true);
  readonly draft = signal<StallDraft | null>(null);
  readonly rejection = signal<PlacementFeedback | null>(null);
  /** Violations the server returned for the last failed save/update. */
  readonly serverViolations = signal<ServerViolation[]>([]);
  /** Result of the last server-side audit (POST /api/layout/{id}/validate). */
  readonly serverAudit = signal<AuditEntry[] | null>(null);
  readonly focusTarget = signal<FocusTarget | null>(null);
  /** The Assist tab's plan, checked but not applied. Drawn as outlines on the 3D view. */
  readonly proposals = signal<ProposedStall[] | null>(null);
  /** A request to open the PDF plan import, with the file when one was already picked. */
  readonly pdfImport = signal<{ file: File | null } | null>(null);
  readonly splitOptions = signal<SplitOptions | null>(null);
  readonly splitPreview = computed(() => {
    const parent = this.selectedStall(), options = this.splitOptions(), ctx = this.placementContext();
    return parent && options && ctx ? previewSplit(parent, options, ctx) : null;
  });
  readonly canConfirmSplit = computed(() => {
    const preview = this.splitPreview(), parent = this.selectedStall();
    return !!preview && !preview.error && !preview.violations.length && !!parent?.stallNumber &&
      Number.isFinite(Number(parent.id)) && this.selectedSavedId() !== null && !this.busy();
  });
  private splitRequest: { key: string; id: string } | null = null;
  readonly highlight = signal<ViolationGeometry[]>([]);
  /** Live problems of the stall being dragged in a rule-driven hall. */
  private readonly moveCheck = signal<Violation[]>([]);
  private dragOrigin: { id: string | number; posX: number; posZ: number } | null = null;
  private focusSeq = 0;

  readonly currentHall = computed(() =>
    this.halls().find(h => String(h.id) === String(this.activeHallId()))
  );

  readonly currentStalls = computed(() =>
    this.stalls().filter(s => String(s.hallId) === String(this.activeHallId()))
  );

  readonly selectedStall = computed(() =>
    this.stalls().find(s => String(s.id) === String(this.selectedStallId()))
  );

  /** Stalls that occupy space. A cancelled stall keeps its number but frees its area. */
  readonly activeStalls = computed(() => this.currentStalls().filter(s => s.status !== 'CANCELLED'));

  /** The current hall is edited through the placement rules. */
  readonly ruleDriven = computed(() => isRuleDriven(this.currentHall()));

  /** The one coordinate system of the current hall (rendering, pointer, snapping, validation). */
  readonly grid = computed(() => {
    const hall = this.currentHall();
    return hall ? GridSystem.forHall(hall) : null;
  });

  readonly placementContext = computed(() => {
    const hall = this.currentHall();
    return isRuleDriven(hall) ? placementContextFor(hall, this.currentStalls(), this.eventType()) : null;
  });

  readonly selectedStallType = computed(
    () => this.stallTypes().find(t => t.id === this.selectedStallTypeId()) ?? null
  );

  /** Every rule problem in the current layout. Reported, never blocking (existing layouts). */
  readonly audit = computed<AuditEntry[]>(() => {
    const ctx = this.placementContext();
    return ctx ? auditLayout(ctx) : [];
  });

  /** "Show free space": every valid position of the selected size (3 x 2 when Custom). */
  readonly freeSpace = computed<Footprint[] | null>(() => {
    const ctx = this.placementContext();
    const grid = this.grid();
    if (!this.showFreeSpace() || !ctx || !grid) return null;

    const type = this.selectedStallType() ?? this.stallTypes()[0];
    const [w, l] = type ? [type.width, type.height] : [3, 2];
    return new FreeSpaceMap(grid, ctx).validPlacements(w, l, null, [this.draftOpenSide()]);
  });

  readonly overlay = computed<EditorOverlay>(() => {
    const draft = this.draft();
    const rejection = this.rejection();
    const ctx = this.placementContext();
    const geometry = (list: Violation[]): ViolationGeometry[] => list.flatMap(v => v.geometry);

    return {
      draft,
      violations: [
        ...geometry(draft?.violations ?? []),
        ...geometry(rejection?.violations ?? []),
        ...geometry(this.moveCheck()),
        ...this.audit().flatMap(entry => geometry(entry.violations)),
        ...geometry(this.splitPreview()?.violations ?? [])
      ],
      suggestion: rejection?.suggestion ?? null,
      freeSpace: this.freeSpace(),
      highlight: this.highlight(),
      passageWidth:
        ctx && (draft || this.dragging()) ? ctx.rules.minPassageWidth[ctx.eventType] : null,
      proposals: this.splitPreview()?.children.map(s => ({ footprint: s, label: `${s.stallNumber} (preview)`,
        valid: !this.splitPreview()?.violations.length })) ?? this.proposals()
    };
  });

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

  /** Close the visible error before its timeout runs out. */
  dismissError(): void {
    this.clearErrorTimer();
    this.error.set('');
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
    this.clearFeedback();
  }

  selectStall(id: string | number | null): void {
    this.splitOptions.set(null);
    this.selectedStallId.set(id);
  }

  /**
   * Drag start/end of an existing stall. In a rule-driven hall the stall follows the pointer
   * freely and is checked on release: an invalid drop snaps back, with the reason drawn in the
   * scene (checking every intermediate position would make a stall stick whenever it passes
   * within a passage width of another one).
   */
  setDragging(value: boolean): void {
    this.dragging.set(value);

    const selected = this.selectedStall();
    if (value) {
      this.dragOrigin = selected ? { id: selected.id, posX: selected.posX, posZ: selected.posZ } : null;
      this.rejection.set(null);
      return;
    }

    const origin = this.dragOrigin;
    this.dragOrigin = null;
    this.moveCheck.set([]);
    if (!origin || !this.ruleDriven()) return;

    const stall = this.stalls().find(s => String(s.id) === String(origin.id));
    if (!stall || (stall.posX === origin.posX && stall.posZ === origin.posZ)) return;

    const violations = this.checkPlacement(stall, stall.id);
    if (violations.length === 0) return;

    this.updateStall(stall.id, { posX: origin.posX, posZ: origin.posZ }, true);
    this.reject('Move rejected', stall, violations, stall.id);
  }

  setSnap(value: boolean): void {
    this.snap.set(value);
  }

  setLayoutName(value: string): void {
    this.layoutName.set(value);
  }

  // --- stall transitions ---------------------------------------------------

  /** Patch one stall in place. App.js:502. Keeps gateSide synced to openSides[0]. */
  updateStall(id: string | number, patch: Partial<Stall>, preview = false): boolean {
    const synced =
      patch.openSides?.length && patch.gateSide === undefined
        ? { ...patch, gateSide: patch.openSides[0] }
        : patch;

    const current = this.stalls().find(s => String(s.id) === String(id));
    const affectsPlacement = ['width', 'length', 'posX', 'posZ', 'rotation', 'openSides', 'gateSide', 'status']
      .some(key => key in patch);
    if (current && affectsPlacement && !preview && patch.status !== 'CANCELLED') {
      const candidate = { ...current, ...synced };
      const violations = this.checkPlacement(candidate, id);
      if (violations.length) {
        this.reject('Change rejected', candidate, violations, id);
        return false;
      }
    }

    this.stalls.update(prev =>
      prev.map(s => (String(s.id) === String(id) ? { ...s, ...synced } : s))
    );
    return true;
  }

  /**
   * Toggle one open side on a stall. The last remaining open side cannot be
   * removed — a stall always keeps at least one opening.
   */
  toggleOpenSide(id: string | number, side: GateSide): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall) return;

    const current = stall.openSides?.length ? stall.openSides : [validGate(stall.gateSide)];

    if (current.includes(side)) {
      if (current.length <= 1) return;
      this.updateStall(id, { openSides: current.filter(s => s !== side) });
    } else {
      this.updateStall(id, { openSides: [...current, side] });
    }
  }

  /**
   * Open or close one edge of a custom (e.g. L-shaped) stall. The last open edge cannot be
   * closed: every stall needs an entrance. The legacy side summary follows the edges.
   */
  toggleOpenEdge(id: string | number, edge: number): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall?.footprint?.length || edge < 0 || edge >= stall.footprint.length) return;
    const current = stall.openEdges ?? [];
    const next = current.includes(edge) ? current.filter(e => e !== edge) : [...current, edge].sort((a, b) => a - b);
    if (!next.length) return;
    const sides = sidesOfEdges(stall.footprint, next).filter((s): s is GateSide => ['FRONT', 'BACK', 'LEFT', 'RIGHT'].includes(s));
    this.updateStall(id, { openEdges: next, ...(sides.length ? { openSides: sides, gateSide: sides[0] } : {}) });
  }

  /** Open one side (idempotent). Used by the 3D wall click. */
  openSide(id: string | number, side: GateSide): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall) return;

    const current = stall.openSides?.length ? stall.openSides : [validGate(stall.gateSide)];
    if (!current.includes(side)) {
      this.updateStall(id, { openSides: [...current, side] });
    }
  }

  /**
   * Move a stall, honouring the snap setting and rejecting moves that leave
   * the hall or collide with another stall. App.js:503-510.
   */
  moveStall(id: string | number, x: number, z: number): void {
    const s = this.stalls().find(v => String(v.id) === String(id));
    const currentHall = this.currentHall();
    if (!s || !currentHall) return;

    if (this.ruleDriven()) {
      this.moveRuleDriven(s, x, z);
      return;
    }

    const useSnap = this.snap();
    const nx = useSnap ? snapValue(x) : x;
    const nz = useSnap ? snapValue(z) : z;
    const candidate: Stall = { ...s, posX: nx, posZ: nz };

    if (!withinPlan(currentHall, candidate, nx, nz)) {
      this.showError('⚠️ Shop cannot move outside the hall boundary.');
      return;
    }

    if (blockedInPlan(currentHall, candidate)) {
      this.showError('⚠️ Shop cannot stand on a wall, compulsory passage, fire curtain or other non-clickable area.');
      return;
    }

    if (overlaps(candidate, this.activeStalls(), id)) {
      this.showError('⚠️ Shop overlaps another shop. Move it to a free grid position.');
      return;
    }

    this.updateStall(id, { posX: nx, posZ: nz });
  }

  /**
   * Move a stall to typed coordinates (edit form X / Z). In a rule-driven hall this behaves like
   * a drop: checked once, reverted with the reason if invalid.
   */
  placeStall(id: string | number, x: number, z: number): void {
    if (!this.ruleDriven()) {
      this.moveStall(id, x, z);
      return;
    }
    this.selectedStallId.set(id);
    this.setDragging(true);
    this.moveStall(id, x, z);
    this.setDragging(false);
  }

  /** Rule-driven move: snap edges to the grid, follow the pointer, show live problems. */
  private moveRuleDriven(s: Stall, x: number, z: number): void {
    const grid = this.grid();
    const raw = { posX: x, posZ: z, width: s.width, length: s.length };
    const next = this.snap() && grid ? grid.snapFootprint(raw) : raw;

    this.updateStall(s.id, { posX: next.posX, posZ: next.posZ }, this.dragging());
    this.moveCheck.set(this.checkPlacement({ ...s, ...next }, s.id));
  }

  /** Validate and normalize the selected stall. App.js:511-516. */
  saveEdit(): void {
    const selected = this.selectedStall();
    if (!selected) return;

    const candidate: Stall = { ...selected };
    const currentHall = this.currentHall();

    if (this.ruleDriven()) {
      const violations = this.checkPlacement(candidate, selected.id);
      if (violations.length) {
        this.reject('Change rejected', candidate, violations, selected.id);
        return;
      }
    } else if (
      !withinPlan(currentHall, candidate) ||
      overlaps(candidate, this.activeStalls(), selected.id) ||
      blockedInPlan(currentHall, candidate)
    ) {
      this.showError('⚠️ Updated shop position/dimensions are invalid or overlap another shop.');
      return;
    }

    this.updateStall(selected.id, {
      name: selected.name || 'Shop',
      width: num(selected.width, 5),
      length: num(selected.length, 5),
      height: num(selected.height, 4),
      openSides: normalizeOpenSides(selected.openSides, selected.gateSide)
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

    if (this.ruleDriven()) return this.addStallByRules(form);

    const base = {
      ...form,
      width: num(form.width, 5),
      length: num(form.length, 5),
      height: num(form.height, 4),
      posX: 0,
      posZ: 0,
      gateSide: validGate(form.gateSide),
      openSides: normalizeOpenSides(form.openSides, form.gateSide),
      hallId: this.activeHallId(),
      name: form.name.trim() || `Shop ${currentStalls.length + 1}`
    };

    let pos: { x: number; z: number } | null = null;
    // Scan the whole plan, not only the centred width x length: a traced hall's floor (a foyer
    // beyond the breadth) can lie outside it.
    const bounds = planBounds(currentHall);
    const minX = Math.ceil(bounds.minX + base.width / 2);
    const maxX = Math.floor(bounds.maxX - base.width / 2);
    const minZ = Math.ceil(bounds.minZ + base.length / 2);
    const maxZ = Math.floor(bounds.maxZ - base.length / 2);

    for (let z = minZ; z <= maxZ && !pos; z += 1) {
      for (let x = minX; x <= maxX && !pos; x += 1) {
        const trial = { ...base, posX: x, posZ: z };
        if (
          withinPlan(currentHall, base, x, z) &&
          !overlaps(trial, this.activeStalls()) &&
          !blockedInPlan(currentHall, trial)
        ) {
          pos = { x, z };
        }
      }
    }

    if (!pos) {
      this.showError('⚠️ No free grid position is available for this shop.');
      return null;
    }

    const stall: any = {
      ...base,
      posX: pos.x,
      posZ: pos.z,
      id: `local-${Date.now()}-${Math.random()}`,
      stallNumber: null,
      status: 'AVAILABLE',
      stallTypeId: null
    };

    this.stalls.update(p => [...p, stall]);
    this.selectedStallId.set(stall.id);
    return stall;
  }

  /**
   * Add Shop in a rule-driven hall: the first position (nearest the hall's top-left corner, as
   * the legacy scan) where the size fits in contiguous free space and passes every rule.
   */
  private addStallByRules(form: NewStallValue): Stall | null {
    const grid = this.grid();
    const ctx = this.placementContext();
    if (!grid || !ctx) return null;

    const width = grid.snapSize(num(form.width, 5));
    const length = grid.snapSize(num(form.length, 5));
    const spot = new FreeSpaceMap(grid, ctx).nearestPlacement(width, length, {
      x: grid.originX,
      z: grid.originZ
    }, null, normalizeOpenSides(form.openSides, form.gateSide), false, form.rotation ?? 0);

    if (!spot) {
      this.showError(`⚠️ No contiguous free area of ${width} × ${length} m is left in this hall.`);
      return null;
    }

    return this.createStall(spot, null, {
      name: form.name,
      height: form.height,
      color: form.color,
      gateSide: form.gateSide,
      openSides: form.openSides,
      rotation: form.rotation
    });
  }

  /**
   * Remove a stall. A stall that already has a persisted number is CANCELLED instead: it keeps
   * STALL-002 forever, frees its area, and later stalls are never renumbered.
   */
  cancelStall(id: string | number): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall) return;

    if (stall.stallNumber) {
      this.updateStall(id, { status: 'CANCELLED' });
      this.notify.success(`${stall.stallNumber} cancelled. Save or update the layout to persist it.`);
    } else {
      this.deleteStall(id);
    }
  }

  /**
   * A quarter turn: width and length swap, and every open side turns with the stall.
   * Checked like any other change, so a rotation that no longer fits is reported, not applied.
   */
  rotateStall(id: string | number): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall) return;
    if (stall.footprint?.length) {
      this.rotateCustomStall(stall);
      return;
    }

    const current = stall.openSides?.length ? stall.openSides : [validGate(stall.gateSide)];
    const openSides = current.map(side => ROTATED_SIDE[side]);
    const candidate: Stall = {
      ...stall,
      width: stall.length,
      length: stall.width,
      openSides,
      gateSide: openSides[0]
    };
    const currentHall = this.currentHall();

    if (this.ruleDriven()) {
      const violations = this.checkPlacement(candidate, stall.id);
      if (violations.length) {
        this.reject('Rotation rejected', candidate, violations, stall.id);
        return;
      }
    } else if (
      !withinPlan(currentHall, candidate) ||
      overlaps(candidate, this.activeStalls(), stall.id) ||
      blockedInPlan(currentHall, candidate)
    ) {
      this.showError('⚠️ The rotated shop would leave the hall or overlap another shop.');
      return;
    }

    this.updateStall(id, {
      width: candidate.width,
      length: candidate.length,
      openSides,
      gateSide: openSides[0]
    });
  }

  /**
   * A quarter turn of a custom (e.g. L-shaped) stall: its outline turns a quarter clockwise in
   * place, as one shape, the open edges turn with it (same edges), and the bounding box swaps.
   */
  private rotateCustomStall(stall: Stall): void {
    const turned = stall.footprint!.map(p => ({ x: -p.z, z: p.x }));
    const n = normalizeFootprint(turned);
    if (typeof n === 'string') return;
    const openEdges = [...new Set((stall.openEdges ?? []).map(e => n.edgeMap.get(e)).filter((e): e is number => e !== undefined))].sort((a, b) => a - b);
    const sides = sidesOfEdges(n.points, openEdges).filter((s): s is GateSide => ['FRONT', 'BACK', 'LEFT', 'RIGHT'].includes(s));
    const candidate: Stall = {
      ...stall,
      footprint: n.points,
      openEdges,
      width: n.width,
      length: n.length,
      posX: stall.posX + n.offset.x,
      posZ: stall.posZ + n.offset.z,
      ...(sides.length ? { openSides: sides, gateSide: sides[0] } : {})
    };
    const violations = this.checkPlacement(candidate, stall.id);
    if (violations.length) {
      this.reject('Rotation rejected', candidate, violations, stall.id);
      return;
    }
    const { footprint, width, length, posX, posZ, openSides, gateSide } = candidate;
    this.updateStall(stall.id, { footprint, openEdges, width, length, posX, posZ, openSides, gateSide });
  }

  /**
   * Copy a stall into the first free position. The copy goes through `addStall`, so it is
   * placed and validated exactly like a new shop - it never lands on top of its original.
   */
  duplicateStall(id: string | number): void {
    const stall = this.stalls().find(s => String(s.id) === String(id));
    if (!stall) return;
    if (stall.footprint?.length) {
      this.showError('Custom-shaped stalls (e.g. L-shaped) cannot be duplicated automatically yet.');
      return;
    }

    this.addStall({
      name: stall.name,
      width: stall.width,
      length: stall.length,
      height: stall.height,
      color: stall.color,
      gateSide: stall.gateSide,
      openSides: [...(stall.openSides ?? [])],
      rotation: stall.rotation
    });
  }

  // --- assisted layout -----------------------------------------------------

  /**
   * Check a plan against this hall without changing anything.
   *
   * The model proposes positions; it never writes into the layout. Every proposed footprint
   * goes through the same `validatePlacement` the drag path uses, plus a check against the
   * other stalls of the same plan, so a plan can be reported as "17 of 20 fit" before a
   * single stall exists.
   */
  reviewPlan(planned: ReadonlyArray<PlannedStall>): ProposedStall[] {
    const grid = this.grid();
    const ctx = this.placementContext();
    const accepted: PlacementStall[] = [];

    const reviewed = planned.map(stall => {
      const raw: Footprint = {
        rotation: num(stall.rotation, 0),
        posX: num(stall.posX, 0),
        posZ: num(stall.posZ, 0),
        width: Math.max(num(stall.width, 3), 0.5),
        length: Math.max(num(stall.length, 3), 0.5),
        openSides: normalizeOpenSides(stall.openSides, 'FRONT')
      };
      const footprint = { ...(this.snap() && grid ? grid.snapFootprint(raw) : raw), openSides: raw.openSides, rotation: raw.rotation };

      // Against the hall and the stalls that already exist...
      const violations = ctx ? validatePlacement(footprint, {
        ...ctx, stalls: [...ctx.stalls, ...accepted.map(s => ({ ...s, id: String(s.id) }))]
      }).violations : this.checkPlacement(footprint, null);
      const valid = violations.length === 0;
      if (valid) accepted.push({ ...footprint, id: `proposal-${accepted.length}` });

      return {
        footprint,
        name: String(stall.name ?? '').trim(),
        height: num(stall.height, 4),
        color: stall.color || '#3498db',
        openSides: normalizeOpenSides(stall.openSides, validGate(stall.openSides?.[0])),
        valid,
        violations
      };
    });

    this.proposals.set(reviewed);
    return reviewed;
  }

  /** Create the stalls of the reviewed plan that fit. Returns how many were added. */
  applyPlan(): number {
    const proposals = this.proposals();
    if (!proposals?.length) return 0;

    let added = 0;
    for (const proposal of proposals) {
      if (!proposal.valid) continue;
      const created = this.createStall(proposal.footprint, null, {
        name: proposal.name,
        height: proposal.height,
        color: proposal.color,
        gateSide: proposal.openSides[0],
        openSides: proposal.openSides
      });
      if (created) added += 1;
    }

    this.proposals.set(null);
    this.selectedStallId.set(null);
    if (added) this.notify.success(`${added} ${added === 1 ? 'stall' : 'stalls'} placed. Save the layout to keep them.`);
    return added;
  }

  clearPlan(): void {
    this.proposals.set(null);
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

  /**
   * Put a reviewed PDF plan import into the editor as a new, unsaved layout on `hall` (a working
   * copy made for the import, so the master hall and its current stalls stay as they are). The
   * stalls are placed as reviewed; the usual audit reports any planner-rule issue, and saving
   * goes through the normal validated save.
   */
  applyPdfImport(hall: Hall, stalls: ReadonlyArray<Stall>, layoutName: string): void {
    this.clearFeedback();
    this.proposals.set(null);
    this.halls.update(list => [...list.filter(h => String(h.id) !== String(hall.id)), hall]);
    this.activeHallId.set(hall.id);
    this.stalls.update(p => [
      ...p.filter(s => String(s.hallId) !== String(hall.id)),
      ...stalls.map(s => ({ ...s, hallId: hall.id }))
    ]);
    this.selectedSavedId.set(null);
    this.selectedStallId.set(null);
    this.layoutName.set(layoutName);
  }

  /** Open the PDF plan import dialog; with a file, it starts reading it straight away. */
  openPdfImport(file: File | null = null): void {
    this.pdfImport.set({ file });
  }

  // --- saved layout workflow ----------------------------------------------

  /**
   * App.js:499. A failed list raises no error popup, as in React; `listStatus` lets the
   * Layouts tab show it in place with a retry instead.
   */
  async loadList(): Promise<void> {
    this.listStatus.set('loading');
    try {
      this.savedLayouts.set(await this.api.list());
      this.listStatus.set('ready');
    } catch (e) {
      console.warn('Layout list unavailable:', extractErrorMessage(e));
      this.listStatus.set('error');
    }
  }

  /**
   * Load the real halls from the backend and select the first one.
   *
   * On failure or an empty list the local fallback hall stays, so the planner is still usable
   * without a backend; `hallsStatus` tells the sidebar to say so.
   *
   * Halls the user brought in meanwhile (a created hall, an Excel import, an opened layout)
   * are kept, and the view only switches halls while it is still on the fallback - so a retry,
   * or a slow first answer, never pulls the user away from their work.
   */
  async loadHalls(): Promise<void> {
    this.hallsStatus.set('loading');
    try {
      const halls = await this.api.listHalls();
      if (halls.length === 0) {
        this.hallsStatus.set('empty');
        return;
      }

      const isNew = (h: Hall) => !halls.some(x => String(x.id) === String(h.id));
      this.halls.update(prev => [...halls, ...prev.filter(h => h.id !== FALLBACK_HALL_ID && isNew(h))]);
      if (String(this.activeHallId()) === FALLBACK_HALL_ID) {
        this.activeHallId.set(halls[0].id);
        this.selectedStallId.set(null);
      }
      this.hallsStatus.set('ready');
    } catch (e) {
      console.warn('Hall list unavailable, using the local fallback hall:', extractErrorMessage(e));
      this.hallsStatus.set('unavailable');
    }
  }

  /**
   * Import SelfCare hall-layout responses (the `event-hall-layouts-data` payload: `{ header, data:
   * [row] }`, a bare row, or a list of either) and apply each to the hall of the same name. A row
   * whose hall is not in the list is added as a new local hall. The first imported hall becomes
   * active. Returns the names applied; throws when the file holds no layout row.
   */
  importSelfcare(payload: unknown): string[] {
    const bodies = Array.isArray(payload) ? payload : [payload];
    const rows = bodies.flatMap(body => unwrapSelfcareData<SelfcareLayoutRow>(body as SelfcareLayoutRow));
    const usable = rows.filter(r => r && typeof r === 'object' && (r.layout_data != null || r.length != null));
    if (!usable.length) throw new Error('No SelfCare hall layout found in this file.');

    const names: string[] = [];
    let firstId: string | number | null = null;
    for (const row of usable) {
      const name = String(row.name ?? '').trim().toLowerCase();
      const existing = name ? this.halls().find(h => h.name.trim().toLowerCase() === name) : undefined;
      const hall = existing
        ? applySelfcareLayout(existing, row)
        : { ...hallFromSelfcare(row), id: `selfcare-hall-${row.hallId ?? row.hall_id ?? names.length}-${Date.now()}` };
      this.halls.update(list => (existing ? list.map(h => (h === existing ? hall : h)) : [...list, hall]));
      firstId ??= hall.id;
      names.push(hall.name);
    }

    if (firstId !== null) {
      this.activeHallId.set(firstId);
      this.selectedStallId.set(null);
    }
    return names;
  }

  /**
   * Store the current hall's plan on its master hall (PUT /api/halls/{id}), so the imported
   * outline, labels, icons, north arrow and legend load from the server next time.
   */
  async saveHallPlan(): Promise<boolean> {
    const hall = this.currentHall();
    if (!hall || !Number.isFinite(Number(hall.id)) || String(hall.id).trim() === '') {
      this.showError('Only a hall that exists on the server can be saved. Save a layout on it instead.');
      return false;
    }
    this.busy.set(true);
    try {
      const saved = await this.api.updateHall(hall);
      this.halls.update(list => list.map(h => (String(h.id) === String(hall.id) ? { ...hall, ...saved } : h)));
      this.notify.success('Hall plan saved.');
      return true;
    } catch (e) {
      this.showError(`❌ Hall Save Error: ${extractErrorMessage(e)}`);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** App.js:570-574. */
  async saveLayout(): Promise<void> {
    if (!this.currentHall() || this.busy() || !this.canPersist()) return;

    this.busy.set(true);
    this.error.set('');
    this.notify.showLoading('Saving layout…');

    try {
      const payload = buildApiPayload(
        this.currentHall(),
        this.currentStalls(),
        this.layoutName(),
        this.eventType()
      );
      const saved = await this.api.save(payload);
      this.selectedSavedId.set(saved.layout?.id ?? saved.id ?? null);
      this.applyPersistedStalls(saved.stalls);
      await this.loadList();
      this.notify.success('Layout saved successfully.');
    } catch (e) {
      this.serverViolations.set(placementViolations(e));
      this.showError(`❌ Save Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
      this.notify.hideLoading();
    }
  }

  /** App.js:575. */
  async openLayout(id: string | number): Promise<void> {
    this.clearFeedback();
    this.busy.set(true);
    this.notify.showLoading('Opening layout…');

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
      this.eventType.set(d.layout?.eventType === 'B2C' ? 'B2C' : 'B2B');
    } catch (e) {
      this.showError(`❌ Open Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
      this.notify.hideLoading();
    }
  }

  /** App.js:576. The native confirm is replaced by a styled dialog (decision FD-013). */
  async deleteLayout(id: string | number): Promise<void> {
    const confirmed = await this.notify.confirm({
      title: 'Delete this saved layout?',
      text: 'The layout, its hall and all of its shops will be removed. This cannot be undone.',
      confirmText: 'Delete',
      danger: true
    });
    if (!confirmed) return;

    this.notify.showLoading('Deleting layout…');

    try {
      await this.api.delete(id);
      this.savedLayouts.update(p => p.filter(x => String(x.id) !== String(id)));
      if (String(this.selectedSavedId()) === String(id)) {
        this.selectedSavedId.set(null);
      }
      this.notify.success('Layout deleted.');
    } catch (e) {
      this.showError(`❌ Delete Error: ${extractErrorMessage(e)}`);
    } finally {
      this.notify.hideLoading();
    }
  }

  /** App.js:577. */
  async updateLayout(): Promise<void> {
    const savedId = this.selectedSavedId();
    if (!savedId) {
      this.showError('Select/open a saved layout first.');
      return;
    }
    if (this.busy() || !this.canPersist()) return;

    this.busy.set(true);
    this.notify.showLoading('Updating layout…');

    try {
      const payload = buildApiPayload(
        this.currentHall(),
        this.currentStalls(),
        this.layoutName(),
        this.eventType()
      );
      const updated = await this.api.update(savedId, payload);
      this.applyPersistedStalls(updated?.stalls);
      await this.loadList();
      this.notify.success('Layout updated successfully.');
    } catch (e) {
      this.serverViolations.set(placementViolations(e));
      this.showError(`❌ Update Error: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
      this.notify.hideLoading();
    }
  }
  // --- rule-driven editor ----------------------------------------------------

  /** Stall types come from the backend configuration; offline, draw mode offers Custom only. */
  async loadStallTypes(): Promise<void> {
    try {
      this.stallTypes.set(await this.api.listStallTypes());
    } catch (e) {
      console.warn('Stall types unavailable, draw mode offers Custom only:', extractErrorMessage(e));
    }
  }

  setMode(mode: EditorMode): void {
    this.mode.set(mode);
    this.draft.set(null);
    if (mode === 'draw') this.selectedStallId.set(null);
  }

  selectStallType(id: string | null): void {
    this.selectedStallTypeId.set(id);
    this.draft.set(null);
  }

  setEventType(type: EventType): void {
    this.eventType.set(type);
    this.clearFeedback();
  }

  previewStallSplit(options: SplitOptions): void {
    this.proposals.set(null);
    this.splitOptions.set({ ...options });
  }

  dismissSplit(): void {
    this.splitOptions.set(null);
  }

  async confirmSplit(): Promise<void> {
    if (!this.canConfirmSplit()) return;
    const parent = this.selectedStall()!;
    const preview = this.splitPreview()!;
    const hall = this.currentHall()!;
    const layoutId = this.selectedSavedId()!;
    const layoutName = this.layoutName();
    const eventType = this.eventType();
    const before = this.stalls();
    const unchanged = () => this.currentHall() === hall && this.selectedSavedId() === layoutId &&
      this.stalls() === before && this.layoutName() === layoutName && this.eventType() === eventType;
    const snapshot = buildApiPayload(hall, this.currentStalls(), layoutName, eventType);
    const key = JSON.stringify([layoutId, parent.id, preview.options, snapshot]);
    if (this.splitRequest?.key !== key) this.splitRequest = { key, id: crypto.randomUUID() };
    this.busy.set(true);
    this.serverViolations.set([]);
    try {
      // The split endpoint operates on the persisted layout. Never silently replace unsaved work.
      const persisted = await this.api.open(layoutId);
      if (!unchanged()) throw new Error('The editor changed while checking the saved layout. Preview the split again.');
      const persistedPayload = buildApiPayload(persisted.hall,
        (persisted.stalls ?? []).map(s => normalizeStall(s, persisted.hall!.id)),
        persisted.layout?.name ?? persisted.name ?? '', persisted.layout?.eventType ?? 'B2B');
      if (layoutSignature(snapshot) !== layoutSignature(persistedPayload)) {
        throw new Error('Update the saved layout before splitting so the server has your current geometry and passage settings.');
      }
      const children = buildApiPayload(hall, preview.children, layoutName, eventType).stalls
        .map(({ id, stallNumber, parentStallNumber, ...child }) => child);
      const saved = await this.api.split(layoutId, parent.stallNumber!, children, this.splitRequest!.id);
      if (!saved.stalls || saved.stalls.filter(s => s.parentStallNumber === parent.stallNumber &&
        typeof s.stallNumber === 'string').length !== preview.options.count) {
        throw new Error('The split response is incomplete. Reopen the saved layout to check the server result.');
      }
      if (!unchanged()) {
        throw new Error('The server saved the split while the editor changed. Reopen the saved layout to load it.');
      }
      this.applyPersistedStalls(saved.stalls);
      this.splitOptions.set(null);
      this.splitRequest = null;
      await this.loadList();
      this.notify.success('Stall split saved. Child numbers were assigned by the server.');
    } catch (e) {
      this.serverViolations.set(placementViolations(e));
      const status = (e as { status?: number })?.status;
      this.showError(status === 404 || status === 405 || status === 501
        ? 'Splitting is not available on this backend yet. The parent has been kept.'
        : `Split failed: ${extractErrorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  setPassageWidth(width: number): void {
    if (!Number.isFinite(width) || width < 3 || width > 5) {
      this.showError('Passage width must be between 3 and 5 m.');
      return;
    }
    const hall = this.currentHall();
    if (!hall) return;
    const rules = effectiveRules(hall.rules);
    this.halls.update(list => list.map(h => h === hall ? { ...h, rules: {
      ...rules, minPassageWidth: { ...rules.minPassageWidth, [this.eventType()]: width }
    } } : h));
    this.clearFeedback();
    this.proposals.set(null);
  }

  setDraftOpenSide(side: GateSide): void {
    this.draftOpenSide.set(validGate(side));
    const draft = this.draft();
    if (draft) this.setDraft(draft.footprint, draft.start, draft.dragging);
  }

  setShowFreeSpace(value: boolean): void {
    this.showFreeSpace.set(value);
  }

  setShowClearances(value: boolean): void {
    this.showClearances.set(value);
  }

  /** Pointer over the grid in draw mode, button up: preview the stall under the cursor. */
  draftHover(point: Point): void {
    const grid = this.grid();
    if (this.mode() !== 'draw' || !grid || this.draft()?.dragging) return;
    this.setDraft(grid.draftFootprint(point, point, this.selectedStallType(), false), point, false);
  }

  /** Pointer down on the grid in draw mode. */
  draftStart(point: Point): void {
    const grid = this.grid();
    if (this.mode() !== 'draw' || !grid) return;
    this.rejection.set(null);
    this.serverViolations.set([]);
    this.setDraft(grid.draftFootprint(point, point, this.selectedStallType(), true), point, true);
  }

  draftMove(point: Point): void {
    const grid = this.grid();
    const draft = this.draft();
    if (!grid || !draft?.dragging) return;
    this.setDraft(grid.draftFootprint(draft.start, point, this.selectedStallType(), true), draft.start, true);
  }

  /** Pointer up: create the stall if every rule passes, otherwise explain and suggest. */
  draftEnd(): void {
    const draft = this.draft();
    if (!draft?.dragging) return;
    this.draft.set(null);

    if (draft.valid) {
      this.createStall(draft.footprint, this.selectedStallTypeId());
      return;
    }

    this.reject('Placement rejected', draft.footprint, draft.violations, null);
  }

  /** Pointer left the canvas: drop the hover preview. */
  draftLeave(): void {
    if (!this.draft()?.dragging) this.draft.set(null);
  }

  /** Create the stall at the suggested position of the last rejection. */
  acceptSuggestion(): void {
    const rejection = this.rejection();
    if (!rejection?.suggestion) return;

    const moving = this.selectedStall();
    const footprint = rejection.suggestion;
    this.rejection.set(null);

    if (rejection.title === 'Move rejected' && moving) {
      this.placeStall(moving.id, footprint.posX, footprint.posZ);
      return;
    }
    this.createStall(footprint, this.selectedStallTypeId(), { openSides: footprint.openSides });
  }

  dismissFeedback(): void {
    this.rejection.set(null);
    this.serverViolations.set([]);
    this.highlight.set([]);
  }

  /** Move the camera to a problem and outline it. */
  locate(geometry: ViolationGeometry[], fallback?: Footprint): void {
    const rects = geometry.map(g => (g.type === 'rect' ? g.rect : boundsOf(g.points)));
    if (fallback) rects.push(footprintRect(fallback));
    if (!rects.length) return;

    this.highlight.set(geometry.length ? geometry : fallback ? [{ type: 'rect', rect: footprintRect(fallback) }] : []);
    this.focusTarget.set({ rect: unionRect(rects), seq: ++this.focusSeq });
  }

  /** The local stall a server violation refers to (its index in the saved payload). */
  stallForServerViolation(v: ServerViolation): Stall | undefined {
    return this.currentStalls().find(s => v.stallNumber && s.stallNumber === v.stallNumber) ?? this.currentStalls()[v.stallIndex];
  }

  /** Ask the backend to audit the saved layout (the authoritative copy of the rules). */
  async runServerAudit(): Promise<void> {
    const savedId = this.selectedSavedId();
    if (!savedId) {
      this.showError('Select/open a saved layout first.');
      return;
    }

    try {
      const result = await this.api.audit(savedId);
      this.serverAudit.set(result.entries as AuditEntry[]);
      this.notify.success(
        result.ruleDriven
          ? `Server audit: ${result.entries.length} stall(s) with rule problems.`
          : 'This hall has no placement rules.'
      );
    } catch (e) {
      this.showError(`❌ Audit Error: ${extractErrorMessage(e)}`);
    }
  }

  private setDraft(footprint: Footprint, start: Point, dragging: boolean): void {
    footprint = { ...footprint, openSides: [this.draftOpenSide()] };
    const violations = this.checkPlacement(footprint, null);
    this.draft.set({ footprint, valid: violations.length === 0, violations, dragging, start });
  }

  /**
   * Every rule a footprint breaks. Rule-driven halls use the placement rules; other halls get
   * the legacy boundary + overlap checks expressed as the same Violation shape, so draw mode
   * works everywhere.
   */
  private checkPlacement(footprint: Footprint, ignoreId: string | number | null): Violation[] {
    const ctx = this.placementContext();
    if (ctx) return validatePlacement(footprint, ctx, ignoreId === null ? null : String(ignoreId)).violations;

    const hall = this.currentHall();
    const rect = footprintRect(footprint);
    const violations: Violation[] = [];
    if (!withinPlan(hall, footprint, footprint.posX, footprint.posZ)) {
      violations.push(legacyViolation('OUTSIDE_HALL', 'Stall is outside the hall boundary.', rect));
    } else if (blockedInPlan(hall, footprint)) {
      violations.push(
        legacyViolation('RESTRICTED_ZONE', 'Stall stands on a wall, compulsory passage, fire curtain or other non-clickable area.', rect)
      );
    }
    const others = this.activeStalls().filter(s => ignoreId === null || String(s.id) !== String(ignoreId));
    if (overlaps(footprint, others)) {
      violations.push(legacyViolation('STALL_OVERLAP', 'Overlaps an existing stall.', rect));
    }
    return violations;
  }

  /** Record a rejected placement, find the nearest valid spot and tell the user why. */
  private reject(
    title: string,
    footprint: Footprint,
    violations: Violation[],
    ignoreId: string | number | null
  ): void {
    const grid = this.grid();
    const ctx = this.placementContext();
    const suggestion =
      grid && ctx && (title === 'Move rejected' || title === 'Placement rejected')
        ? new FreeSpaceMap(grid, {
            ...ctx,
            stalls: ctx.stalls.filter(s => ignoreId === null || s.id !== String(ignoreId))
          }).nearestPlacement(footprint.width, footprint.length, { x: footprint.posX, z: footprint.posZ },
            null, footprint.openSides, false, footprint.rotation ?? 0)
        : null;

    const all: Violation[] =
      grid && ctx && !suggestion && (title === 'Move rejected' || title === 'Placement rejected')
        ? [
            ...violations,
            {
              code: 'NO_CONTIGUOUS_SPACE',
              ruleRef: 'Free space',
              message: `No contiguous free area of ${footprint.width} × ${footprint.length} m is left in this hall.`,
              geometry: [],
              relatedStallIds: []
            }
          ]
        : violations;

    this.rejection.set({ title, footprint, violations: all, suggestion });
    this.showError(`⚠️ ${title}: ${violations[0]?.message ?? 'invalid placement.'}`);
  }

  private createStall(
    footprint: Footprint,
    stallTypeId: string | null,
    extra: Partial<Pick<Stall, 'name' | 'height' | 'color' | 'gateSide' | 'openSides' | 'rotation'>> = {}
  ): Stall | null {
    const hall = this.currentHall();
    if (!hall) return null;

    const gateSide = validGate(extra.gateSide ?? footprint.openSides?.[0] ?? this.draftOpenSide());
    const stall: Stall = {
      id: `local-${Date.now()}-${Math.random()}`,
      hallId: this.activeHallId(),
      name: extra.name?.trim() || `Shop ${this.currentStalls().length + 1}`,
      width: footprint.width,
      length: footprint.length,
      height: num(extra.height, 4),
      posX: footprint.posX,
      posZ: footprint.posZ,
      color: extra.color || '#3498db',
      gateSide,
      openSides: normalizeOpenSides(extra.openSides ?? footprint.openSides, gateSide),
      stallNumber: null,
      status: 'AVAILABLE',
      stallTypeId,
      rotation: extra.rotation ?? footprint.rotation ?? 0
    };

    const violations = this.checkPlacement(stall, null);
    if (violations.length) {
      this.reject('Placement rejected', stall, violations, null);
      return null;
    }
    this.stalls.update(p => [...p, stall]);
    this.selectedStallId.set(stall.id);
    this.rejection.set(null);
    return stall;
  }

  /** After save/update: take the server's stalls, which now carry their stall numbers. */
  private applyPersistedStalls(persisted: StallInput[] | undefined): void {
    this.serverViolations.set([]);
    if (!persisted) return;

    const hallId = this.activeHallId();
    this.stalls.update(p => [
      ...p.filter(s => String(s.hallId) !== String(hallId)),
      ...persisted.map(s => normalizeStall(s, hallId))
    ]);
    this.selectedStallId.set(null);
  }

  private clearFeedback(): void {
    this.splitOptions.set(null);
    this.draft.set(null);
    this.rejection.set(null);
    this.serverViolations.set([]);
    this.serverAudit.set(null);
    this.highlight.set([]);
    this.moveCheck.set([]);
  }

  private canPersist(): boolean {
    const ctx = this.placementContext();
    if (ctx && (!Number.isFinite(this.passageWidth()) || this.passageWidth() < 3 || this.passageWidth() > 5)) {
      this.showError('Choose a passage width between 3 and 5 m before saving.');
      return false;
    }
    const first = this.audit()[0];
    if (!first) return true;
    const stall = this.currentStalls().find(s => String(s.id) === first.stallId);
    if (stall) this.reject('Save rejected', stall, first.violations, stall.id);
    return false;
  }
}

/** Ignore regenerated row ids and object key ordering when comparing persisted layout content. */
function layoutSignature(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (key === 'id') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]));
    }
    return v;
  });
}

/** Some domain errors carry just a code and stall number; keep all server feedback renderable. */
function placementViolations(error: unknown): ServerViolation[] {
  return extractViolations<Partial<ServerViolation>>(error).filter(v => !!v && typeof v === 'object').map(v => ({
    code: v.code ?? 'INVALID_DIMENSIONS',
    message: v.message ?? String(v.code ?? 'Placement was rejected by the server.'),
    ruleRef: v.ruleRef ?? 'Server validation',
    geometry: Array.isArray(v.geometry) ? v.geometry : [],
    relatedStallIds: Array.isArray(v.relatedStallIds) ? v.relatedStallIds : [],
    stallIndex: v.stallIndex ?? -1,
    stallNumber: v.stallNumber ?? null
  }));
}

function legacyViolation(code: Violation['code'], message: string, rect: Rect): Violation {
  return { code, ruleRef: 'Hall boundary', message, geometry: [{ type: 'rect', rect }], relatedStallIds: [] };
}

function boundsOf(points: Point[]): Rect {
  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)),
    maxZ: Math.max(...points.map(p => p.z))
  };
}

function unionRect(rects: Rect[]): Rect {
  return {
    minX: Math.min(...rects.map(r => r.minX)),
    maxX: Math.max(...rects.map(r => r.maxX)),
    minZ: Math.min(...rects.map(r => r.minZ)),
    maxZ: Math.max(...rects.map(r => r.maxZ))
  };
}
