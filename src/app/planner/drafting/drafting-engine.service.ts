import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { NotifyService } from '../../core/notify.service';
import { extractErrorMessage } from '../../core/http-error.util';
import { stallArea } from '../geometry/footprint-view';
import { floorOutlines } from '../geometry/hall-plan';
import { placementContextFor } from '../geometry/hall-rules';
import type { Footprint, PlacementContext, Point, Rect, Violation } from '../geometry/placement-rules';
import { polygonBounds, validatePlacement } from '../geometry/placement-rules';
import { pointSegmentDistance, rotate, stallPolygon } from '../geometry/polygon-geometry';
import { normalizeFootprint, sidesOfEdges } from '../geometry/stall-footprint';
import { LayoutAssistantService } from '../layout-assistant.service';
import type { GateSide, Stall } from '../models/stall.model';
import { PlannerStore } from '../planner-store.service';
import {
  arrayOffsets, boundsOfAll, CadFrame, cadAngle, dist, gridSnap, islandFootprints, mergeFootprints,
  mirrorIn, NewFootprint, normaliseRightAngle, objectSnap, orthoFrom, polarFrom, rotateAbout, rowFootprints,
  selectInRect, SnapResult, snapTargets, splitFootprint, stallAt, StallSize, translate
} from './cad-geometry';
import { CommandName, COMMANDS, commandInfo, findCommand } from './cad-commands';
import { formatSize, matchKeyword, parseNumber, parsePointEntry, parseSize, resolvePointEntry, trim } from './cad-input';
import { portalExport } from './portal-export';

// --- prompt protocol ------------------------------------------------------------------------------

interface BaseRequest {
  message: string;
  keywords?: readonly string[];
  /** Shown as `<default>`; the command applies it when the answer is empty. */
  defaultValue?: string;
}

export interface PointRequest extends BaseRequest {
  kind: 'point';
  /** Previous point: rubber band, ORTHO/POLAR and relative input start here. */
  base?: Point | null;
  preview?: (p: Point) => Preview | null;
  /** A bare number is a value (an angle), not a direct distance. */
  numberAsText?: boolean;
}

export interface TextRequest extends BaseRequest {
  kind: 'text';
  /** Space types a space instead of confirming (free text such as a layout name). */
  spaces?: boolean;
}

export interface SelectRequest extends BaseRequest {
  kind: 'select';
}

export interface StallRequest extends BaseRequest {
  kind: 'stall';
  preview?: (p: Point) => Preview | null;
}

export type Request = PointRequest | TextRequest | SelectRequest | StallRequest;

type Answer =
  | { kind: 'point'; point: Point }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'text'; text: string }
  | { kind: 'stall'; id: string }
  | { kind: 'empty' };

class Cancelled extends Error {}

/** What the canvas draws for the command in progress. */
export interface Preview {
  stalls?: Footprint[];
  lines?: Array<[Point, Point]>;
  polygon?: Point[];
  rect?: Rect;
  /** Stall edges to highlight (open-side editing). */
  edges?: Array<[Point, Point]>;
  /** Per preview stall: true when placing it would break a rule (drawn red; the click is refused). */
  invalid?: boolean[];
}

export type LogKind = 'command' | 'info' | 'result' | 'error';
export interface LogLine {
  id: number;
  text: string;
  kind: LogKind;
}

export type ViewRequest = { kind: 'extents' } | { kind: 'rect'; rect: Rect };

export type LayerId = 'base' | 'zones' | 'services' | 'notes' | 'stalls' | 'labels' | 'issues';

export const LAYERS: ReadonlyArray<{ id: LayerId; label: string; locked?: boolean }> = [
  { id: 'base', label: 'Hall base', locked: true },
  { id: 'zones', label: 'Restricted zones' },
  { id: 'services', label: 'Exits & services' },
  { id: 'notes', label: 'Plan labels' },
  { id: 'stalls', label: 'Stalls' },
  { id: 'labels', label: 'Stall labels' },
  { id: 'issues', label: 'Rule issues' }
];

interface Snapshot {
  label: string;
  stalls: Stall[];
  halls: ReturnType<PlannerStore['halls']>;
  activeHallId: string | number;
}

type Toggle = 'grid' | 'snap' | 'ortho' | 'polar' | 'osnap' | 'dyn';

const HISTORY_LIMIT = 300;
const UNDO_LIMIT = 200;
const SIDES: readonly GateSide[] = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];
/** Sides as the plan shows them (FRONT is the bottom edge). */
const SIDE_WORDS: Record<GateSide, string> = { FRONT: 'bottom', RIGHT: 'right', BACK: 'top', LEFT: 'left' };

/**
 * The drafting workspace's command engine: the command line, prompts, selection, snaps, undo and
 * every drawing command. The drawing itself stays in `PlannerStore` (stalls, hall, rules, save),
 * so the rule engine, the AI assistant, the PDF plotter and saving all work unchanged.
 *
 * Commands are async functions that `ask` for input, the way an AutoCAD command prompts: the
 * answer comes from the command line (coordinates, numbers, option keywords) or the canvas
 * (a snapped point, a stall, a selection window). Esc rejects the pending prompt and so cancels
 * the command; nothing it has not committed stays.
 */
@Injectable()
export class DraftingEngine {
  private readonly store = inject(PlannerStore);
  private readonly notify = inject(NotifyService);
  private readonly assistant = inject(LayoutAssistantService);

  // --- drafting settings ---
  readonly toggles = signal<Record<Toggle, boolean>>({ grid: true, snap: true, ortho: false, polar: false, osnap: true, dyn: true });
  readonly layers = signal<Record<LayerId, boolean>>({
    base: true, zones: true, services: true, notes: true, stalls: true, labels: true, issues: true
  });
  readonly size = signal<StallSize>({ width: 3, depth: 3 });
  private rowGap = 0;
  private rowFlip = false;
  private rowBackToBack = false;
  private stallTurns = 0;
  /** Side that RECTANG opens to the aisle. */
  private rectOpen: GateSide = 'FRONT';
  private rectSize: { x: number; y: number } = { x: 3, y: 3 };
  private renumberPrefix = 'A-';

  // --- command state ---
  readonly history = signal<LogLine[]>([]);
  readonly request = signal<Request | null>(null);
  readonly active = signal<CommandName | null>(null);
  readonly preview = signal<Preview | null>(null);
  readonly cursor = signal<Point | null>(null);
  readonly snapMark = signal<SnapResult | null>(null);
  readonly hovered = signal<string | null>(null);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly view = signal<{ request: ViewRequest; seq: number } | null>(null);
  readonly panMode = signal(false);
  /** Index of the AI proposal under review (Tab/Next steps through them). */
  readonly proposalIndex = signal(0);
  /** Bumped by PR so the page can bring the properties palette forward. */
  readonly propertiesRequest = signal(0);
  readonly busy = signal(false);

  private resolver: { resolve: (a: Answer) => void; reject: (e: Error) => void } | null = null;
  private queued: string[] = [];
  private lastCommand: CommandName | null = null;
  private logSeq = 0;
  private viewSeq = 0;
  private idSeq = 0;
  private pdfWaiter: (() => void) | null = null;
  /** The last PDF read by PP, reused for the next hall of the same drawing. */
  private lastPdf: File | null = null;
  private runSeq = 0;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** The stalls as last saved or opened; anything else is unsaved work. */
  private readonly cleanStalls = signal<Stall[] | null>(null);
  readonly dirty = computed(() => {
    const clean = this.cleanStalls();
    return clean !== null && this.store.stalls() !== clean;
  });
  readonly undoLabel = signal<string | null>(null);
  readonly redoLabel = signal<string | null>(null);

