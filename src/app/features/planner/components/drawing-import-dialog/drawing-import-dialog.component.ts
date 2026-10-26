import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import type { AiFinding, DrawingImportResult } from '../../domain/drawing-import.models';
import { PlansApiService } from '../../data/plans-api.service';
import { type PlanStall, stallLabel } from '../../domain/plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import {
  type Alignment,
  autoFit,
  autoNumbers,
  bounds,
  centredAlignment,
  DRAWING_STEP,
  type FitMethod,
  importNotes,
  isNoOverride,
  notAStall,
  nudge,
  placeStalls,
  type QuarterTurn,
  type StallOverride,
  toPlanStall,
  twinNumbers,
  unnumbered,
} from '../../domain/drawing-import';
import type { PlannerStore } from '../../state/planner.store';

export interface DrawingImportData {
  store: PlannerStore;
  eventId: string;
  hallId: string;
  file: File;
}

/** The stalls to add, and the booths they replace (all of the hall's, when asked). */
export interface DrawingImportOutcome {
  stalls: PlanStall[];
  replacing: string[];
}

/** Server checks of the placed stalls wait for nudging to pause this long. */
const CHECK_DELAY = 500;
/** Checks without the stalls found breaking a rule, at most: as many as the import makes. */
const CHECK_ROUNDS = 4;

/**
 * Brings in the stalls of a hall's CAD plan PDF: the server reads the drawing and keeps this
 * hall's stalls (a plan of several halls is cut down; a plan of other halls is refused); here
 * they are placed on the hall's floor, checked against its rules and reviewed before anything
 * changes. An L-shaped stall comes in as its box with the cells outside it cut; only a stall
 * with a slanted edge is listed to draw by hand. One stall can be picked and moved, turned,
 * resized or left out on its own, on top of where the whole drawing goes.
 */
@Component({
  selector: 'app-drawing-import-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, CheckboxModule, TooltipModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drawing-import-dialog.component.html',
  styleUrl: './drawing-import-dialog.component.scss',
})
export class DrawingImportDialogComponent {
  protected readonly data = dialogData<DrawingImportData>();
  protected readonly ref = inject(DialogRef);
  protected readonly store = this.data.store;
  private readonly api = inject(PlansApiService);

  protected readonly state = signal<'reading' | 'failed' | 'ready'>('reading');
  protected readonly error = signal('');
  protected readonly result = signal<DrawingImportResult | null>(null);
  protected readonly alignment = signal<Alignment | null>(null);
  protected readonly method = signal<FitMethod>('fitted');
  protected readonly replace = signal(false);
  protected readonly downloading = signal(false);
  /** Stalls changed on their own, by drawing key; kept through a new alignment or fit. */
  protected readonly overrides = signal<ReadonlyMap<string, StallOverride>>(new Map());
  /** Stalls left out in the review, by drawing key. */
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  /** The stall picked in the preview, by drawing key. */
  protected readonly picked = signal<string | null>(null);
  /** Stall keys the server says break a rule where they stand now; null while it checks. */
  private readonly breaking = signal<Map<string, string[]> | null>(new Map());
  protected readonly checking = computed(() => this.breaking() === null);
  protected readonly broken = computed(() => this.breaking()?.size ?? 0);

  protected readonly hallName = computed(() => this.store.view()?.hall.hall.name ?? 'this hall');
  private readonly floor = computed(() => this.store.floor());
  /** The nudge moves by the drawing's step, so its grid stays on the hall's. */
  protected readonly step = signal(DRAWING_STEP);

  protected readonly otherHalls = computed(() => {
    const r = this.result();
    return r ? r.hall.drawingHalls.filter((g) => !r.hall.groups.includes(g)) : [];
  });

