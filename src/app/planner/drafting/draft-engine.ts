import type { GateSide, Stall } from '../models/stall.model';
import { formatStallNumber, type AuditEntry, type Point, type Rect } from '../geometry/placement-rules';
import { DraftFrame, fmt, parsePoint, parseSize, clean } from './draft-frame';

/**
 * The drafting command engine: AutoCAD's command line for stalls.
 *
 * A command is a generator that yields prompts ("Specify start point:") and receives what the
 * architect gives it: a picked point, typed text (coordinates are parsed into points first), or
 * Enter (empty text). Every change to the drawing is one `commit`, so Undo / Redo step through
 * whole commands, as in CAD. No Angular here: the workspace feeds it and draws its state.
 */

export type PromptWants = 'point' | 'text' | 'selection';

export interface DraftPreview {
  stalls?: Stall[];
  lines?: Array<[Point, Point]>;
  rect?: [Point, Point];
}

export interface Prompt {
  text: string;
  wants: PromptWants;
  /** Rubber-band origin: relative input, ORTHO and POLAR work from here. */
  base?: Point | null;
  preview?: (cursor: Point) => DraftPreview;
}

export type DraftInput = { kind: 'point'; point: Point } | { kind: 'text'; text: string };

/** What the engine needs from the workspace around it. */
export interface DraftHost {
  frame(): DraftFrame;
  hallId(): string | number | null;
  /** Stall number prefix of the hall's rules ("STALL-"). */
  prefix(): string;
  /** Current stall type size, width x length. */
  defaultSize(): [number, number];
  /** Rule issues of the drawing as it is now (after the last commit). */
  audit(): AuditEntry[];
  zoomTo(rect: Rect | 'extents'): void;
  action(name: 'pdf' | '3d' | 'save' | 'ai'): void;
}

type Command = (api: CommandApi) => Generator<Prompt, void, DraftInput>;

interface CommandDef {
  name: string;
  aliases: string[];
  run?: Command;
  /** Immediate commands: no prompts. */
  now?: (engine: DraftEngine) => void;
}

const MAX_UNDO = 200;
let idSeq = 0;

export class DraftEngine {
  stalls: Stall[] = [];
  selection = new Set<string>();
  log: string[] = [];
  prompt: Prompt | null = null;
  lastCommand: string | null = null;
  lastPoint: Point | null = null;
  private active: { name: string; gen: Generator<Prompt, void, DraftInput> } | null = null;
  private undoStack: Array<{ label: string; stalls: Stall[] }> = [];
  private redoStack: Array<{ label: string; stalls: Stall[] }> = [];

  /** Called after every change the workspace must show (drawing, selection, prompt, log). */
  onUpdate: () => void = () => undefined;
  /** Called when the drawing changed (to write it back to the planner). */
  onCommit: (stalls: Stall[]) => void = () => undefined;

  constructor(readonly host: DraftHost) {}

