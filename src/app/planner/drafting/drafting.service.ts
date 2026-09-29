import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';

import { AiChatSession } from '../ai-chat-session.service';
import { floorOutlines, hallFloor, planBounds } from '../geometry/hall-plan';
import { placementContextFor, toPlacementStall } from '../geometry/hall-rules';
import { effectiveRules, type Point, type Rect } from '../geometry/placement-rules';
import { stallPolygon } from '../geometry/polygon-geometry';
import { GridSystem } from '../geometry/grid-system';
import type { Stall } from '../models/stall.model';
import { PlannerStore } from '../planner-store.service';
import { DraftFrame, orthoPoint, polarPoint } from './draft-frame';
import { DraftEngine, stallBounds, type DraftHost } from './draft-engine';

export type SnapKind = 'endpoint' | 'midpoint' | 'grid' | null;

export interface Toggles {
  grid: boolean;
  snap: boolean;
  ortho: boolean;
  osnap: boolean;
  polar: boolean;
  dyn: boolean;
}

/** F-key of each status-bar toggle, as in AutoCAD. */
export const TOGGLE_KEYS: Record<keyof Toggles, string> = {
  osnap: 'F3',
  grid: 'F7',
  ortho: 'F8',
  snap: 'F9',
  polar: 'F10',
  dyn: 'F12',
};

/**
 * The drafting workspace's state: the command engine on the planner's current hall and stalls,
 * the status-bar toggles, snapping, and view requests. The planner store stays the one source of
 * truth: every committed command writes the hall's stalls back to it, so the 3D preview, the
 * rule audit and saving all see exactly what is drawn.
 */
@Injectable()
export class DraftingService {
  readonly store = inject(PlannerStore);
  private readonly chat = inject(AiChatSession, { optional: true });

  readonly version = signal(0);
  readonly toggles = signal<Toggles>({ grid: true, snap: true, ortho: false, osnap: true, polar: false, dyn: true });
  readonly layers = signal({ base: true, stalls: true, labels: true });
  /** Snapped cursor in world metres, and what it snapped to. */
  readonly cursor = signal<{ point: Point; raw: Point; kind: SnapKind } | null>(null);
  readonly show3d = signal(false);
  readonly size = signal<[number, number]>([3, 3]);
  /** Bumped to ask the canvas to frame a rectangle ('extents' = the hall and its stalls). */
  readonly zoomRequest = signal<{ target: Rect | 'extents'; seq: number } | null>(null);

  readonly hall = this.store.currentHall;
  readonly grid = computed(() => {
    const hall = this.hall();
    return hall ? GridSystem.forHall(hall) : null;
  });
  readonly frame = computed(() => {
    const g = this.grid();
    return g ? new DraftFrame(g.originX, g.originZ + g.length) : new DraftFrame(0, 0);
  });
  readonly issues = computed(() => {
    const map = new Map<string, string[]>();
    for (const e of this.store.audit()) map.set(e.stallId, e.violations.map(v => `${v.message}${v.ruleRef ? ` (${v.ruleRef})` : ''}`));
    return map;
  });
  /** Hall outline, walls/holes and restricted zones in world metres, for drawing and snapping. */
  readonly base = computed(() => {
    const hall = this.hall();
    if (!hall) return { rings: [] as Point[][], obstacles: [] as Point[][], zones: [] as Array<{ polygon: Point[]; label: string }>, bounds: null as Rect | null };
    const ctx = placementContextFor(hall, [], this.store.eventType());
    return {
      rings: floorOutlines(hall).length ? floorOutlines(hall) : ctx.boundary ? [ctx.boundary] : [],
      obstacles: (ctx.obstacles ?? []).filter(o => o.length >= 3),
      zones: ctx.zones.filter(z => !z.hidden && z.polygon?.length >= 3).map(z => ({ polygon: z.polygon, label: z.label })),
      bounds: planBounds(hall),
      traced: hallFloor(hall).length > 0,
    };
  });