  protected readonly placed = computed(() => {
    const r = this.result();
    const a = this.alignment();
    const floor = this.floor();
    return r && a && floor
      ? placeStalls(
          r,
          r.groups.map((g) => g.group),
          a,
          floor,
          this.excluded(),
          this.overrides(),
        )
      : [];
  });
  protected readonly pickedStall = computed(
    () => this.placed().find((p) => p.stall.key === this.picked()) ?? null,
  );
  /** The stalls that become planner stalls, and the booths they replace. */
  private readonly prepared = computed(() => {
    const view = this.store.view();
    const plan = this.store.plan();
    const overrides = this.overrides();
    const keep = this.placed().filter((p) => !p.skip);
    // A number the drawing repeats would refuse both stalls: the repeats come in numbered on.
    const twins = twinNumbers(keep, overrides);
    // A stall the drawing gives no number comes in numbered S1, S2… in reading order.
    const autos = autoNumbers(keep, overrides);
    const stalls = keep.map((p) => {
      const o = overrides.get(p.stall.key);
      const twin = twins.get(p.stall.key);
      const auto = autos.get(p.stall.key);
      const stall = toPlanStall(
        p,
        plan.zones,
        view?.hall.categories ?? [],
        o?.name ?? auto ?? twin,
      );
      const notes = importNotes(p, stall, o);
      if (auto) {
        notes.unshift(`${p.stall.name} has no number in the drawing: it comes in as ${auto}.`);
      }
      if (twin) {
        notes.unshift(
          `${p.stall.name} is in the drawing twice: this one comes in as ${twin}. Check the number with the venue.`,
        );
      }
      return { key: p.stall.key, stall, notes, twin };
    });
    return { stalls, replacing: this.replace() ? plan.stalls.map((s) => s.id) : [] };
  });
  protected readonly importable = computed(() => this.prepared().stalls);
  protected readonly byHand = computed(() =>
    this.placed()
      .filter((p) => !p.rect)
      .map((p) => p.stall.name),
  );
  /** Stalls the drawing gives no number: numbered S1, S2… on import. */
  protected readonly unnumbered = computed(() =>
    this.placed()
      .filter((p) => unnumbered(p.stall))
      .map((p) => p.stall.name),
  );
  protected readonly offFloor = computed(
    () => this.placed().filter((p) => p.rect && !p.onFloor).length,
  );
  protected readonly problems = computed(() => {
    const r = this.result();
    if (!r) return [];
    const general = r.issues
      .filter((t, i) => r.hall.matchedByName || i > 0)
      .map((text) => ({ severity: 'warning', text }));
    const perStall = r.stalls.flatMap((s) =>
      s.issues
        .filter((i) => i.severity !== 'info')
        .map((i) => ({ severity: i.severity, text: `${s.name}: ${i.message}` })),
    );
    const labels = r.unresolved.map((u) => ({
      severity: 'warning',
      text: `${u.texts.join(' ')}: ${u.reason}`,
    }));
    // How the stalls come in: notches closed, areas off their labels, changes by hand.
    const imported = this.prepared().stalls.flatMap((s) =>
      s.notes.map((text) => ({ severity: 'warning', text })),
    );
    // A number the drawing gives twice: both are refused until one is numbered again.
    const seen = new Map<string, number>();
    for (const s of this.prepared().stalls) {
      const n = stallLabel(s.stall);
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    const twice = [...seen]
      .filter(([, n]) => n > 1)
      .map(([n]) => ({
        severity: 'error',
        text: `${n} is numbered ${seen.get(n)} times: pick one and give it a new number.`,
      }));
    const left = this.placed()
      .filter((p) => this.excluded().has(p.stall.key))
      .map((p) => ({ severity: 'warning', text: `${p.stall.name} left out by hand.` }));
    return [...twice, ...general, ...perStall, ...labels, ...imported, ...left];
  });

  protected readonly floorRings = computed(() =>
    (this.floor()?.floor ?? []).map((poly) => poly[0].map((p) => p.join(',')).join(' ')),
  );
  protected readonly blocked = computed(() => this.floor()?.blocked ?? []);
  /** The whole drawing on the hall; the view zooms and pans within it. */
  private readonly fullBox = computed(() => {
    const f = this.floor();
    const pts = [
      ...(f?.floor ?? []).flatMap((poly) => poly[0]),
      ...this.placed().flatMap((p) => p.outline.map((q) => [q.x, q.z] as [number, number])),
    ];
    if (!pts.length) return [0, 0, 10, 10];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const pad = Math.max(maxX - minX, maxY - minY) * 0.03;
    return [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad];
  });

  // ---- zoom and drag ---------------------------------------------------------------------

  protected readonly MAX_ZOOM = 12;
  /** 1 shows the whole drawing; more zooms in. */
  protected readonly zoom = signal(1);
  /** The view's centre from the drawing's centre, metres. */
  private readonly pan = signal({ x: 0, y: 0 });
  protected readonly dragging = signal(false);
  private readonly previewEl = viewChild<ElementRef<SVGSVGElement>>('preview');
  private drag: { id: number; x: number; y: number; pan: { x: number; y: number } } | null = null;
  /** A drag just ended: its click neither picks nor lets go a stall. */
  private dragged = false;

  protected readonly viewBox = computed(() => {
    const [x, y, w, h] = this.fullBox();
    const z = this.zoom();
    const { x: px, y: py } = this.pan();
    const [vw, vh] = [w / z, h / z];
    return `${x + w / 2 + px - vw / 2} ${y + h / 2 + py - vh / 2} ${vw} ${vh}`;
  });

  /** Zooms by a factor about a point of the drawing (the view's centre by default). */
  protected zoomBy(factor: number, at?: { x: number; y: number }): void {
    const before = this.zoom();
    const z = Math.min(this.MAX_ZOOM, Math.max(1, before * factor));
    if (z === before) return;
    if (z === 1) {
      this.resetView();
      return;
    }
    const [x, y, w, h] = this.fullBox();
    const { x: px, y: py } = this.pan();
    // The point under the cursor stays under it.
    const [cx, cy] = [x + w / 2 + px, y + h / 2 + py];
    const [ax, ay] = at ? [at.x, at.y] : [cx, cy];
    const k = before / z;
    this.pan.set({ x: ax + (cx - ax) * k - (x + w / 2), y: ay + (cy - ay) * k - (y + h / 2) });
    this.zoom.set(z);
  }

  protected resetView(): void {
    this.zoom.set(1);
    this.pan.set({ x: 0, y: 0 });
  }

  protected wheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, this.toDrawing(e.clientX, e.clientY) ?? undefined);
  }

  protected dragStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.dragged = false;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: this.pan() };
  }

  protected dragMove(e: PointerEvent): void {
    const d = this.drag;
    const svg = this.previewEl()?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!d || d.id !== e.pointerId || !svg || !ctm) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    // A few pixels are a click, not a drag.
    if (!this.dragging() && Math.hypot(dx, dy) < 4) return;
    if (!this.dragging()) {
      this.dragging.set(true);
      svg.setPointerCapture(e.pointerId);
    }
    this.pan.set({ x: d.pan.x - dx / ctm.a, y: d.pan.y - dy / ctm.d });
  }

  protected dragEnd(e: PointerEvent): void {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    this.dragged = this.dragging();
    this.drag = null;
    this.dragging.set(false);
  }

  /** A click on a stall or the floor, unless it ended a drag. */
  protected tap(key: string | null): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.pick(key);
  }

  /** A point of the screen in drawing metres. */
  private toDrawing(clientX: number, clientY: number): { x: number; y: number } | null {
    const ctm = this.previewEl()?.nativeElement.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  constructor() {
    void this.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const prepared = this.prepared();
      untracked(() => {
        clearTimeout(timer);
        if (!prepared.stalls.length) {
          this.breaking.set(new Map());
          return;
        }
        this.breaking.set(null);
        timer = setTimeout(() => void this.check(prepared), CHECK_DELAY);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  private async read(): Promise<void> {
    const { eventId, hallId, file } = this.data;
    try {
      const result = await firstValueFrom(this.api.readDrawing(eventId, hallId, file));
      const floor = this.floor();
      if (!floor) throw new Error('The hall floor is not loaded.');
      this.result.set(result);
      if (!result.stalls.length) {
        this.fail('The plan has no stalls of this hall that could be read.');
        return;
      }
      this.fitNow(result);
      this.state.set('ready');
    } catch (e) {
      const err = e as { error?: { message?: string | string[] }; message?: string };
      const message = err.error?.message ?? err.message ?? 'The plan could not be read.';
      this.fail(Array.isArray(message) ? message.join(' ') : message);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('failed');
  }

  private fitNow(result: DrawingImportResult): void {
    const floor = this.floor();
    if (!floor) return;
    const fit = autoFit(
      result,
      result.groups.map((g) => g.group),
      floor,
    );
    this.alignment.set(fit.alignment);
    this.method.set(fit.method);
  }

  protected fit(): void {
    const r = this.result();
    if (r) this.fitNow(r);
  }

  protected turnBy(quarter: 90): void {
    const r = this.result();
    const floor = this.floor();
    const a = this.alignment();
    if (!r || !floor || !a) return;
    const rotation = ((a.rotation + quarter) % 360) as QuarterTurn;
    this.alignment.set(
      centredAlignment(
        r,
        r.groups.map((g) => g.group),
        floor,
        rotation,
      ),
    );
    this.method.set('fitted');
  }

  protected move(dx: number, dz: number): void {
    const a = this.alignment();
    if (a) this.alignment.set(nudge(a, dx, dz));
  }

  // ---- one stall on its own ---------------------------------------------------------------

  protected findingKind(f: AiFinding): string {
    return f.kind === 'missing' ? 'Missing' : f.kind === 'extra' ? 'Extra' : 'Check';
  }

  protected findingStall(f: AiFinding): string | null {
    return f.stallKey
      ? (this.result()?.stalls.find((s) => s.key === f.stallKey)?.name ?? null)
      : null;
  }

  /** A finding about a stall picks it on the drawing. */
  protected focusFinding(f: AiFinding): void {
    if (f.stallKey) this.pick(f.stallKey);
  }

  protected pick(key: string | null): void {
    this.picked.set(key);
  }

  /** Arrow keys move the picked stall a metre (Shift: half); Escape lets it go. */
  protected key(e: KeyboardEvent): void {
    if (!this.picked()) return;
    const step = e.shiftKey ? 0.5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    if (e.key === 'Escape') {
      // Lets the stall go, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      this.pick(null);
    } else if (moves[e.key]) {
      e.preventDefault();
      this.shift(...moves[e.key]);
    }
  }

  protected shift(dx: number, dz: number): void {
    this.change((o) => ({ ...o, dx: o.dx + dx, dz: o.dz + dz }));
  }

  protected turnOne(): void {
    // A turn swaps width and depth, so a size set by hand turns with it.
    this.change((o) => ({
      ...o,
      turn: (((o.turn ?? 0) + 90) % 360) as QuarterTurn,
      width: o.depth,
      depth: o.width,
    }));
  }

  protected resize(side: 'width' | 'depth', e: Event): void {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (!(v >= 1)) return;
    this.change((o) => ({ ...o, [side]: v }));
  }

  /** A new number for the picked stall; its drawn number, or nothing, puts the drawn one back. */
  protected rename(e: Event): void {
    const p = this.pickedStall();
    if (!p) return;
    const name = (e.target as HTMLInputElement).value.trim();
    this.change((o) => ({ ...o, name: name && name !== p.stall.name ? name : undefined }));
  }

  /** The number a stall comes in with: given by hand, numbered on as a repeat, or as drawn. */
  protected nameOf(key: string, drawn: string): string {
    return (
      this.overrides().get(key)?.name ??
      this.prepared().stalls.find((s) => s.key === key)?.twin ??
      drawn
    );
  }

  /** Whether the server doubted the outline is a stall: the review may say it is. */
  protected doubted(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): boolean {
    return notAStall(p.stall) !== null;
  }

  /**
   * Takes a doubted outline as a stall, or not. Its name then loses the "(s34)" the server adds
   * to an outline with no letter, so "2F-08 (s34)" comes in as 2F-08.
   */
  protected takeAsStall(yes: boolean): void {
    const p = this.pickedStall();
    if (!p) return;
    const plain = p.stall.name.replace(/\s*\(s\d+\)$/, '').trim();
    this.change((o) => ({
      ...o,
      isStall: yes || undefined,
      name: yes && !o.name && plain && plain !== p.stall.name ? plain : yes ? o.name : undefined,
    }));
  }

  protected leaveOut(out: boolean): void {
    const key = this.picked();
    if (!key) return;
    const next = new Set(this.excluded());
    if (out) next.add(key);
    else next.delete(key);
    this.excluded.set(next);
  }

  protected resetOne(): void {
    const key = this.picked();
    if (!key) return;
    const next = new Map(this.overrides());
    next.delete(key);
    this.overrides.set(next);
  }

  /** Changes the picked stall's override; one that changes nothing is dropped. */
  private change(fn: (o: StallOverride) => StallOverride): void {
    const key = this.picked();
    if (!key) return;
    const next = new Map(this.overrides());
    const o = fn(next.get(key) ?? { dx: 0, dz: 0 });
    if (o.width === undefined) delete o.width;
    if (o.depth === undefined) delete o.depth;
    if (!o.name) delete o.name;
    if (!o.isStall) delete o.isStall;
    if (isNoOverride(o)) next.delete(key);
    else next.set(key, o);
    this.overrides.set(next);
  }

  /** Where the picked stall's number goes: the middle of its box. */
  protected tagAt(outline: Array<{ x: number; z: number }>): { x: number; z: number } {
    const b = bounds(outline);
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }

  /** The number's size in floor metres, readable whatever the hall's size. */
  protected readonly tagSize = computed(() => {
    const [, , w, h] = this.viewBox().split(' ').map(Number);
    return Math.max(w, h) / 40;
  });

  protected stateOf(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): string {
    if (this.excluded().has(p.stall.key)) return 'out';
    if (!p.rect) return 'hand';
    if (!p.onFloor) return 'bad';
    // Not brought in for another reason (not a stall, no number): grey, never green.
    if (p.skip) return 'hand';
    // Inside the hall, but a rule of the hall stops it: hover to read which.
    if (this.breaking()?.has(p.stall.key)) return 'rule';
    return 'ok';
  }

  /** Why a stall is red or left out, in words; empty for one that comes in. */
  protected whyOf(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): string[] {
    const why = p.skip ? [p.skip] : [];
    return [...why, ...(this.breaking()?.get(p.stall.key) ?? [])];
  }

  protected plural(n: number, word: string): string {
    return `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
  }

  protected pointsOf(outline: Array<{ x: number; z: number }>): string {
    return outline.map((p) => `${p.x},${p.z}`).join(' ');
  }

  /**
   * Asks the server which placed stalls break a rule, with the booths that stay. Checked again
   * without the ones that do, as the import leaves them out: a stall can pass only beside one
   * that is left out (an open side facing it), and fail once it is gone. Rounds as many as the
   * import's own (`PlannerStore.addPassing`), so what shows green is what comes in.
   */
  private async check(prepared: {
    stalls: Array<{ key: string; stall: PlanStall }>;
    replacing: string[];
  }): Promise<void> {
    const plan = this.store.plan();
    const kept = plan.stalls.filter((s) => !prepared.replacing.includes(s.id));
    const keyOf = new Map(prepared.stalls.map((s) => [s.stall.id, s.key]));
    // Each stall's broken rules, in the server's words, to show why it is red.
    const bad = new Map<string, string[]>();
    let stalls = prepared.stalls.map((s) => s.stall);
    for (let round = 0; round < CHECK_ROUNDS && stalls.length; round++) {
      const findings = await this.store.check(
        { ...plan, stalls: [...kept, ...stalls] },
        stalls.map((s) => s.id),
      );
      if (prepared !== this.prepared()) return;
      let found = false;
      for (const f of findings ?? []) {
        for (const id of f.ids) {
          const key = keyOf.get(id);
          if (!key) continue;
          const why = bad.get(key) ?? [];
          if (!why.includes(f.message)) why.push(f.message);
          bad.set(key, why);
          found = true;
        }
      }
      if (!found) break;
      stalls = stalls.filter((s) => !bad.has(keyOf.get(s.id)!));
    }
    this.breaking.set(bad);
  }

  protected async downloadDxf(): Promise<void> {
    const { eventId, hallId, file } = this.data;
    this.downloading.set(true);
    try {
      const blob = await firstValueFrom(this.api.drawingDxf(eventId, hallId, file));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '') + '.dxf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.downloading.set(false);
    }
  }

  protected use(): void {
    const prepared = this.prepared();
    const bad = this.breaking() ?? new Map<string, string[]>();
    const stalls = prepared.stalls.filter((s) => !bad.has(s.key)).map((s) => s.stall);
    if (!stalls.length) return;
    this.ref.close({ stalls, replacing: prepared.replacing } satisfies DrawingImportOutcome);
  }
}