  get commandName(): string | null {
    return this.active?.name ?? null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** A new drawing (hall or layout switched): no history. */
  load(stalls: Stall[]): void {
    this.cancel(false);
    this.stalls = stalls;
    this.selection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.onUpdate();
  }

  /** The planner changed the stalls outside the engine (e.g. a PDF import): keep undo possible. */
  sync(stalls: Stall[]): void {
    if (stalls === this.stalls) return;
    this.stalls = stalls;
    for (const id of [...this.selection]) if (!stalls.some(s => String(s.id) === id)) this.selection.delete(id);
    this.onUpdate();
  }

  // --- command line ------------------------------------------------------------------------------

  /** Text typed at the command line and confirmed with Enter or Space. */
  enter(text: string, cursor: Point | null = null): void {
    const t = text.trim();
    if (!this.active) {
      if (!t) {
        if (this.lastCommand) this.run(this.lastCommand);
        return;
      }
      this.echo(`Command: ${t}`);
      this.run(t);
      return;
    }
    if (t) this.echo(t);
    const p = this.prompt;
    const point = t && p && p.wants === 'point' ? parsePoint(t, this.host.frame(), p.base ?? this.lastPoint, cursor) : null;
    this.feed(point ? { kind: 'point', point } : { kind: 'text', text: t });
  }

  /** A point picked on the canvas. */
  pick(point: Point): void {
    if (!this.active || this.prompt?.wants !== 'point') return;
    this.feed({ kind: 'point', point });
  }

  /** Esc: cancel the running command; with none, clear the selection. */
  escape(): void {
    if (this.active) {
      this.cancel(true);
    } else if (this.selection.size) {
      this.selection.clear();
      this.onUpdate();
    }
  }

  run(nameOrAlias: string): void {
    const def = findCommand(nameOrAlias);
    if (!def) {
      this.echo(`Unknown command "${nameOrAlias.toUpperCase()}". Type HELP for the list.`);
      this.onUpdate();
      return;
    }
    if (this.active) this.cancel(true);
    this.lastCommand = def.name;
    if (def.now) {
      def.now(this);
      this.onUpdate();
      return;
    }
    const gen = def.run!(this.api());
    this.active = { name: def.name, gen };
    this.advance(gen.next());
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) {
      this.echo('Nothing to undo.');
      return this.onUpdate();
    }
    this.redoStack.push({ label: step.label, stalls: this.stalls });
    this.apply(step.stalls);
    this.echo(`Undo ${step.label}`);
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) {
      this.echo('Nothing to redo.');
      return this.onUpdate();
    }
    this.undoStack.push({ label: step.label, stalls: this.stalls });
    this.apply(step.stalls);
    this.echo(`Redo ${step.label}`);
  }

  /** A change made outside a command (e.g. the properties palette): one undoable step. */
  commitEdit(label: string, stalls: Stall[]): void {
    this.commit(label, stalls);
  }

  // --- selection -------------------------------------------------------------------------------------

  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'remove' = 'replace'): void {
    if (mode === 'replace') this.selection.clear();
    for (const id of ids) {
      if (mode === 'remove') this.selection.delete(id);
      else this.selection.add(id);
    }
    this.onUpdate();
  }

  selectedStalls(): Stall[] {
    return this.stalls.filter(s => this.selection.has(String(s.id)));
  }

  // --- internals ---------------------------------------------------------------------------------------

  private feed(input: DraftInput): void {
    if (!this.active) return;
    if (input.kind === 'point') this.lastPoint = input.point;
    this.advance(this.active.gen.next(input));
  }

  private advance(step: IteratorResult<Prompt, void>): void {
    if (step.done) {
      this.active = null;
      this.prompt = null;
    } else {
      this.prompt = step.value;
    }
    this.onUpdate();
  }

  private cancel(echo: boolean): void {
    if (!this.active) return;
    this.active.gen.return(undefined);
    this.active = null;
    this.prompt = null;
    if (echo) this.echo('*Cancel*');
    this.onUpdate();
  }

  private echo(line: string): void {
    this.log.push(line);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  private apply(stalls: Stall[]): void {
    this.stalls = stalls;
    for (const id of [...this.selection]) if (!stalls.some(s => String(s.id) === id)) this.selection.delete(id);
    this.onCommit(stalls);
    this.onUpdate();
  }

  private commit(label: string, stalls: Stall[]): void {
    this.undoStack.push({ label, stalls: this.stalls });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.apply(stalls);
  }

  private api(): CommandApi {
    return {
      host: this.host,
      stalls: () => this.stalls,
      selection: () => this.selectedStalls(),
      select: ids => this.select(ids),
      commit: (label, stalls) => this.commit(label, stalls),
      log: line => this.echo(line),
      lastPoint: () => this.lastPoint,
    };
  }
}