  // --- the drawing, as the workspace sees it ---
  readonly hall = this.store.currentHall;
  /** Stalls on the canvas: the current hall's, cancelled ones left out. */
  readonly stalls = computed(() => this.store.currentStalls().filter(s => s.status !== 'CANCELLED'));
  readonly plan = computed<Rect | null>(() => this.store.grid()?.bounds ?? null);
  readonly frame = computed(() => CadFrame.of(this.plan() ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }));
  readonly issues = this.store.audit;
  readonly issueStallIds = computed(() => {
    const ids = new Set<string>();
    for (const e of this.issues()) {
      ids.add(e.stallId);
      e.violations.forEach(v => v.relatedStallIds.forEach(id => ids.add(id)));
    }
    return ids;
  });
  readonly selectedStalls = computed(() => {
    const sel = this.selection();
    return this.stalls().filter(s => sel.has(String(s.id)));
  });
  readonly totals = computed(() => {
    const list = this.stalls();
    return { count: list.length, area: Math.round(list.reduce((a, s) => a + stallArea(s), 0) * 100) / 100 };
  });

  private readonly targets = computed(() => {
    const hall = this.hall();
    const polys: Point[][] = this.stalls().map(s => stallPolygon(s));
    if (hall) {
      polys.push(...floorOutlines(hall));
      for (const a of hall.blockedAreas ?? []) {
        if (a.kind === 'wall') polys.push(stallPolygon({ posX: a.posX, posZ: a.posZ, width: a.width, length: a.length }));
      }
      for (const z of hall.zones ?? []) polys.push(z.polygon);
    }
    return snapTargets(polys);
  });

  /** The prompt shown in the command line. */
  readonly promptText = computed(() => {
    const r = this.request();
    if (!r) return 'Command:';
    const options = r.keywords?.length ? ` [${r.keywords.join('/')}]` : '';
    const def = r.defaultValue !== undefined ? ` <${r.defaultValue}>` : '';
    return `${r.message}${options}${def}:`;
  });

  /** Space types a space only while a free-text prompt is waiting. */
  readonly spaceTypes = computed(() => {
    const r = this.request();
    return r?.kind === 'text' && !!r.spaces;
  });

  constructor() {
    // Keep the selection to stalls that still exist (after undo, erase, save).
    effect(() => {
      const ids = new Set(this.stalls().map(s => String(s.id)));
      const sel = untracked(this.selection);
      if ([...sel].some(id => !ids.has(id))) {
        untracked(() => this.selection.set(new Set([...sel].filter(id => ids.has(id)))));
      }
    });

    this.log('Type a command or its alias (? lists them). Draw a stall: REC (corner to corner), PL (any shape). Fixed size: STL, SR, ISL. Modify: M, CO, RO, MI, AR, E.', 'info');
  }

  // --- command line ----------------------------------------------------------------------------------

  log(text: string, kind: LogKind = 'result'): void {
    this.history.update(h => [...h.slice(-(HISTORY_LIMIT - 1)), { id: ++this.logSeq, text, kind }]);
  }

  /** Enter (or Space) on the command line. */
  submit(raw: string): void {
    const text = raw.trim();
    const request = this.request();
    this.log(`${this.promptText()} ${text}`.trimEnd(), 'command');

    if (!request) {
      if (!text) {
        if (this.lastCommand) void this.run(this.lastCommand);
        return;
      }
      this.startFromText(text);
      return;
    }

    if (!text) return this.answer({ kind: 'empty' });
    const keyword = request.keywords ? matchKeyword(text, request.keywords) : null;
    if (keyword) return this.answer({ kind: 'keyword', keyword });

    switch (request.kind) {
      case 'text':
        return this.answer({ kind: 'text', text });
      case 'point': {
        if (request.numberAsText && parseNumber(text) !== null) return this.answer({ kind: 'text', text });
        const entry = parsePointEntry(text);
        if (entry) {
          const base = request.base ?? null;
          const cursor = this.cursor();
          const direction = base && cursor && dist(base, cursor) > 1e-9
            ? { x: (cursor.x - base.x) / dist(base, cursor), z: (cursor.z - base.z) / dist(base, cursor) }
            : null;
          const point = resolvePointEntry(entry, this.frame(), base, direction);
          if (point) return this.answer({ kind: 'point', point });
          this.log(entry.kind === 'distance'
            ? 'Point the cursor in the direction first, then type the distance.'
            : 'There is no previous point for relative input yet.', 'error');
          return;
        }
        break;
      }
      case 'select':
        if (text.toUpperCase() === 'ALL') {
          this.selection.set(new Set(this.stalls().map(s => String(s.id))));
          this.log(`${this.stalls().length} found`, 'info');
          return;
        }
        break;
    }

    // Anything else that names a command starts it, as AutoCAD does.
    const command = findCommand(text.split(/\s+/)[0]);
    if (command) {
      this.cancel(false);
      queueMicrotask(() => this.startFromText(text));
      return;
    }
    this.log(this.invalidInputHint(request), 'error');
  }

  private invalidInputHint(request: Request): string {
    switch (request.kind) {
      case 'point': return 'Requires a point (click, x,y, @dx,dy or @distance<angle) or an option keyword.';
      case 'select': return 'Select stalls on the canvas, type ALL, or press Enter to finish.';
      case 'stall': return 'Click a stall, or press Enter.';
      default: return 'Invalid input.';
    }
  }

  private startFromText(text: string): void {
    const [word, ...rest] = text.split(/\s+/);
    const command = findCommand(word);
    if (!command) {
      this.log(`Unknown command "${word.toUpperCase()}". Type ? for the list.`, 'error');
      return;
    }
    this.queued = rest;
    void this.run(command.name);
  }

  /** Esc: cancel the prompt (and so the command), else leave pan mode, else clear the selection. */
  escape(): void {
    this.queued = [];
    if (this.request()) return this.cancel(true);
    if (this.panMode()) {
      this.panMode.set(false);
      return;
    }
    if (this.selection().size) this.selection.set(new Set());
  }

  private cancel(logIt: boolean): void {
    const pending = this.resolver;
    this.resolver = null;
    this.request.set(null);
    this.preview.set(null);
    if (pending) {
      if (logIt) this.log('*Cancel*', 'info');
      pending.reject(new Cancelled());
    }
  }

  private answer(a: Answer): void {
    const pending = this.resolver;
    if (!pending) return;
    this.resolver = null;
    this.request.set(null);
    this.preview.set(null);
    pending.resolve(a);
  }

  private ask(request: Request): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      this.resolver = { resolve, reject };
      this.request.set(request);
      const cursor = this.cursor();
      this.preview.set(cursor && 'preview' in request && request.preview ? request.preview(cursor) : null);
      const next = this.queued.shift();
      if (next !== undefined) queueMicrotask(() => this.submit(next));
    });
  }

  async run(name: CommandName): Promise<void> {
    if (this.active()) this.cancel(false);
    const run = ++this.runSeq;
    if (!this.hall()) {
      this.log('No hall is open yet.', 'error');
      return;
    }
    this.active.set(name);
    if (name !== 'UNDO' && name !== 'REDO') this.lastCommand = name;
    if (!this.queued.length && this.history().at(-1)?.kind !== 'command') this.log(`Command: ${name}`, 'command');
    try {
      await this.execute(name);
    } catch (e) {
      if (!(e instanceof Cancelled)) {
        this.log(extractErrorMessage(e), 'error');
        console.error(e);
      }
    } finally {
      // A command cancelled by the next one unwinds later; it must not clear the new prompt.
      if (this.runSeq === run) {
        this.active.set(null);
        this.request.set(null);
        this.preview.set(null);
        this.resolver = null;
      }
    }
  }

  private execute(name: CommandName): Promise<void> | void {
    switch (name) {
      case 'RECTANG': return this.rectangleCommand();
      case 'PLINE': return this.plineCommand();
      case 'STALL': return this.stallCommand();
      case 'STALLROW': return this.stallRowCommand();
      case 'ISLAND': return this.islandCommand();
      case 'ARRAY': return this.arrayCommand();
      case 'SPLIT': return this.splitCommand();
      case 'MERGE': return this.mergeCommand();
      case 'RENUMBER': return this.renumberCommand();
      case 'OPENSIDE': return this.openSideCommand();
      case 'MOVE': return this.moveCommand(false);
      case 'COPY': return this.moveCommand(true);
      case 'ROTATE': return this.rotateCommand();
      case 'MIRROR': return this.mirrorCommand();
      case 'ERASE': return this.eraseCommand();
      case 'MATCHPROP': return this.matchPropCommand();
      case 'PROPERTIES': this.propertiesRequest.update(n => n + 1); return;
      case 'UNDO': this.undo(); return;
      case 'REDO': this.redo(); return;
      case 'DIST': return this.distCommand();
      case 'AREA': return this.areaCommand();
      case 'ID': return this.idCommand();
      case 'ZOOM': return this.zoomCommand();
      case 'PAN': return this.panCommand();
      case 'SELECTALL': this.selectAll(); return;
      case 'CHECK': return this.checkCommand();
      case 'ASSIST': return this.assistCommand();
      case 'PDFPLOT': return this.pdfPlotCommand();
      case 'QSAVE': return this.saveCommand();
      case 'EXPORT': this.exportForPortal(); return;
      case 'HELP': this.help(); return;
    }
  }

  // --- canvas input ------------------------------------------------------------------------------------

  /** Pointer moved to `raw` (world metres). `metresPerPixel` scales the snap aperture. */
  pointerMove(raw: Point, metresPerPixel: number): void {
    const request = this.request();
    const base = request?.kind === 'point' ? request.base ?? null : null;
    const t = this.toggles();
    let point = raw;
    let mark: SnapResult | null = null;

    const wantsPoint = request?.kind === 'point';
    if (wantsPoint && t.osnap) {
      const hit = objectSnap(raw, this.targets(), 10 * metresPerPixel);
      if (hit) { point = hit.point; mark = hit; }
    }
    if (!mark) {
      if (wantsPoint && t.snap) {
        const g = this.store.grid();
        if (g) point = gridSnap(raw, { x: g.originX, z: g.originZ }, g.snapStep || 1);
      }
      if (base && t.ortho) point = orthoFrom(base, point);
      else if (base && t.polar) point = polarFrom(base, point);
    }
    this.cursor.set(point);
    this.snapMark.set(mark);

    if (request && 'preview' in request && request.preview) this.preview.set(request.preview(point));
    const hoverable = !request || request.kind === 'select' || request.kind === 'stall';
    const under = hoverable ? stallAt(this.stalls(), raw) : null;
    this.hovered.set(under ? String(under.id) : null);
  }

  pointerLeave(): void {
    this.hovered.set(null);
    this.snapMark.set(null);
  }

  /** A click (no drag) on the canvas. */
  click(raw: Point, shift: boolean): void {
    const request = this.request();
    const hit = stallAt(this.stalls(), raw);
    if (request?.kind === 'point') {
      this.answer({ kind: 'point', point: this.cursor() ?? raw });
      return;
    }
    if (request?.kind === 'stall') {
      if (hit) this.answer({ kind: 'stall', id: String(hit.id) });
      return;
    }
    if (request?.kind === 'text') return;
    if (!hit) {
      if (!request && !shift) this.selection.set(new Set());
      return;
    }
    this.toggleSelected([String(hit.id)], shift);
  }

  /** A selection window dragged on the canvas. */
  windowSelect(rect: Rect, crossing: boolean, shift: boolean): void {
    const request = this.request();
    if (request?.kind === 'point') {
      // A drag while a point is wanted is read as a click where it ended.
      return;
    }
    if (request && request.kind !== 'select') return;
    const found = selectInRect(this.stalls(), rect, crossing).map(s => String(s.id));
    this.toggleSelected(found, shift);
    if (request) this.log(`${found.length} found`, 'info');
  }

  /** Right click: Enter, as in AutoCAD's default right-click behaviour. */
  enter(): void {
    this.submit('');
  }

  /** AutoCAD picking: a pick adds to the selection; Shift + pick removes. */
  private toggleSelected(ids: string[], remove: boolean): void {
    this.selection.update(set => {
      const next = new Set(set);
      for (const id of ids) {
        if (remove) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  selectAll(): void {
    this.selection.set(new Set(this.stalls().map(s => String(s.id))));
    this.log(`${this.stalls().length} stalls selected.`, 'info');
  }

  select(ids: Iterable<string>): void {
    this.selection.set(new Set(ids));
  }

  toggle(name: Toggle): void {
    this.toggles.update(t => ({ ...t, [name]: !t[name] }));
    // ORTHO and POLAR exclude each other, as in AutoCAD.
    if (name === 'ortho' && this.toggles().ortho) this.toggles.update(t => ({ ...t, polar: false }));
    if (name === 'polar' && this.toggles().polar) this.toggles.update(t => ({ ...t, ortho: false }));
    const on = this.toggles()[name];
    this.log(`<${name.toUpperCase()} ${on ? 'on' : 'off'}>`, 'info');
  }

  setLayer(id: LayerId, on: boolean): void {
    this.layers.update(l => ({ ...l, [id]: on }));
  }

  setSize(size: StallSize): void {
    this.size.set(size);
  }

  zoomExtents(): void {
    this.requestView({ kind: 'extents' });
  }

  zoomTo(rect: Rect, margin = 6): void {
    this.requestView({ kind: 'rect', rect: { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin } });
  }

  private requestView(request: ViewRequest): void {
    this.view.set({ request, seq: ++this.viewSeq });
  }

  // --- undo --------------------------------------------------------------------------------------------

  markClean(): void {
    this.cleanStalls.set(this.store.stalls());
  }

  /** A different hall or a layout opened over this one: the history belonged to the old drawing. */
  resetHistory(): void {
    if (this.request()) this.cancel(false);
    this.undoStack = [];
    this.redoStack = [];
    this.syncUndoLabels();
    this.selection.set(new Set());
  }

  private snapshot(label: string): Snapshot {
    return { label, stalls: this.store.stalls(), halls: this.store.halls(), activeHallId: this.store.activeHallId() };
  }

  private restore(s: Snapshot): void {
    this.store.halls.set(s.halls);
    // Restoring the hall id must not look like a hall change (which clears the history).
    if (String(this.store.activeHallId()) !== String(s.activeHallId)) this.store.activeHallId.set(s.activeHallId);
    this.store.stalls.set(s.stalls);
    this.store.proposals.set(null);
  }

  private pushUndo(label: string): void {
    this.undoStack.push(this.snapshot(label));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.syncUndoLabels();
  }

  private syncUndoLabels(): void {
    this.undoLabel.set(this.undoStack.at(-1)?.label ?? null);
    this.redoLabel.set(this.redoStack.at(-1)?.label ?? null);
  }

  undo(): void {
    const last = this.undoStack.pop();
    if (!last) {
      this.log('Everything has been undone.', 'info');
      return;
    }
    this.redoStack.push(this.snapshot(last.label));
    this.restore(last);
    this.syncUndoLabels();
    this.log(`Undo ${last.label}`, 'info');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) {
      this.log('Nothing to redo.', 'info');
      return;
    }
    this.undoStack.push(this.snapshot(next.label));
    this.restore(next);
    this.syncUndoLabels();
    this.log(`Redo ${next.label}`, 'info');
  }

  /** Change stalls of the current drawing as one undoable step. */
  commit(label: string, update: (all: Stall[]) => Stall[]): void {
    this.pushUndo(label);
    this.store.stalls.update(update);
  }

  /**
   * Property palette and editing commands: patch the given stalls, unless that breaks a rule.
   * Returns whether the change was made.
   */
  updateStalls(ids: ReadonlySet<string>, patch: (s: Stall) => Stall, label = 'Properties'): boolean {
    if (!ids.size) return false;
    const next = this.store.currentStalls().filter(s => ids.has(String(s.id))).map(patch);
    return this.commitIfAllowed(label, next, all => all.map(s => (ids.has(String(s.id)) ? patch(s) : s)));
  }

  // --- the rules gate ----------------------------------------------------------------------------------
  //
  // Nothing that breaks a rule is drawn. Every command checks the drawing as it WOULD be after the
  // edit and refuses the edit when a stall it creates or changes gets a violation it did not
  // already have. (Stalls imported with problems, e.g. from a PDF, can still be moved to fix
  // them; a change may not make things worse.)

  /**
   * The stalls an edit would put in breach of a rule. `next` are the stalls after the edit: new
   * ones, or changed ones under their own id; `removed` leave the drawing.
   */
  private blocked(next: readonly Stall[], removed: ReadonlySet<string> = new Set()): Array<{ index: number; stall: Stall; violation: Violation }> {
    const hall = this.hall();
    if (!hall || !next.length) return [];
    const eventType = this.store.eventType();
    const current = this.store.currentStalls();
    const ids = new Set(next.map(s => String(s.id)));
    const rest = current.filter(s => !ids.has(String(s.id)) && !removed.has(String(s.id)));
    const after = placementContextFor(hall, [...rest, ...next], eventType);
    let before: PlacementContext | null = null;
    const out: Array<{ index: number; stall: Stall; violation: Violation }> = [];
    next.forEach((s, index) => {
      if (s.status === 'CANCELLED') return;
      let found = validatePlacement(s, after, String(s.id)).violations;
      const old = current.find(o => String(o.id) === String(s.id));
      if (found.length && old) {
        before ??= placementContextFor(hall, current, eventType);
        const had = new Set(validatePlacement(old, before, String(old.id)).violations.map(violationKey));
        found = found.filter(v => !had.has(violationKey(v)));
      }
      if (found.length) out.push({ index, stall: s, violation: found[0] });
    });
    return out;
  }

  /** Commit the edit, or refuse it and say which rule it would break. */
  private commitIfAllowed(
    label: string,
    next: readonly Stall[],
    update: (all: Stall[]) => Stall[],
    removed?: ReadonlySet<string>
  ): boolean {
    const refused = this.blocked(next, removed);
    if (!refused.length) {
      this.commit(label, update);
      return true;
    }
    const { index, stall, violation } = refused[0];
    const existing = this.store.currentStalls().some(s => String(s.id) === String(stall.id));
    const who = existing ? `${stall.stallNumber ?? stall.name}: ` : next.length > 1 ? `stall ${index + 1} of ${next.length}: ` : '';
    const more = refused.length > 1 ? ` ${refused.length - 1} more would break a rule too.` : '';
    this.log(`Not done: ${who}${violation.message} (${violation.ruleRef}).${more}`, 'error');
    this.notify.error(`${label} not allowed`, `${who}${violation.message}`);
    return false;
  }

  /** Preview of stalls, each marked when placing it would be refused. Memoised per drawing. */
  private checked(stalls: readonly Stall[], removed?: ReadonlySet<string>): Preview {
    const key = JSON.stringify([
      stalls.map(s => [s.id, s.posX, s.posZ, s.width, s.length, s.rotation ?? 0, s.openSides, s.openEdges ?? null]),
      [...(removed ?? [])]
    ]);
    const current = this.store.stalls();
    if (this.previewMemo.key !== key || this.previewMemo.stalls !== current) {
      const bad = new Set(this.blocked(stalls, removed).map(b => b.index));
      this.previewMemo = { key, stalls: current, invalid: stalls.map((_, i) => bad.has(i)) };
    }
    return { stalls: [...stalls], invalid: this.previewMemo.invalid };
  }
  private previewMemo: { key: string; stalls: Stall[] | null; invalid: boolean[] } = { key: '', stalls: null, invalid: [] };

  /** Stand-ins for stalls not created yet, so a preview can be checked. */
  private ghosts(footprints: readonly Footprint[]): Stall[] {
    const hallId = this.hall()?.id ?? '';
    return footprints.map((f, i) => ({
      id: `ghost-${i}`, hallId, name: '', height: 4, color: '', stallNumber: null, status: 'AVAILABLE', stallTypeId: null,
      gateSide: f.openSides?.[0] ?? 'FRONT', openSides: f.openSides ?? ['FRONT'],
      ...f,
      rotation: f.rotation ?? 0
    } as Stall));
  }

  /** New stalls shaped like `sources` at the given placements (copy, mirror, array). */
  private copiesOf(sources: readonly Stall[], placed: readonly Stall[]): Stall[] {
    return this.newStalls(placed.map(s => ({ ...s, rotation: s.rotation ?? 0 }) as NewFootprint)).map((c, i) => {
      const src = sources[i % sources.length];
      return { ...c, color: src.color, height: src.height, footprint: placed[i].footprint ?? null, openEdges: placed[i].openEdges ?? null };
    });
  }

  // --- creating stalls ------------------------------------------------------------------------------------

  private newStalls(footprints: readonly NewFootprint[]): Stall[] {
    const hall = this.hall()!;
    const taken = new Set(this.store.currentStalls().map(s => s.name));
    let n = this.store.currentStalls().length;
    const types = this.store.stallTypes();
    return footprints.map(f => {
      let name: string;
      do name = `Stall ${++n}`; while (taken.has(name));
      taken.add(name);
      const type = types.find(t =>
        (t.width === f.width && t.height === f.length) || (t.width === f.length && t.height === f.width));
      return {
        id: `draft-${Date.now().toString(36)}-${++this.idSeq}`,
        hallId: hall.id,
        name,
        width: f.width,
        length: f.length,
        height: 4,
        posX: f.posX,
        posZ: f.posZ,
        color: '#3498db',
        gateSide: f.openSides[0] ?? 'FRONT',
        openSides: [...f.openSides],
        stallNumber: null,
        status: 'AVAILABLE',
        stallTypeId: type?.id ?? null,
        rotation: f.rotation ?? 0
      };
    });
  }

  private addStalls(label: string, footprints: readonly NewFootprint[]): Stall[] {
    if (!footprints.length) {
      this.log('Nothing fits: the length or area is smaller than one stall.', 'error');
      return [];
    }
    const created = this.newStalls(footprints);
    if (!this.commitIfAllowed(label, created, all => [...all, ...created])) return [];
    const area = created.reduce((a, s) => a + stallArea(s), 0);
    const names = created.length > 2 ? `${created[0].name} … ${created.at(-1)!.name}` : created.map(s => s.name).join(', ');
    this.log(`${created.length} ${created.length === 1 ? 'stall' : 'stalls'} created: ${names}. ${trim(area)} m² added.`);
    return created;
  }

  private sizeText(): string {
    return formatSize(this.size());
  }

  private async askSize(): Promise<void> {
    const a = await this.ask({ kind: 'text', message: 'Stall size (frontage x depth, m)', defaultValue: this.sizeText() });
    if (a.kind !== 'text') return;
    const size = parseSize(a.text);
    if (size) this.size.set(size);
    else this.log('Type the size as frontage x depth, e.g. 3x2.', 'error');
  }

  private async askNumber(message: string, fallback: number, min: number, integer = false): Promise<number> {
    for (;;) {
      const a = await this.ask({ kind: 'text', message, defaultValue: trim(fallback) });
      if (a.kind === 'empty') return fallback;
      const value = a.kind === 'text' ? parseNumber(a.text) : null;
      if (value !== null && value >= min && (!integer || Number.isInteger(value))) return value;
      this.log(integer ? `Requires a whole number of at least ${min}.` : `Requires a number of at least ${min}.`, 'error');
    }
  }

  private ghost(corner: Point): NewFootprint {
    const { width, depth } = this.size();
    const f = normaliseRightAngle({
      posX: 0, posZ: 0, width, length: depth, rotation: this.stallTurns * 90,
      openSides: ['FRONT'] as GateSide[], gateSide: 'FRONT' as GateSide
    });
    // The insertion point is the stall's bottom-left corner, as a CAD block's base point.
    return { ...f, posX: corner.x + f.width / 2, posZ: corner.z - f.length / 2 } as NewFootprint;
  }

  /** A stall exactly the drawn rectangle, open on the chosen side. null when too small. */
  private rectFootprint(a: Point, b: Point): NewFootprint | null {
    const width = Math.abs(b.x - a.x), length = Math.abs(b.z - a.z);
    if (width < 0.5 - 1e-9 || length < 0.5 - 1e-9) return null;
    return {
      posX: (a.x + b.x) / 2,
      posZ: (a.z + b.z) / 2,
      width: Math.round(width * 1000) / 1000,
      length: Math.round(length * 1000) / 1000,
      rotation: 0,
      openSides: [this.rectOpen],
      gateSide: this.rectOpen
    };
  }

  private cycleRectOpen(): void {
    this.rectOpen = SIDES[(SIDES.indexOf(this.rectOpen) + 1) % SIDES.length];
    this.log(`New stalls open on the ${SIDE_WORDS[this.rectOpen]}.`, 'info');
  }

  /** RECTANG: first corner, other corner, as AutoCAD's RECTANG; the rectangle is the stall. */
  private async rectangleCommand(): Promise<void> {
    for (;;) {
      const a = await this.ask({
        kind: 'point',
        message: `Specify first corner (opens on the ${SIDE_WORDS[this.rectOpen]})`,
        keywords: ['Open']
      });
      if (a.kind === 'empty') return;
      if (a.kind === 'keyword') { this.cycleRectOpen(); continue; }
      if (a.kind !== 'point') continue;
      const first = a.point;
      let other: Point | null = null;
      while (!other) {
        const b = await this.ask({
          kind: 'point',
          message: 'Specify other corner',
          keywords: ['Dimensions', 'Open'],
          base: first,
          preview: p => {
            const f = this.rectFootprint(first, p);
            return f ? this.checked(this.ghosts([f])) : { rect: rectOf(first, p) };
          }
        });
        if (b.kind === 'empty') break;
        if (b.kind === 'keyword' && b.keyword === 'Open') { this.cycleRectOpen(); continue; }
        if (b.kind === 'keyword') {
          const x = await this.askNumber('Length along X (m)', this.rectSize.x, 0.5);
          const y = await this.askNumber('Width along Y (m)', this.rectSize.y, 0.5);
          this.rectSize = { x, y };
          // As AutoCAD: a last click picks which quadrant the rectangle goes into.
          const towards = (p: Point) => ({
            x: first.x + (p.x >= first.x ? x : -x),
            z: first.z + (p.z <= first.z ? -y : y)
          });
          const c = await this.ask({
            kind: 'point',
            message: 'Specify the side to draw it on',
            base: first,
            preview: p => this.checked(this.ghosts([this.rectFootprint(first, towards(p))!]))
          });
          if (c.kind === 'point') other = towards(c.point);
          continue;
        }
        if (b.kind === 'point') {
          if (!this.rectFootprint(first, b.point)) {
            this.log('A stall is at least 0.5 m on each side.', 'error');
            continue;
          }
          other = b.point;
        }
      }
      if (other) this.addStalls('Rectangle', [this.rectFootprint(first, other)!]);
    }
  }

  /**
   * PLINE: a stall of any outline, point by point (L-shapes, corner cuts). The first segment is
   * its open side (OS changes it). Close with C, Enter, or by clicking the start point.
   */
  private async plineCommand(): Promise<void> {
    const pts: Point[] = [];
    for (;;) {
      const n = pts.length;
      const a = await this.ask({
        kind: 'point',
        message: n === 0
          ? 'Specify start point (the first segment will be the open side)'
          : n < 3 ? 'Specify next point' : 'Specify next point or Enter to close',
        keywords: n >= 3 ? ['Close', 'Undo'] : n ? ['Undo'] : undefined,
        base: pts.at(-1) ?? null,
        preview: p => {
          const outline = [...pts, p];
          return {
            polygon: outline.length >= 3 ? outline : undefined,
            lines: outline.slice(1).map((q, i) => [outline[i], q] as [Point, Point]),
            edges: outline.length >= 2 ? [[outline[0], outline[1]]] : undefined
          };
        }
      });
      if (a.kind === 'keyword' && a.keyword === 'Undo') { pts.pop(); continue; }
      if (a.kind === 'empty' || (a.kind === 'keyword' && a.keyword === 'Close')) {
        if (n >= 3) this.addShapedStall(pts);
        else if (n) this.log('A stall needs at least three points; nothing drawn.', 'info');
        return;
      }
      if (a.kind !== 'point') continue;
      if (n >= 3 && dist(a.point, pts[0]) < 1e-6) {
        this.addShapedStall(pts);
        return;
      }
      if (n && dist(a.point, pts[n - 1]) < 1e-6) continue;
      pts.push(a.point);
    }
  }

  private addShapedStall(points: Point[]): void {
    const norm = normalizeFootprint(points);
    if (typeof norm === 'string') {
      this.log(`Not a usable stall outline: ${norm}`, 'error');
      return;
    }
    const open = norm.edgeMap.get(0) ?? 0;
    const local = norm.points;
    const axisRect = local.length === 4 && local.every((p, i) => {
      const q = local[(i + 1) % 4];
      return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.z - q.z) < 1e-6;
    });
    const sides = sidesOfEdges(local, [open]) as GateSide[];
    const base: NewFootprint = {
      posX: norm.offset.x, posZ: norm.offset.z, width: norm.width, length: norm.length,
      rotation: 0, openSides: sides.length ? sides : ['FRONT'], gateSide: sides[0] ?? 'FRONT'
    };
    if (axisRect) {
      this.addStalls('Polyline', [base]);
      return;
    }
    const [created] = this.newStalls([base]);
    const stall = { ...created, footprint: local, openEdges: [open] };
    if (!this.commitIfAllowed('Polyline', [stall], all => [...all, stall])) return;
    this.log(`${stall.name} created: ${local.length}-corner shape, ${trim(stallArea(stall))} m².`);
  }

  private async stallCommand(): Promise<void> {
    for (;;) {
      const a = await this.ask({
        kind: 'point',
        message: `Specify insertion point (${this.sizeText()} m)`,
        keywords: ['Size', 'Rotate'],
        preview: p => this.checked(this.ghosts([this.ghost(p)]))
      });
      if (a.kind === 'empty') return;
      if (a.kind === 'keyword') {
        if (a.keyword === 'Size') await this.askSize();
        else this.stallTurns = (this.stallTurns + 1) % 4;
        continue;
      }
      if (a.kind === 'point') this.addStalls('Stall', [this.ghost(a.point)]);
    }
  }

  private rowSettings(): string {
    return `${this.sizeText()} m, gap ${trim(this.rowGap)} m${this.rowBackToBack ? ', back to back' : ''}${this.rowFlip ? ', flipped' : ''}`;
  }

  private async stallRowCommand(): Promise<void> {
    let first = true;
    for (;;) {
      const a = await this.ask({
        kind: 'point',
        message: `Specify start point of ${first ? 'the' : 'the next'} aisle edge (${this.rowSettings()})`,
        keywords: ['Size', 'Gap', 'Flip', 'Back-to-back']
      });
      if (a.kind === 'empty') return;
      if (a.kind === 'keyword') {
        if (a.keyword === 'Size') await this.askSize();
        else if (a.keyword === 'Gap') this.rowGap = await this.askNumber('Gap between stalls (m)', this.rowGap, 0);
        else if (a.keyword === 'Flip') this.rowFlip = !this.rowFlip;
        else this.rowBackToBack = !this.rowBackToBack;
        continue;
      }
      if (a.kind !== 'point') continue;
      const start = a.point;
      const spec = (end: Point) => ({
        start, end, size: this.size(), gap: this.rowGap, flip: this.rowFlip, backToBack: this.rowBackToBack
      });
      for (;;) {
        const b = await this.ask({
          kind: 'point',
          message: 'Specify end point',
          keywords: ['Flip', 'Back-to-back'],
          base: start,
          preview: p => ({ ...this.checked(this.ghosts(rowFootprints(spec(p)))), lines: [[start, p]] })
        });
        if (b.kind === 'keyword') {
          if (b.keyword === 'Flip') this.rowFlip = !this.rowFlip;
          else this.rowBackToBack = !this.rowBackToBack;
          continue;
        }
        if (b.kind === 'point') this.addStalls('Stall row', rowFootprints(spec(b.point)));
        break;
      }
      first = false;
    }
  }

  private async islandCommand(): Promise<void> {
    for (;;) {
      const a = await this.ask({
        kind: 'point', message: `Specify first corner of the island (${this.sizeText()} m stalls)`, keywords: ['Size']
      });
      if (a.kind === 'empty') return;
      if (a.kind === 'keyword') { await this.askSize(); continue; }
      if (a.kind !== 'point') continue;
      const corner = a.point;
      const b = await this.ask({
        kind: 'point',
        message: 'Specify opposite corner',
        base: corner,
        preview: p => ({ ...this.checked(this.ghosts(islandFootprints(corner, p, this.size()))), rect: rectOf(corner, p) })
      });
      if (b.kind === 'point') this.addStalls('Island', islandFootprints(corner, b.point, this.size()));
    }
  }

  // --- selecting ------------------------------------------------------------------------------------------

  /** Noun-verb: a selection made before the command is used as it is; otherwise ask for one. */
  private async getSelection(message = 'Select stalls'): Promise<Stall[]> {
    if (this.selection().size) return this.selectedStalls();
    for (;;) {
      const a = await this.ask({ kind: 'select', message });
      if (a.kind === 'empty') break;
    }
    const picked = this.selectedStalls();
    if (!picked.length) this.log('Nothing selected.', 'info');
    return picked;
  }

  private async pickStall(message: string, keywords?: readonly string[]): Promise<Stall | string | null> {
    for (;;) {
      const a = await this.ask({ kind: 'stall', message, keywords });
      if (a.kind === 'empty') return null;
      if (a.kind === 'keyword') return a.keyword;
      if (a.kind === 'stall') {
        const stall = this.stalls().find(s => String(s.id) === a.id);
        if (stall) return stall;
      }
    }
  }

  // --- modify ----------------------------------------------------------------------------------------------

  private async moveCommand(copy: boolean): Promise<void> {
    const picked = await this.getSelection();
    if (!picked.length) return;
    const a = await this.ask({ kind: 'point', message: 'Specify base point' });
    if (a.kind !== 'point') return;
    const base = a.point;
    const ids = new Set(picked.map(s => String(s.id)));
    for (;;) {
      const b = await this.ask({
        kind: 'point',
        message: copy ? 'Specify second point or <exit>' : 'Specify second point',
        base,
        preview: p => {
          const moved = picked.map(s => translate(s, delta(base, p)));
          return { ...this.checked(copy ? moved.map((s, i) => ({ ...s, id: `ghost-${i}` })) : moved), lines: [[base, p]] };
        }
      });
      if (b.kind !== 'point') return;
      const d = delta(base, b.point);
      if (copy) {
        const copies = this.copiesOf(picked, picked.map(s => translate(s, d)));
        if (this.commitIfAllowed('Copy', copies, all => [...all, ...copies])) this.log(`${copies.length} copied.`);
        continue;
      }
      const moved = picked.map(s => translate(s, d));
      if (this.commitIfAllowed('Move', moved, all => all.map(s => (ids.has(String(s.id)) ? translate(s, d) : s)))) {
        this.log(`${picked.length} moved ${trim(dist(base, b.point))} m.`);
        return;
      }
    }
  }

  private async rotateCommand(): Promise<void> {
    const picked = await this.getSelection();
    if (!picked.length) return;
    const a = await this.ask({ kind: 'point', message: 'Specify base point' });
    if (a.kind !== 'point') return;
    const base = a.point;
    const turned = (angle: number) => picked.map(s => rotateAbout(s, base, -angle));
    for (;;) {
      const b = await this.ask({
        kind: 'point',
        message: 'Specify rotation angle (degrees, counter-clockwise)',
        base,
        numberAsText: true,
        preview: p => ({ ...this.checked(turned(cadAngle(base, p))), lines: [[base, p]] })
      });
      let angle: number | null = null;
      if (b.kind === 'point') angle = cadAngle(base, b.point);
      if (b.kind === 'text') angle = parseNumber(b.text);
      if (angle === null) return;
      const next = turned(angle);
      const byId = new Map(next.map(s => [String(s.id), s]));
      if (this.commitIfAllowed('Rotate', next, all => all.map(s => byId.get(String(s.id)) ?? s))) {
        this.log(`${picked.length} rotated ${trim(angle)}°.`);
        return;
      }
    }
  }

  private async mirrorCommand(): Promise<void> {
    const picked = await this.getSelection();
    if (!picked.length) return;
    const a = await this.ask({ kind: 'point', message: 'Specify first point of mirror line' });
    if (a.kind !== 'point') return;
    const first = a.point;
    const b = await this.ask({
      kind: 'point',
      message: 'Specify second point of mirror line',
      base: first,
      preview: p => ({ ...this.checked(picked.map((s, i) => ({ ...mirrorIn(s, first, p), id: `ghost-${i}` }))), lines: [[first, p]] })
    });
    if (b.kind !== 'point') return;
    const second = b.point;
    const c = await this.ask({ kind: 'text', message: 'Erase source stalls?', keywords: ['Yes', 'No'], defaultValue: 'No' });
    const erase = c.kind === 'keyword' && c.keyword === 'Yes';
    const mirrored = picked.map(s => mirrorIn(s, first, second));
    let done: boolean;
    if (erase) {
      const byId = new Map(mirrored.map(s => [String(s.id), s]));
      done = this.commitIfAllowed('Mirror', mirrored, all => all.map(s => byId.get(String(s.id)) ?? s));
    } else {
      const copies = this.copiesOf(picked, mirrored);
      done = this.commitIfAllowed('Mirror', copies, all => [...all, ...copies]);
    }
    if (done) this.log(`${picked.length} mirrored.`);
  }

  private async arrayCommand(): Promise<void> {
    const picked = await this.getSelection();
    if (!picked.length) return;
    const box = boundsOfAll(picked)!;
    const rows = await this.askNumber('Number of rows', 1, 1, true);
    const cols = await this.askNumber('Number of columns', rows > 1 ? 1 : 4, 1, true);
    if (rows * cols <= 1) {
      this.log('One row and one column make no copies.', 'info');
      return;
    }
    if (rows * cols * picked.length > 5000) {
      this.log('That would create more than 5000 stalls.', 'error');
      return;
    }
    const rowSpacing = rows > 1 ? await this.askNumber('Row spacing (m, + is up)', box.maxZ - box.minZ, -1e6) : 0;
    const colSpacing = cols > 1 ? await this.askNumber('Column spacing (m, + is right)', box.maxX - box.minX, -1e6) : 0;
    const offsets = arrayOffsets(rows, cols, rowSpacing, colSpacing);
    const created = this.copiesOf(picked, offsets.flatMap(d => picked.map(s => translate(s, d))));
    if (this.commitIfAllowed('Array', created, all => [...all, ...created])) {
      this.log(`${created.length} stalls created in ${rows} x ${cols}.`);
    }
  }

  private async eraseCommand(): Promise<void> {
    const picked = await this.getSelection();
    if (!picked.length) return;
    this.erase(picked.map(s => String(s.id)));
  }

  /** Delete key and ERASE. A saved stall is cancelled, so its number stays reserved. */
  erase(ids: readonly string[]): void {
    const set = new Set(ids);
    const list = this.stalls().filter(s => set.has(String(s.id)));
    if (!list.length) return;
    const cancelled = list.filter(s => s.stallNumber).length;
    this.commit('Erase', all => all
      .filter(s => !set.has(String(s.id)) || !!s.stallNumber)
      .map(s => (set.has(String(s.id)) ? { ...s, status: 'CANCELLED' as const } : s)));
    this.selection.set(new Set());
    this.log(`${list.length} erased${cancelled ? ` (${cancelled} saved ${cancelled === 1 ? 'stall keeps its' : 'stalls keep their'} number as cancelled)` : ''}.`);
  }

  private async matchPropCommand(): Promise<void> {
    const source = await this.pickStall('Select source stall');
    if (!source || typeof source === 'string') return;
    this.log(`Source ${source.stallNumber ?? source.name}: colour, height, open sides.`, 'info');
    for (;;) {
      const target = await this.pickStall('Select destination stall');
      if (!target || typeof target === 'string') return;
      if (target.id === source.id) continue;
      this.updateStalls(new Set([String(target.id)]), s => {
        const sameShape = !s.footprint && !source.footprint;
        return {
          ...s,
          color: source.color,
          height: source.height,
          ...(sameShape ? { openSides: [...source.openSides], gateSide: source.gateSide } : {})
        };
      }, 'Match properties');
    }
  }

  private refuseNumbered(list: readonly Stall[], what: string): boolean {
    const numbered = list.filter(s => s.stallNumber);
    if (!numbered.length) return false;
    this.log(`${numbered.map(s => s.stallNumber).join(', ')} ${numbered.length === 1 ? 'is' : 'are'} saved: ${what} would retire ${numbered.length === 1 ? 'its number' : 'their numbers'}. Erase and redraw instead.`, 'error');
    return true;
  }

  private async splitCommand(): Promise<void> {
    let stall: Stall | null = this.selectedStalls().length === 1 ? this.selectedStalls()[0] : null;
    if (!stall) {
      const picked = await this.pickStall('Select the stall to split');
      if (!picked || typeof picked === 'string') return;
      stall = picked;
    }
    if (stall.footprint?.length) {
      this.log('Only rectangular stalls can be split.', 'error');
      return;
    }
    if (this.refuseNumbered([stall], 'splitting')) return;
    const cols = await this.askNumber('Parts along the width', 2, 1, true);
    const rows = await this.askNumber('Parts along the depth', 1, 1, true);
    if (cols * rows < 2) return;
    const parts = this.newStalls(splitFootprint(stall, cols, rows));
    const id = String(stall.id);
    if (!this.commitIfAllowed('Split', parts, all => all.flatMap(s => (String(s.id) === id ? parts : [s])), new Set([id]))) return;
    this.selection.set(new Set(parts.map(p => String(p.id))));
    this.log(`${stall.name} split into ${parts.length}.`);
  }

  private async mergeCommand(): Promise<void> {
    const picked = await this.getSelection('Select the stalls to merge');
    if (picked.length < 2) {
      if (picked.length) this.log('Select at least two stalls.', 'error');
      return;
    }
    if (this.refuseNumbered(picked, 'merging')) return;
    const merged = mergeFootprints(picked);
    if (!merged) {
      this.log('These stalls do not form one rectangle (a gap, an overlap or a turned stall).', 'error');
      return;
    }
    const created = { ...this.newStalls([merged])[0], name: picked[0].name };
    const ids = new Set(picked.map(s => String(s.id)));
    let placed = false;
    const ok = this.commitIfAllowed('Merge', [created], all => all.flatMap(s => {
      if (!ids.has(String(s.id))) return [s];
      if (placed) return [];
      placed = true;
      return [created];
    }), ids);
    if (!ok) return;
    this.selection.set(new Set([String(created.id)]));
    this.log(`${picked.length} stalls merged into one of ${trim(merged.width)} x ${trim(merged.length)} m.`);
  }

  private async renumberCommand(): Promise<void> {
    let order: Stall[] = [];
    const initial = this.selectedStalls();
    const how = await this.ask({
      kind: 'text',
      message: initial.length ? `Order for ${initial.length} selected stalls` : 'Order',
      keywords: ['Rows', 'Columns', 'Snake', 'Pick'],
      defaultValue: initial.length ? 'Rows' : 'Pick'
    });
    const mode = how.kind === 'keyword' ? how.keyword : initial.length ? 'Rows' : 'Pick';
    if (mode === 'Pick') {
      this.selection.set(new Set());
      const chosen = new Set<string>();
      for (;;) {
        const s = await this.pickStall(`Pick stall ${order.length + 1} in order, Enter when done`);
        if (!s || typeof s === 'string') break;
        if (chosen.has(String(s.id))) continue;
        chosen.add(String(s.id));
        order.push(s);
        this.selection.set(new Set(chosen));
      }
    } else {
      const list = initial.length ? initial : await this.getSelection();
      order = orderStalls(list, mode as 'Rows' | 'Columns' | 'Snake', this.frame());
    }
    if (!order.length) return;

    const p = await this.ask({ kind: 'text', message: 'Name prefix', defaultValue: this.renumberPrefix });
    if (p.kind === 'text') this.renumberPrefix = p.text;
    const start = await this.askNumber('Start number', 1, 0, true);
    const digits = Math.max(2, String(start + order.length - 1).length);
    const names = new Map(order.map((s, i) => [String(s.id), `${this.renumberPrefix}${String(start + i).padStart(digits, '0')}`]));
    const rank = new Map(order.map((s, i) => [String(s.id), i]));

    // New stalls are numbered by the server in list order, so the list follows the naming order.
    this.commit('Renumber', all => {
      const renamed = all.map(s => (names.has(String(s.id)) ? { ...s, name: names.get(String(s.id))! } : s));
      const slots = renamed.map((s, i) => (rank.has(String(s.id)) && !s.stallNumber ? i : -1)).filter(i => i >= 0);
      const inOrder = slots.map(i => renamed[i]).sort((a, b) => rank.get(String(a.id))! - rank.get(String(b.id))!);
      slots.forEach((slot, k) => (renamed[slot] = inOrder[k]));
      return renamed;
    });
    this.log(`${order.length} stalls named ${names.get(String(order[0].id))} … ${names.get(String(order.at(-1)!.id))}.`);
  }

  private nearestSide(stall: Stall, p: Point): { side?: GateSide; edge?: number; segment: [Point, Point] } {
    const poly = stallPolygon(stall);
    if (stall.footprint && stall.footprint.length >= 3) {
      let best = 0, bestD = Infinity;
      poly.forEach((a, i) => {
        const d = pointSegmentDistance(p, a, poly[(i + 1) % poly.length]);
        if (d < bestD) { bestD = d; best = i; }
      });
      return { edge: best, segment: [poly[best], poly[(best + 1) % poly.length]] };
    }
    const local = rotate({ x: p.x - stall.posX, z: p.z - stall.posZ }, -(stall.rotation ?? 0));
    const d: Record<GateSide, number> = {
      BACK: Math.abs(local.z + stall.length / 2),
      FRONT: Math.abs(local.z - stall.length / 2),
      LEFT: Math.abs(local.x + stall.width / 2),
      RIGHT: Math.abs(local.x - stall.width / 2)
    };
    const side = SIDES.reduce((a, b) => (d[b] < d[a] ? b : a));
    // Polygon corners run top-left clockwise: BACK 0, RIGHT 1, FRONT 2, LEFT 3.
    const i = { BACK: 0, RIGHT: 1, FRONT: 2, LEFT: 3 }[side];
    return { side, segment: [poly[i], poly[(i + 1) % 4]] };
  }

  private async openSideCommand(): Promise<void> {
    for (;;) {
      const a = await this.ask({
        kind: 'stall',
        message: 'Click near a stall edge to open or close it',
        preview: p => {
          const s = stallAt(this.stalls(), p);
          return s ? { edges: [this.nearestSide(s, p).segment] } : null;
        }
      });
      if (a.kind !== 'stall') return;
      const stall = this.stalls().find(s => String(s.id) === a.id);
      const p = this.cursor();
      if (!stall || !p) continue;
      const hit = this.nearestSide(stall, p);
      if (hit.side) {
        const has = stall.openSides.includes(hit.side);
        if (has && stall.openSides.length === 1) {
          this.log('A stall needs at least one open side.', 'error');
          continue;
        }
        const sides = has ? stall.openSides.filter(s => s !== hit.side) : [...stall.openSides, hit.side];
        if (this.updateStalls(new Set([a.id]), s => ({ ...s, openSides: sides, gateSide: sides[0] }), 'Open side')) {
          this.log(`${stall.stallNumber ?? stall.name}: ${SIDE_WORDS[hit.side]} side ${has ? 'closed' : 'opened'}.`, 'info');
        }
      } else if (hit.edge !== undefined) {
        const edges = stall.openEdges ?? [];
        const has = edges.includes(hit.edge);
        const next = has ? edges.filter(e => e !== hit.edge) : [...edges, hit.edge];
        this.updateStalls(new Set([a.id]), s => ({ ...s, openEdges: next }), 'Open side');
      }
    }
  }

  // --- inquiry ----------------------------------------------------------------------------------------------

  private cad(p: Point): string {
    const c = this.frame().toCad(p);
    return `${trim(c.x)}, ${trim(c.y)}`;
  }

  private async distCommand(): Promise<void> {
    const a = await this.ask({ kind: 'point', message: 'Specify first point' });
    if (a.kind !== 'point') return;
    const first = a.point;
    const b = await this.ask({
      kind: 'point', message: 'Specify second point', base: first, preview: p => ({ lines: [[first, p]] })
    });
    if (b.kind !== 'point') return;
    const dx = b.point.x - first.x, dy = first.z - b.point.z;
    this.log(`Distance = ${trim(dist(first, b.point), 3)} m, Angle = ${trim(cadAngle(first, b.point))}°, Delta X = ${trim(dx, 3)}, Delta Y = ${trim(dy, 3)}`);
  }

  private async areaCommand(): Promise<void> {
    const points: Point[] = [];
    for (;;) {
      const a = await this.ask({
        kind: 'point',
        message: points.length ? 'Specify next point or Enter to total' : 'Specify first corner point',
        keywords: points.length ? undefined : ['Object'],
        base: points.at(-1) ?? null,
        preview: p => ({ polygon: [...points, p] })
      });
      if (a.kind === 'keyword') {
        const s = await this.pickStall('Select a stall');
        if (s && typeof s !== 'string') {
          const poly = stallPolygon(s);
          this.log(`${s.stallNumber ?? s.name}: Area = ${trim(stallArea(s))} m², Perimeter = ${trim(perimeter(poly))} m`);
        }
        return;
      }
      if (a.kind !== 'point') break;
      points.push(a.point);
    }
    if (points.length < 3) {
      if (points.length) this.log('Needs at least three points.', 'error');
      return;
    }
    this.log(`Area = ${trim(Math.abs(shoelace(points)))} m², Perimeter = ${trim(perimeter(points))} m`);
  }

  private async idCommand(): Promise<void> {
    const a = await this.ask({ kind: 'point', message: 'Specify point' });
    if (a.kind === 'point') {
      const c = this.frame().toCad(a.point);
      this.log(`X = ${trim(c.x, 3)}   Y = ${trim(c.y, 3)}   (m from the plan's bottom-left corner)`);
    }
  }

  private async zoomCommand(): Promise<void> {
    const a = await this.ask({
      kind: 'point', message: 'Specify corner of window', keywords: ['Extents', 'Window', 'Selection'], defaultValue: 'Extents'
    });
    if (a.kind === 'empty' || (a.kind === 'keyword' && a.keyword === 'Extents')) return this.zoomExtents();
    if (a.kind === 'keyword' && a.keyword === 'Selection') {
      const box = boundsOfAll(this.selectedStalls());
      if (box) this.zoomTo(box, 3);
      else this.log('Nothing selected.', 'info');
      return;
    }
    let first: Point | null = a.kind === 'point' ? a.point : null;
    if (!first) {
      const b = await this.ask({ kind: 'point', message: 'Specify first corner' });
      if (b.kind !== 'point') return;
      first = b.point;
    }
    const corner = first;
    const c = await this.ask({
      kind: 'point', message: 'Specify opposite corner', base: corner, preview: p => ({ rect: rectOf(corner, p) })
    });
    if (c.kind === 'point') this.zoomTo(rectOf(corner, c.point), 0);
  }

  private async panCommand(): Promise<void> {
    this.panMode.set(true);
    try {
      await this.ask({ kind: 'text', message: 'Drag to pan. Press Esc or Enter to exit' });
    } finally {
      this.panMode.set(false);
    }
  }

  private async checkCommand(): Promise<void> {
    const entries = this.issues();
    const checked = this.stalls().length;
    if (!entries.length) {
      this.log(`No rule issues. ${checked} ${checked === 1 ? 'stall' : 'stalls'} checked against the venue rules.`);
      return;
    }
    const items = entries.flatMap(e => e.violations.map(v => ({ entry: e, violation: v })));
    this.log(`${items.length} rule ${items.length === 1 ? 'issue' : 'issues'} on ${entries.length} ${entries.length === 1 ? 'stall' : 'stalls'}.`, 'error');
    let i = 0;
    for (;;) {
      const { entry, violation } = items[i];
      const stall = this.store.currentStalls().find(s => String(s.id) === entry.stallId);
      this.selection.set(new Set([entry.stallId, ...violation.relatedStallIds]));
      const shapes = [
        ...(stall ? [stallPolygon(stall)] : []),
        ...violation.geometry.map(g => g.type === 'rect'
          ? [{ x: g.rect.minX, z: g.rect.minZ }, { x: g.rect.maxX, z: g.rect.maxZ }]
          : g.points)
      ].flat();
      if (shapes.length) this.zoomTo(polygonBounds(shapes), 8);
      this.log(`${i + 1}/${items.length} ${stall?.stallNumber ?? stall?.name ?? ''}: ${violation.message} (${violation.ruleRef})`, 'error');
      const a = await this.ask({
        kind: 'text', message: 'Next issue', keywords: ['Next', 'Previous', 'eXit'], defaultValue: 'Next'
      });
      if (a.kind === 'keyword' && a.keyword === 'eXit') return;
      i = a.kind === 'keyword' && a.keyword === 'Previous' ? (i - 1 + items.length) % items.length : i + 1;
      if (i >= items.length) {
        this.log('End of the issue list.', 'info');
        return;
      }
    }
  }

  // --- AI and PDF ---------------------------------------------------------------------------------------

  private async assistCommand(): Promise<void> {
    const a = await this.ask({ kind: 'text', message: 'Describe the stalls', spaces: true });
    if (a.kind !== 'text') return;
    const hall = this.hall()!;
    const run = this.runSeq;
    this.busy.set(true);
    this.log('Asking the layout assistant…', 'info');
    let plan;
    try {
      plan = await this.assistant.plan(a.text, hall, this.store.currentStalls(), this.store.grid()?.cellSize ?? 1);
    } catch (error) {
      this.log(error instanceof HttpErrorResponse && error.status === 0
        ? 'The layout assistant is not reachable (POST /api/layout/assist).'
        : extractErrorMessage(error), 'error');
      return;
    } finally {
      this.busy.set(false);
    }
    // Another command started while the assistant was thinking: drop this answer.
    if (run !== this.runSeq) return;
    if (plan.clarification) this.log(plan.clarification, 'info');
    if (plan.summary) this.log(plan.summary, 'info');

    if (plan.action === 'clear' && plan.removals?.length) {
      const ids = plan.removals.map(r => String(r.id)).filter(id => this.stalls().some(s => String(s.id) === id));
      if (!ids.length) return;
      this.selection.set(new Set(ids));
      const c = await this.ask({ kind: 'text', message: `Erase ${ids.length} highlighted stalls?`, keywords: ['Yes', 'No'], defaultValue: 'Yes' });
      if (c.kind === 'empty' || (c.kind === 'keyword' && c.keyword === 'Yes')) this.erase(ids);
      return;
    }

    const reviewed = this.store.reviewPlan(plan.stalls ?? []);
    if (!reviewed.length) {
      this.log('No stalls proposed.', 'info');
      return;
    }
    this.proposalIndex.set(0);
    try {
      for (;;) {
        const list = this.store.proposals() ?? [];
        const valid = list.filter(p => p.valid);
        if (!list.length) return;
        const area = valid.reduce((s, p) => s + p.footprint.width * p.footprint.length, 0);
        const current = list[Math.min(this.proposalIndex(), list.length - 1)];
        this.zoomTo(polygonBounds(stallPolygon(current.footprint)), 12);
        const c = await this.ask({
          kind: 'text',
          message: `${list.length} proposed · ${valid.length} pass the rules · ${trim(area)} m². #${this.proposalIndex() + 1} ${current.valid ? 'fits' : current.violations[0]?.message ?? 'breaks a rule'}. Accept`,
          keywords: ['All', 'Next', 'Drop', 'Cancel'],
          defaultValue: 'All'
        });
        if (c.kind === 'empty' || (c.kind === 'keyword' && c.keyword === 'All')) {
          if (!valid.length) {
            this.log('None of the proposals passes the rules.', 'error');
            continue;
          }
          const before = this.store.currentStalls().length;
          this.pushUndo('AI Assist');
          this.store.applyPlan();
          this.log(`${this.store.currentStalls().length - before} stalls added from the proposal.`);
          return;
        }
        if (c.kind !== 'keyword' || c.keyword === 'Cancel') return;
        if (c.keyword === 'Next') this.proposalIndex.set((this.proposalIndex() + 1) % list.length);
        else {
          const idx = this.proposalIndex();
          this.store.proposals.set(list.filter((_, k) => k !== idx));
          this.proposalIndex.set(Math.min(idx, Math.max(0, list.length - 2)));
        }
      }
    } finally {
      this.store.clearPlan();
    }
  }

  /** The PDF dialog read a file. */
  rememberPdf(file: File): void {
    this.lastPdf = file;
  }

  private async pdfPlotCommand(): Promise<void> {
    let file: File | null = null;
    if (this.lastPdf) {
      const a = await this.ask({ kind: 'text', message: 'Plot from PDF', keywords: ['New file'], defaultValue: this.lastPdf.name });
      file = a.kind === 'keyword' ? null : this.lastPdf;
    }
    const before = this.snapshot('Plot from PDF');
    this.store.openPdfImport(file);
    this.log(file
      ? `Reading ${file.name} again for ${this.hall()?.name ?? 'this hall'}.`
      : 'Pick the PDF. Its halls are matched to the halls already added; the stalls that pass the rules land on the canvas.', 'info');
    const closed = new Promise<void>(resolve => (this.pdfWaiter = resolve));
    await Promise.race([closed, this.ask({ kind: 'text', message: 'Plot from PDF (finish in the dialog)' }).then(() => undefined)]);
    this.pdfWaiter = null;
    this.answer({ kind: 'empty' });
    if (this.store.stalls() !== before.stalls) {
      this.undoStack.push(before);
      this.redoStack = [];
      this.syncUndoLabels();
      this.log(`${this.stalls().length} stalls on the canvas after the PDF plot.`);
      const broken = this.issues().length;
      if (broken) this.log(`${broken} ${broken === 1 ? 'stall breaks' : 'stalls break'} a rule (imported as drawn). CHK steps through them; the layout saves once they are fixed.`, 'error');
      this.zoomExtents();
    }
  }

  /** The PDF import dialog closed: PDFPLOT can finish. */
  pdfDialogClosed(): void {
    const done = this.pdfWaiter;
    this.pdfWaiter = null;
    done?.();
  }

  // --- saving and export ------------------------------------------------------------------------------

  private async saveCommand(): Promise<void> {
    if (!this.store.layoutName().trim()) {
      const hall = this.hall()!;
      const fallback = `${hall.name} · ${new Date().toISOString().slice(0, 10)}`;
      const a = await this.ask({ kind: 'text', message: 'Layout name', defaultValue: fallback, spaces: true });
      this.store.setLayoutName(a.kind === 'text' ? a.text : fallback);
    }
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.store.layoutName().trim()) this.store.setLayoutName(`${this.hall()?.name ?? 'Layout'} · ${new Date().toISOString().slice(0, 10)}`);
    const issues = this.issues().length;
    if (issues) {
      this.log(`Not saved: ${issues} ${issues === 1 ? 'stall breaks' : 'stalls break'} a venue rule. CHK steps through them.`, 'error');
      return;
    }
    this.busy.set(true);
    this.store.error.set('');
    try {
      if (this.store.selectedSavedId() === null) await this.store.saveLayout();
      else await this.store.updateLayout();
      if (!this.store.error()) {
        this.markClean();
        this.log(`Saved "${this.store.layoutName()}".`);
      }
    } finally {
      this.busy.set(false);
    }
  }

  exportForPortal(): void {
    const hall = this.hall();
    const plan = this.plan();
    if (!hall || !plan) return;
    const data = portalExport(hall.name, plan, this.store.currentStalls());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${hall.name.replace(/[^\w-]+/g, '_')}-portal-stalls.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.log(`${data.default_stalls.length} stalls exported for the booking portal.${data.skipped.length ? ` ${data.skipped.length} skipped: ${data.skipped.slice(0, 3).map(s => `${s.name} (${s.reason})`).join(', ')}${data.skipped.length > 3 ? '…' : ''}` : ''}`);
    if (data.skipped.length) this.notify.error('Some stalls were not exported', `${data.skipped.length} stalls are rotated, custom-shaped or off the 1 m grid, which the portal cannot show.`);
  }

  private help(): void {
    for (const c of COMMANDS) {
      const aliases = c.aliases.length ? ` (${c.aliases.join(', ')})` : '';
      this.log(`${c.name}${aliases}: ${c.help}`, 'info');
    }
    this.log('F3 OSNAP · F7 GRID · F8 ORTHO · F9 SNAP · F10 POLAR · F12 DYN · Enter repeats the last command · Esc cancels', 'info');
  }

  commandHelp(name: CommandName): string {
    return commandInfo(name).help;
  }
}