  readonly engine: DraftEngine;
  private loadedKey = '';

  constructor() {
    const host: DraftHost = {
      frame: () => this.frame(),
      hallId: () => this.store.activeHallId(),
      prefix: () => effectiveRules(this.hall()?.rules).stallNumberPrefix || 'STALL-',
      defaultSize: () => this.size(),
      audit: () => this.store.audit(),
      zoomTo: target => this.zoomRequest.set({ target, seq: (this.zoomRequest()?.seq ?? 0) + 1 }),
      action: name => this.action(name),
    };
    this.engine = new DraftEngine(host);
    this.engine.onUpdate = () => this.version.update(v => v + 1);
    this.engine.onCommit = stalls => this.writeBack(stalls);
    this.engine.log.push('Stall planner drafting. Type a command (HELP for the list), or pick a tool above.');

    // A new drawing when the hall or the open layout changes; otherwise follow outside edits
    // (e.g. a PDF import) without losing the undo history.
    effect(() => {
      const key = `${this.store.activeHallId()}|${this.store.selectedSavedId()}`;
      const stalls = this.store.currentStalls();
      untracked(() => {
        if (key !== this.loadedKey) {
          this.loadedKey = key;
          this.engine.load(stalls);
          this.zoomRequest.set({ target: 'extents', seq: (this.zoomRequest()?.seq ?? 0) + 1 });
        } else {
          this.engine.sync(stalls);
        }
      });
    });
  }

  toggle(name: keyof Toggles): void {
    this.toggles.update(t => {
      const next = { ...t, [name]: !t[name] };
      // ORTHO and POLAR exclude each other, as in AutoCAD.
      if (name === 'ortho' && next.ortho) next.polar = false;
      if (name === 'polar' && next.polar) next.ortho = false;
      return next;
    });
    const on = this.toggles()[name];
    this.engine.log.push(`<${name.toUpperCase()} ${on ? 'on' : 'off'}>`);
    this.version.update(v => v + 1);
  }

  /**
   * The point a raw cursor position stands for: an object snap (stall or wall corner, edge
   * midpoint) within `tolerance` metres wins, else the snap grid; then ORTHO / POLAR from the
   * prompt's base point.
   */
  snap(raw: Point, tolerance: number): { point: Point; raw: Point; kind: SnapKind } {
    const t = this.toggles();
    if (t.osnap) {
      const hit = this.objectSnap(raw, tolerance);
      if (hit) return { point: hit.point, raw, kind: hit.kind };
    }
    let p = raw;
    let kind: SnapKind = null;
    const g = this.grid();
    if (t.snap && g) {
      p = { x: g.snapX(raw.x), z: g.snapZ(raw.z) };
      kind = 'grid';
    }
    const base = this.engine.prompt?.wants === 'point' ? (this.engine.prompt.base ?? null) : null;
    if (base && t.ortho) p = orthoPoint(base, p);
    else if (base && t.polar) p = polarPoint(base, p, 15);
    return { point: p, raw, kind };
  }