export interface CommandApi {
  host: DraftHost;
  stalls(): Stall[];
  selection(): Stall[];
  select(ids: string[]): void;
  commit(label: string, stalls: Stall[]): void;
  log(line: string): void;
  lastPoint(): Point | null;
}

// --- helpers ---------------------------------------------------------------------------------------------

/** A new rectangular stall covering a world rectangle, open on `open`. */
export function makeStall(rect: Rect, name: string, open: GateSide[], hallId: string | number | null): Stall {
  return {
    id: `draft-${Date.now().toString(36)}-${idSeq++}`,
    hallId: hallId ?? 'draft',
    name,
    width: clean(rect.maxX - rect.minX),
    length: clean(rect.maxZ - rect.minZ),
    height: 3,
    posX: clean((rect.minX + rect.maxX) / 2),
    posZ: clean((rect.minZ + rect.maxZ) / 2),
    color: '#3498db',
    gateSide: open[0] ?? 'FRONT',
    openSides: open.length ? open : ['FRONT'],
    stallNumber: null,
    status: 'AVAILABLE',
    stallTypeId: null,
    rotation: 0,
  };
}

/** The next free number for a prefix, from the names and stall numbers already used. */
export function nextNumber(stalls: ReadonlyArray<Stall>, prefix: string): number {
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`);
  let max = 0;
  for (const s of stalls) {
    for (const v of [s.name, s.stallNumber]) {
      const m = v ? re.exec(v) : null;
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

/** A user-frame direction as the planner's side of a stall (FRONT = down the plan). */
function sideOf(dx: number, dy: number): GateSide {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : dy > 0 ? 'BACK' : 'FRONT';
}

/**
 * The stalls of a row from `a` to `b` (world points), along the dominant axis: as many whole
 * stalls as fit, `gap` metres apart. One row sits on the left of the drawing direction and opens
 * onto the line (the line is the aisle edge); back-to-back puts a second row on the right and the
 * line becomes their shared back, both rows opening away from it.
 */
export function rowStalls(
  frame: DraftFrame,
  a: Point,
  b: Point,
  size: [number, number],
  gap: number,
  backToBack: boolean,
  names: (i: number) => string,
  hallId: string | number | null,
): Stall[] {
  const A = frame.toUser(a);
  const B = frame.toUser(b);
  const horizontal = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
  const len = horizontal ? Math.abs(B.x - A.x) : Math.abs(B.y - A.y);
  const d = horizontal ? { x: Math.sign(B.x - A.x) || 1, y: 0 } : { x: 0, y: Math.sign(B.y - A.y) || 1 };
  const left = { x: -d.y, y: d.x };
  const [w, l] = size;
  const count = Math.floor((len + gap + 1e-9) / (w + gap));
  const out: Stall[] = [];
  const rows: Array<{ side: 1 | -1; open: GateSide }> = backToBack
    ? [
        { side: 1, open: sideOf(left.x, left.y) },
        { side: -1, open: sideOf(-left.x, -left.y) },
      ]
    : [{ side: 1, open: sideOf(-left.x, -left.y) }];
  let n = 0;
  for (const row of rows) {
    for (let i = 0; i < count; i++) {
      const t0 = i * (w + gap);
      const corners = [
        { x: A.x + d.x * t0, y: A.y + d.y * t0 },
        { x: A.x + d.x * (t0 + w) + left.x * l * row.side, y: A.y + d.y * (t0 + w) + left.y * l * row.side },
      ].map(u => frame.toWorld(u));
      const rect: Rect = {
        minX: Math.min(corners[0].x, corners[1].x),
        maxX: Math.max(corners[0].x, corners[1].x),
        minZ: Math.min(corners[0].z, corners[1].z),
        maxZ: Math.max(corners[0].z, corners[1].z),
      };
      out.push(makeStall(rect, names(n++), [row.open], hallId));
    }
  }
  return out;
}

/** Moves stalls by a world offset. */
export function moved(stalls: ReadonlyArray<Stall>, dx: number, dz: number): Stall[] {
  return stalls.map(s => ({ ...s, posX: clean(s.posX + dx), posZ: clean(s.posZ + dz) }));
}

const TURN_CCW: Record<GateSide, GateSide> = { FRONT: 'RIGHT', RIGHT: 'BACK', BACK: 'LEFT', LEFT: 'FRONT' };

/**
 * Rotates stalls about `base` by a CAD angle (counter-clockwise, degrees). Plain rectangles
 * turned by quarter turns stay axis-aligned (sizes and open sides swap); anything else keeps its
 * outline and gets the angle in `rotation` (clockwise degrees in the planner).
 */
export function rotated(stalls: ReadonlyArray<Stall>, base: Point, angleDeg: number): Stall[] {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const quarter = Math.abs(angleDeg / 90 - Math.round(angleDeg / 90)) < 1e-9;
  const turns = (((Math.round(angleDeg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return stalls.map(s => {
    // Screen / world Z points down: a counter-clockwise turn on the plan is (x, -z) rotated.
    const ux = s.posX - base.x;
    const uy = -(s.posZ - base.z);
    const rx = ux * cos - uy * sin;
    const ry = ux * sin + uy * cos;
    const pos = { posX: clean(base.x + rx), posZ: clean(base.z - ry) };
    if (quarter && !s.footprint?.length && !(s.rotation ?? 0)) {
      let open = [...s.openSides];
      for (let i = 0; i < turns; i++) open = open.map(o => TURN_CCW[o]);
      const swap = turns % 2 === 1;
      return {
        ...s,
        ...pos,
        width: swap ? s.length : s.width,
        length: swap ? s.width : s.length,
        openSides: open,
        gateSide: open[0],
      };
    }
    return { ...s, ...pos, rotation: clean(((((s.rotation ?? 0) - angleDeg) % 360) + 360) % 360) };
  });
}

/** Reading order: top row first, left to right (rows grouped within half a metre). */
export function readingOrder(stalls: ReadonlyArray<Stall>): Stall[] {
  return [...stalls].sort((a, b) => (Math.abs(a.posZ - b.posZ) > 0.5 ? a.posZ - b.posZ : a.posX - b.posX));
}

/** World bounds of stalls (their rectangles, rotation ignored: for zooming). */
export function stallBounds(stalls: ReadonlyArray<Stall>): Rect | null {
  if (!stalls.length) return null;
  const r = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const s of stalls) {
    const h = Math.max(s.width, s.length) / 2;
    r.minX = Math.min(r.minX, s.posX - h);
    r.maxX = Math.max(r.maxX, s.posX + h);
    r.minZ = Math.min(r.minZ, s.posZ - h);
    r.maxZ = Math.max(r.maxZ, s.posZ + h);
  }
  return r;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function freshCopy(s: Stall, name: string): Stall {
  const { parentStallNumber: _parent, ...rest } = s;
  return {
    ...rest,
    id: `draft-${Date.now().toString(36)}-${idSeq++}`,
    name,
    stallNumber: null,
    status: 'AVAILABLE',
    isSplitParent: false,
  };
}

function* askSize(api: CommandApi, current: [number, number]): Generator<Prompt, [number, number], DraftInput> {
  for (;;) {
    const input = yield { text: `Stall size <${current[0]}x${current[1]}>:`, wants: 'text' };
    if (input.kind !== 'text' || !input.text) return current;
    const size = parseSize(input.text);
    if (size) return size;
    api.log('Type the size as width x length, e.g. 3x2.');
  }
}

function* askNumber(api: CommandApi, text: string, current: number, min = -1e9): Generator<Prompt, number, DraftInput> {
  for (;;) {
    const input = yield { text: `${text} <${current}>:`, wants: 'text' };
    if (input.kind !== 'text' || !input.text) return current;
    const v = Number(input.text);
    if (Number.isFinite(v) && v >= min) return v;
    api.log('Requires a number.');
  }
}

/** Uses the current selection (noun-verb), else asks for one; null when nothing is selected. */
function* selectObjects(api: CommandApi): Generator<Prompt, Stall[] | null, DraftInput> {
  if (api.selection().length) return api.selection();
  for (;;) {
    const input = yield { text: 'Select objects (click, window or crossing; Enter to finish):', wants: 'selection' };
    if (input.kind === 'text' && /^all$/i.test(input.text)) {
      api.select(api.stalls().filter(s => s.status !== 'CANCELLED').map(s => String(s.id)));
      continue;
    }
    if (input.kind === 'text' && !input.text) {
      const sel = api.selection();
      if (!sel.length) api.log('Nothing selected.');
      return sel.length ? sel : null;
    }
  }
}

function reportIssues(api: CommandApi, ids: Set<string>): void {
  const issues = api.host.audit().filter(e => ids.has(e.stallId));
  if (!issues.length) return;
  const first = issues[0];
  const name = api.stalls().find(s => String(s.id) === first.stallId)?.name ?? first.stallId;
  const v = first.violations[0];
  api.log(`${issues.length} rule issue${issues.length === 1 ? '' : 's'}: ${name}: ${v.message}${v.ruleRef ? ` (${v.ruleRef})` : ''}`);
}

// --- commands ----------------------------------------------------------------------------------------

const stallCmd: Command = function* (api) {
  let size = api.host.defaultSize();
  const frame = api.host.frame();
  for (;;) {
    const prefix = api.host.prefix();
    const ghost = (c: Point): Stall => {
      const u = frame.toUser(c);
      const w0 = frame.toWorld(u);
      return makeStall({ minX: w0.x, maxX: w0.x + size[0], minZ: w0.z - size[1], maxZ: w0.z }, '', ['FRONT'], null);
    };
    const input = yield {
      text: `Specify insertion point (lower-left corner) or [Size/Rotate] <${size[0]}x${size[1]}>:`,
      wants: 'point',
      preview: c => ({ stalls: [ghost(c)] }),
    };
    if (input.kind === 'text') {
      if (!input.text) return;
      if (/^s(ize)?$/i.test(input.text)) size = yield* askSize(api, size);
      else if (/^r(otate)?$/i.test(input.text)) size = [size[1], size[0]];
      else if (parseSize(input.text)) size = parseSize(input.text)!;
      else api.log('Point or option keyword required.');
      continue;
    }
    const s = { ...ghost(input.point), name: formatStallNumber(prefix, nextNumber(api.stalls(), prefix)), hallId: api.host.hallId() ?? 'draft' };
    api.commit('STALL', [...api.stalls(), s]);
    api.log(`${s.name} placed, ${size[0]} × ${size[1]} m.`);
    reportIssues(api, new Set([String(s.id)]));
  }
};

const stallRowCmd: Command = function* (api) {
  const frame = api.host.frame();
  let size = yield* askSize(api, api.host.defaultSize());
  let prefix = api.host.prefix();
  let start = nextNumber(api.stalls(), prefix);
  for (;;) {
    const input = yield { text: `Numbering [Prefix/Start] <${formatStallNumber(prefix, start)} onwards>:`, wants: 'text' };
    if (input.kind !== 'text' || !input.text) break;
    if (/^p(refix)?$/i.test(input.text)) {
      const p = yield { text: `Prefix <${prefix}>:`, wants: 'text' };
      if (p.kind === 'text' && p.text) prefix = p.text;
      start = nextNumber(api.stalls(), prefix);
    } else if (/^s(tart)?$/i.test(input.text)) {
      start = Math.max(1, Math.round(yield* askNumber(api, 'Start number', start, 1)));
    } else {
      api.log('Prefix or Start, or Enter to accept.');
    }
  }
  const a = yield { text: 'Specify start point:', wants: 'point' };
  if (a.kind !== 'point') return;
  let gap = 0;
  let b2b = false;
  const names = (i: number) => formatStallNumber(prefix, start + i);
  for (;;) {
    const input = yield {
      text: `Specify end point or [Gap/Back-to-back] <gap ${gap} m${b2b ? ', back-to-back' : ''}>:`,
      wants: 'point',
      base: a.point,
      preview: c => ({ stalls: rowStalls(frame, a.point, c, size, gap, b2b, names, null), lines: [[a.point, c]] }),
    };
    if (input.kind === 'text') {
      if (!input.text) return;
      if (/^g(ap)?$/i.test(input.text)) gap = yield* askNumber(api, 'Gap between stalls (m)', gap, 0);
      else if (/^b/i.test(input.text)) b2b = !b2b;
      else api.log('Point or option keyword required.');
      continue;
    }
    const row = rowStalls(frame, a.point, input.point, size, gap, b2b, names, api.host.hallId());
    if (!row.length) {
      api.log(`The line is shorter than one ${size[0]} m stall.`);
      continue;
    }
    api.commit('STALLROW', [...api.stalls(), ...row]);
    const area = row.reduce((s, x) => s + x.width * x.length, 0);
    api.log(`${row.length} stalls created: ${row[0].name} … ${row[row.length - 1].name}. ${fmt(area, 1)} m² added.`);
    reportIssues(api, new Set(row.map(s => String(s.id))));
    return;
  }
};

function moveOrCopy(copy: boolean): Command {
  return function* (api) {
    const sel = yield* selectObjects(api);
    if (!sel) return;
    const base = yield { text: 'Specify base point:', wants: 'point' };
    if (base.kind !== 'point') return;
    const ids = new Set(sel.map(s => String(s.id)));
    for (;;) {
      const input = yield {
        text: copy ? 'Specify second point or [Exit] <Exit>:' : 'Specify second point:',
        wants: 'point',
        base: base.point,
        preview: c => ({ stalls: moved(sel, c.x - base.point.x, c.z - base.point.z), lines: [[base.point, c]] }),
      };
      if (input.kind !== 'point') return;
      const dx = input.point.x - base.point.x;
      const dz = input.point.z - base.point.z;
      const d = Math.hypot(dx, dz);
      if (!copy) {
        const next = api.stalls().map(s => (ids.has(String(s.id)) ? moved([s], dx, dz)[0] : s));
        api.commit('MOVE', next);
        api.log(`${sel.length} moved ${fmt(d)} m.`);
        reportIssues(api, ids);
        return;
      }
      const prefix = api.host.prefix();
      let n = nextNumber(api.stalls(), prefix);
      const copies = moved(sel, dx, dz).map(s => freshCopy(s, formatStallNumber(prefix, n++)));
      api.commit('COPY', [...api.stalls(), ...copies]);
      api.log(`${copies.length} copied ${fmt(d)} m: ${copies[0].name}${copies.length > 1 ? ` … ${copies[copies.length - 1].name}` : ''}.`);
      reportIssues(api, new Set(copies.map(s => String(s.id))));
    }
  };
}

const rotateCmd: Command = function* (api) {
  const sel = yield* selectObjects(api);
  if (!sel) return;
  const base = yield { text: 'Specify base point:', wants: 'point' };
  if (base.kind !== 'point') return;
  const ids = new Set(sel.map(s => String(s.id)));
  for (;;) {
    const input = yield {
      text: 'Specify rotation angle (degrees, counter-clockwise) <90>:',
      wants: 'point',
      base: base.point,
      preview: c => ({ stalls: rotated(sel, base.point, snapAngle(DraftFrame.angle(base.point, c))), lines: [[base.point, c]] }),
    };
    let angle: number;
    if (input.kind === 'point') angle = snapAngle(DraftFrame.angle(base.point, input.point));
    else if (!input.text) angle = 90;
    else if (Number.isFinite(Number(input.text))) angle = Number(input.text);
    else {
      api.log('Requires an angle or a point.');
      continue;
    }
    const byId = new Map(rotated(sel, base.point, angle).map(s => [String(s.id), s]));
    api.commit('ROTATE', api.stalls().map(s => byId.get(String(s.id)) ?? s));
    api.log(`${sel.length} rotated ${fmt(angle, 1)}°.`);
    reportIssues(api, ids);
    return;
  }
};

/** Picked angles snap to whole degrees; typed ones are taken as typed. */
function snapAngle(a: number): number {
  return Math.round(a);
}

const eraseCmd: Command = function* (api) {
  const sel = yield* selectObjects(api);
  if (!sel) return;
  const ids = new Set(sel.map(s => String(s.id)));
  // A stall that has a number from the server is cancelled (its number stays reserved); a new
  // one is simply removed.
  const next = api.stalls().flatMap(s =>
    !ids.has(String(s.id)) ? [s] : s.stallNumber ? [{ ...s, status: 'CANCELLED' as const }] : [],
  );
  api.commit('ERASE', next);
  const cancelled = sel.filter(s => s.stallNumber).length;
  api.log(`${sel.length} erased${cancelled ? ` (${cancelled} numbered stall${cancelled === 1 ? '' : 's'} cancelled, numbers kept)` : ''}.`);
  api.select([]);
};

const renumberCmd: Command = function* (api) {
  const targets = api.selection().length ? api.selection() : api.stalls().filter(s => s.status !== 'CANCELLED');
  if (!targets.length) {
    api.log('No stalls to number.');
    return;
  }
  let prefix = api.host.prefix();
  const p = yield { text: `Prefix <${prefix}>:`, wants: 'text' };
  if (p.kind === 'text' && p.text) prefix = p.text;
  const start = Math.max(1, Math.round(yield* askNumber(api, 'Start number', 1, 1)));
  const order = readingOrder(targets);
  const names = new Map(order.map((s, i) => [String(s.id), formatStallNumber(prefix, start + i)]));
  api.commit('RENUMBER', api.stalls().map(s => (names.has(String(s.id)) ? { ...s, name: names.get(String(s.id))! } : s)));
  api.log(
    `${order.length} stalls numbered ${names.get(String(order[0].id))} … ${names.get(String(order[order.length - 1].id))}, top row first, left to right. Server stall numbers are not changed.`,
  );
};

const zoomCmd: Command = function* (api) {
  const input = yield { text: 'Specify corner of window or [Extents/Window] <Extents>:', wants: 'point' };
  if (input.kind === 'text' && (!input.text || /^e/i.test(input.text))) {
    api.host.zoomTo('extents');
    return;
  }
  let first: Point | null = input.kind === 'point' ? input.point : null;
  if (!first) {
    const a = yield { text: 'Specify first corner:', wants: 'point' };
    if (a.kind !== 'point') return;
    first = a.point;
  }
  const corner = first;
  const b = yield { text: 'Specify opposite corner:', wants: 'point', base: corner, preview: c => ({ rect: [corner, c] }) };
  if (b.kind !== 'point') return;
  api.host.zoomTo({
    minX: Math.min(corner.x, b.point.x),
    maxX: Math.max(corner.x, b.point.x),
    minZ: Math.min(corner.z, b.point.z),
    maxZ: Math.max(corner.z, b.point.z),
  });
};

const distCmd: Command = function* (api) {
  const a = yield { text: 'Specify first point:', wants: 'point' };
  if (a.kind !== 'point') return;
  const b = yield { text: 'Specify second point:', wants: 'point', base: a.point, preview: c => ({ lines: [[a.point, c]] }) };
  if (b.kind !== 'point') return;
  const dx = b.point.x - a.point.x;
  const dy = -(b.point.z - a.point.z);
  api.log(
    `Distance = ${fmt(Math.hypot(dx, dy))} m,  Angle = ${fmt(DraftFrame.angle(a.point, b.point), 1)}°,  ΔX = ${fmt(dx)},  ΔY = ${fmt(dy)}`,
  );
};

const idCmd: Command = function* (api) {
  const a = yield { text: 'Specify point:', wants: 'point' };
  if (a.kind !== 'point') return;
  const u = api.host.frame().toUser(a.point);
  api.log(`X = ${fmt(u.x)}   Y = ${fmt(u.y)}`);
};

const checkCmd: Command = function* (api) {
  const issues = api.host.audit();
  if (!issues.length) {
    api.log('No rule issues. The drawing passes every venue rule.');
    return;
  }
  api.log(`${issues.length} stall${issues.length === 1 ? '' : 's'} with rule issues.`);
  for (let i = 0; i < issues.length; i++) {
    const e = issues[i];
    const s = api.stalls().find(x => String(x.id) === e.stallId);
    if (s) {
      api.select([e.stallId]);
      api.host.zoomTo({ minX: s.posX - 12, maxX: s.posX + 12, minZ: s.posZ - 8, maxZ: s.posZ + 8 });
    }
    for (const v of e.violations) api.log(`  ${s?.name ?? e.stallId}: ${v.message}${v.ruleRef ? ` (${v.ruleRef})` : ''}`);
    if (i === issues.length - 1) break;
    const input = yield { text: `Issue ${i + 1} of ${issues.length}. Next or [eXit] <Next>:`, wants: 'text' };
    if (input.kind === 'text' && /^x|^exit/i.test(input.text)) return;
  }
};

const helpCmd = (engine: DraftEngine): void => {
  for (const c of COMMANDS) engine.log.push(`  ${c.aliases.join(', ').padEnd(16)} ${c.name}`);
  engine.log.push('  Points: click, or type x,y  @dx,dy  @distance<angle  or a distance along the cursor.');
};

export const COMMANDS: CommandDef[] = [
  { name: 'STALL', aliases: ['STL', 'STALL'], run: stallCmd },
  { name: 'STALLROW', aliases: ['SR', 'STALLROW'], run: stallRowCmd },
  { name: 'MOVE', aliases: ['M', 'MOVE'], run: moveOrCopy(false) },
  { name: 'COPY', aliases: ['CO', 'CP', 'COPY'], run: moveOrCopy(true) },
  { name: 'ROTATE', aliases: ['RO', 'ROTATE'], run: rotateCmd },
  { name: 'ERASE', aliases: ['E', 'ERASE'], run: eraseCmd },
  { name: 'RENUMBER', aliases: ['RN', 'RENUMBER'], run: renumberCmd },
  { name: 'CHECK', aliases: ['CHK', 'CHECK'], run: checkCmd },
  { name: 'ZOOM', aliases: ['Z', 'ZOOM'], run: zoomCmd },
  { name: 'DIST', aliases: ['DI', 'DIST'], run: distCmd },
  { name: 'ID', aliases: ['ID'], run: idCmd },
  { name: 'UNDO', aliases: ['U', 'UNDO'], now: e => e.undo() },
  { name: 'REDO', aliases: ['REDO'], now: e => e.redo() },
  { name: 'PDFPLOT', aliases: ['PP', 'PDFPLOT'], now: e => e.host.action('pdf') },
  { name: 'ASSIST', aliases: ['AI', 'ASSIST'], now: e => e.host.action('ai') },
  { name: '3DPREVIEW', aliases: ['3D', '3DPREVIEW'], now: e => e.host.action('3d') },
  { name: 'SAVE', aliases: ['SAVE', 'QSAVE', 'QS'], now: e => e.host.action('save') },
  { name: 'HELP', aliases: ['HELP', '?'], now: helpCmd },
];

export function findCommand(text: string): CommandDef | undefined {
  const t = text.trim().toUpperCase();
  return COMMANDS.find(c => c.aliases.includes(t) || c.name === t);
}