// --- helpers -------------------------------------------------------------------------------------------

function violationKey(v: Violation): string {
  return `${v.code}|${[...v.relatedStallIds].sort().join(',')}`;
}

function delta(a: Point, b: Point): Point {
  return { x: b.x - a.x, z: b.z - a.z };
}

function rectOf(a: Point, b: Point): Rect {
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

function shoelace(points: readonly Point[]): number {
  let s = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    s += a.x * b.z - b.x * a.z;
  });
  return s / 2;
}

function perimeter(points: readonly Point[]): number {
  return points.reduce((s, a, i) => s + dist(a, points[(i + 1) % points.length]), 0);
}

/**
 * Reading order for RENUMBER, in CAD sense (top of the plan first): stalls whose centres lie
 * within half a metre of each other share a row (or column).
 */
export function orderStalls<T extends Pick<Stall, 'posX' | 'posZ'>>(
  list: readonly T[],
  mode: 'Rows' | 'Columns' | 'Snake',
  frame: CadFrame
): T[] {
  const byRows = mode !== 'Columns';
  const key = (s: T) => {
    const c = frame.toCad({ x: s.posX, z: s.posZ });
    return byRows ? { line: -c.y, along: c.x } : { line: c.x, along: -c.y };
  };
  const sorted = [...list].sort((a, b) => key(a).line - key(b).line);
  const lines: T[][] = [];
  for (const s of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(key(last[0]).line - key(s).line) <= 0.5) last.push(s);
    else lines.push([s]);
  }
  return lines.flatMap((line, i) => {
    const ordered = line.sort((a, b) => key(a).along - key(b).along);
    return mode === 'Snake' && i % 2 === 1 ? ordered.reverse() : ordered;
  });
}