  private objectSnap(raw: Point, tol: number): { point: Point; kind: 'endpoint' | 'midpoint' } | null {
    let best: { point: Point; kind: 'endpoint' | 'midpoint'; d: number } | null = null;
    const consider = (poly: Point[]) => {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        for (const [point, kind] of [[a, 'endpoint'], [mid, 'midpoint']] as const) {
          const d = Math.hypot(point.x - raw.x, point.z - raw.z);
          if (d <= tol && (!best || d < best.d - 1e-9)) best = { point, kind, d };
        }
      }
    };
    for (const s of this.engine.stalls) {
      if (s.status === 'CANCELLED') continue;
      if (Math.abs(s.posX - raw.x) > s.width + s.length + tol || Math.abs(s.posZ - raw.z) > s.width + s.length + tol) continue;
      consider(stallPolygon(toPlacementStall(s)));
    }
    if (this.layers().base) {
      const base = this.base();
      for (const r of base.rings) consider(r);
      for (const o of base.obstacles) consider(o);
    }
    const hit = best as { point: Point; kind: 'endpoint' | 'midpoint'; d: number } | null;
    return hit ? { point: hit.point, kind: hit.kind } : null;
  }

  /** The stall under a world point (topmost), or null. */
  stallAt(p: Point): Stall | null {
    const list = this.engine.stalls;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.status === 'CANCELLED') continue;
      if (inside(p, stallPolygon(toPlacementStall(s)))) return s;
    }
    return null;
  }

  /** Window (wholly inside) or crossing (touching) selection of a world rectangle. */
  stallsIn(rect: Rect, crossing: boolean): string[] {
    const out: string[] = [];
    for (const s of this.engine.stalls) {
      if (s.status === 'CANCELLED') continue;
      const poly = stallPolygon(toPlacementStall(s));
      const inRect = (p: Point) => p.x >= rect.minX && p.x <= rect.maxX && p.z >= rect.minZ && p.z <= rect.maxZ;
      const hit = crossing ? polyTouchesRect(poly, rect, inRect) : poly.every(inRect);
      if (hit) out.push(String(s.id));
    }
    return out;
  }

  extents(): Rect | null {
    const b = this.base().bounds;
    const s = stallBounds(this.engine.stalls.filter(x => x.status !== 'CANCELLED'));
    if (!b) return s;
    if (!s) return b;
    return { minX: Math.min(b.minX, s.minX), maxX: Math.max(b.maxX, s.maxX), minZ: Math.min(b.minZ, s.minZ), maxZ: Math.max(b.maxZ, s.maxZ) };
  }

  /** Name or open-side edits from the properties palette: one undoable step each. */
  editStalls(label: string, patch: (s: Stall) => Stall, ids: Iterable<string>): void {
    const set = new Set(ids);
    this.engine.commitEdit(label, this.engine.stalls.map(s => (set.has(String(s.id)) ? patch(s) : s)));
  }

  action(name: 'pdf' | '3d' | 'save' | 'ai'): void {
    if (name === '3d') {
      this.show3d.update(v => !v);
      this.engine.log.push(this.show3d() ? '3D preview on.' : '3D preview off.');
    } else if (name === 'pdf') {
      this.store.openPdfImport();
    } else if (name === 'ai') {
      if (this.chat) this.chat.open.set(true);
      else this.engine.log.push('The assistant is not available here.');
    } else {
      void this.save();
    }
    this.version.update(v => v + 1);
  }

  async save(): Promise<void> {
    if (this.store.busy()) return;
    this.engine.log.push(this.store.selectedSavedId() === null ? 'Saving a new layout…' : 'Saving changes…');
    this.version.update(v => v + 1);
    if (this.store.selectedSavedId() === null) await this.store.saveLayout();
    else await this.store.updateLayout();
    const issues = this.store.audit().length;
    this.engine.log.push(
      issues
        ? `Not saved: ${issues} stall${issues === 1 ? '' : 's'} break venue rules. Type CHK to go through them.`
        : this.store.error() ? 'Not saved: see the message.' : 'Layout saved.',
    );
    this.version.update(v => v + 1);
  }

  private writeBack(stalls: Stall[]): void {
    const hallId = this.store.activeHallId();
    this.store.stalls.update(all => [
      ...all.filter(s => String(s.hallId) !== String(hallId)),
      ...stalls.map(s => (String(s.hallId) === String(hallId) ? s : { ...s, hallId })),
    ]);
  }
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) c = !c;
  }
  return c;
}

function polyTouchesRect(poly: Point[], rect: Rect, inRect: (p: Point) => boolean): boolean {
  if (poly.some(inRect)) return true;
  const corners = [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ },
  ];
  if (corners.some(c => inside(c, poly))) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = 0; j < 4; j++) if (segmentsCross(a, b, corners[j], corners[(j + 1) % 4])) return true;
  }
  return false;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
