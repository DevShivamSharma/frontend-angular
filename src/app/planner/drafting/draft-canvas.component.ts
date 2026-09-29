import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  untracked,
  viewChild,
} from '@angular/core';

import { toPlacementStall } from '../geometry/hall-rules';
import type { Point, Rect } from '../geometry/placement-rules';
import { openEdgeList, stallPolygon } from '../geometry/polygon-geometry';
import { interiorPoint } from '../geometry/footprint-view';
import type { Stall } from '../models/stall.model';
import { DraftFrame, fmt } from './draft-frame';
import type { DraftPreview } from './draft-engine';
import { DraftingService } from './drafting.service';

const COLORS = {
  space: '#1d2330',
  gridMinor: 'rgba(148, 163, 184, 0.10)',
  gridMajor: 'rgba(148, 163, 184, 0.22)',
  floorFill: '#262e3d',
  floorLine: '#94a3b8',
  obstacle: '#465063',
  zone: '#f59e0b',
  stallLine: '#e2e8f0',
  issue: '#f87171',
  selected: '#60a5fa',
  open: '#4ade80',
  ghost: '#22d3ee',
  snap: '#facc15',
  cross: '#e5e7eb',
  label: '#f8fafc',
};

/**
 * The model space: a 2D Canvas drawing of the hall base, the grid and every stall, redrawn only
 * when something changed. Wheel zooms at the cursor, the middle button pans (double-click it for
 * extents), the left button picks points or selects: click to add, Shift+click to remove, drag
 * left-to-right for a window (wholly inside), right-to-left for a crossing (touching).
 */
@Component({
  selector: 'app-draft-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas tabindex="-1" aria-label="Drawing area"
    (wheel)="onWheel($event)" (pointerdown)="onDown($event)" (pointermove)="onMove($event)"
    (pointerup)="onUp($event)" (pointerleave)="onLeave()" (dblclick)="onDblClick($event)"
    (auxclick)="$event.preventDefault()" (contextmenu)="onContext($event)"></canvas>`,
  styles: `
    :host { display: block; position: relative; overflow: hidden; background: ${COLORS.space}; }
    canvas { display: block; width: 100%; height: 100%; cursor: none; touch-action: none; }
  `,
})
export class DraftCanvasComponent {
  private readonly draft = inject(DraftingService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** World point at the centre of the view, and pixels per metre. */
  private cx = 0;
  private cz = 0;
  private scale = 8;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private screen: { x: number; y: number } | null = null;
  private pan: { x: number; y: number; cx: number; cz: number } | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number; shift: boolean } | null = null;
  private lastMiddle = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      const resize = new ResizeObserver(() => this.resize());
      resize.observe(canvas);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        cancelAnimationFrame(this.frame);
      });
      this.resize();
      this.fit(this.draft.extents());
    });

    // Redraw on any change of drawing, prompt, toggles, layers, audit or hall.
    effect(() => {
      this.draft.version();
      this.draft.toggles();
      this.draft.layers();
      this.draft.issues();
      this.draft.base();
      this.draft.cursor();
      untracked(() => this.invalidate());
    });
    effect(() => {
      const req = this.draft.zoomRequest();
      if (!req) return;
      untracked(() => this.fit(req.target === 'extents' ? this.draft.extents() : req.target));
    });
  }

  // --- view --------------------------------------------------------------------------------------

  fit(rect: Rect | null): void {
    if (!rect || !this.width || !this.height) return this.invalidate();
    const w = Math.max(rect.maxX - rect.minX, 1);
    const h = Math.max(rect.maxZ - rect.minZ, 1);
    this.scale = Math.min(this.width / (w * 1.08), this.height / (h * 1.08));
    this.cx = (rect.minX + rect.maxX) / 2;
    this.cz = (rect.minZ + rect.maxZ) / 2;
    this.invalidate();
  }

  private toWorld(x: number, y: number): Point {
    return { x: this.cx + (x - this.width / 2) / this.scale, z: this.cz + (y - this.height / 2) / this.scale };
  }

  private sx(x: number): number {
    return (x - this.cx) * this.scale + this.width / 2;
  }

  private sy(z: number): number {
    return (z - this.cz) * this.scale + this.height / 2;
  }

  private resize(): void {
    const canvas = this.canvasRef().nativeElement;
    const r = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.invalidate();
  }

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  // --- input -------------------------------------------------------------------------------------

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const before = this.toWorld(p.x, p.y);
    const factor = Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0018);
    this.scale = Math.max(0.2, Math.min(400, this.scale * factor));
    const after = this.toWorld(p.x, p.y);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.updateCursor(p);
  }

  onDown(e: PointerEvent): void {
    const p = this.local(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastMiddle < 350) this.fit(this.draft.extents());
      this.lastMiddle = now;
      this.pan = { x: p.x, y: p.y, cx: this.cx, cz: this.cz };
      return;
    }
    if (e.button !== 0) return;
    const engine = this.draft.engine;
    if (engine.prompt?.wants === 'point') {
      const c = this.draft.snap(this.toWorld(p.x, p.y), this.tolerance());
      engine.pick(c.point);
      return;
    }
    this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey };
  }

  onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.pan) {
      this.cx = this.pan.cx - (p.x - this.pan.x) / this.scale;
      this.cz = this.pan.cz - (p.y - this.pan.y) / this.scale;
    }
    if (this.box) {
      this.box.x1 = p.x;
      this.box.y1 = p.y;
    }
    this.updateCursor(p);
  }

  onUp(e: PointerEvent): void {
    if (e.button === 1) {
      this.pan = null;
      return;
    }
    const box = this.box;
    this.box = null;
    if (!box) return this.invalidate();
    const engine = this.draft.engine;
    const dragged = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 4;
    if (dragged) {
      const a = this.toWorld(box.x0, box.y0);
      const b = this.toWorld(box.x1, box.y1);
      const rect = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
      const ids = this.draft.stallsIn(rect, box.x1 < box.x0);
      engine.select(ids, box.shift ? 'remove' : 'add');
    } else {
      const hit = this.draft.stallAt(this.toWorld(box.x0, box.y0));
      if (hit) engine.select([String(hit.id)], box.shift ? 'remove' : 'add');
      else if (!box.shift && engine.prompt?.wants !== 'selection') engine.select([], 'replace');
    }
    this.invalidate();
  }

  onLeave(): void {
    this.screen = null;
    this.draft.cursor.set(null);
  }

  onDblClick(e: MouseEvent): void {
    e.preventDefault();
  }

  /** Right-click is Enter, as with AutoCAD's default right-click behaviour during a command. */
  onContext(e: MouseEvent): void {
    e.preventDefault();
    if (this.draft.engine.commandName) this.draft.engine.enter('', this.draft.cursor()?.point ?? null);
  }

  private tolerance(): number {
    return 10 / this.scale;
  }

  private updateCursor(p: { x: number; y: number }): void {
    this.screen = p;
    this.draft.cursor.set(this.draft.snap(this.toWorld(p.x, p.y), this.tolerance()));
    this.invalidate();
  }

  // --- drawing -----------------------------------------------------------------------------------

  private draw(): void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.space;
    ctx.fillRect(0, 0, this.width, this.height);

    const layers = this.draft.layers();
    const toggles = this.draft.toggles();
    const base = this.draft.base();
    if (layers.base) this.drawBase(ctx, base);
    if (toggles.grid) this.drawGrid(ctx);
    if (layers.stalls) this.drawStalls(ctx, layers.labels);

    const engine = this.draft.engine;
    const cursor = this.draft.cursor();
    if (engine.prompt?.preview && cursor) this.drawPreview(ctx, engine.prompt.preview(cursor.point));
    if (engine.prompt?.base && cursor && engine.prompt.wants === 'point') {
      const b = engine.prompt.base;
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.sx(b.x), this.sy(b.z));
      ctx.lineTo(this.sx(cursor.point.x), this.sy(cursor.point.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.box) this.drawBox(ctx, this.box);
    if (cursor && this.screen) this.drawCursor(ctx, cursor.point, cursor.kind);
    if (cursor && this.screen && toggles.dyn) this.drawDyn(ctx, cursor.point);
  }

  private path(ctx: CanvasRenderingContext2D, poly: ReadonlyArray<Point>): void {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(this.sx(p.x), this.sy(p.z)) : ctx.moveTo(this.sx(p.x), this.sy(p.z))));
    ctx.closePath();
  }

  private drawBase(ctx: CanvasRenderingContext2D, base: ReturnType<DraftingService['base']>): void {
    ctx.lineWidth = 1.5;
    for (const r of base.rings) {
      this.path(ctx, r);
      ctx.fillStyle = COLORS.floorFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.floorLine;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.obstacle;
    for (const o of base.obstacles) {
      this.path(ctx, o);
      ctx.fill();
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = COLORS.zone;
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
    for (const z of base.zones) {
      this.path(ctx, z.polygon);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const g = this.draft.grid();
    if (!g) return;
    const cell = g.cellSize || 1;
    const b = g.bounds;
    const x0 = this.sx(b.minX);
    const x1 = this.sx(b.maxX);
    const y0 = this.sy(b.minZ);
    const y1 = this.sy(b.maxZ);
    const lines = (step: number, color: string) => {
      if (step * this.scale < 6) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = b.minX; x <= b.maxX + 1e-9; x += step) {
        const s = Math.round(this.sx(x)) + 0.5;
        if (s < -1 || s > this.width + 1) continue;
        ctx.moveTo(s, Math.max(0, y0));
        ctx.lineTo(s, Math.min(this.height, y1));
      }
      for (let z = b.minZ; z <= b.maxZ + 1e-9; z += step) {
        const s = Math.round(this.sy(z)) + 0.5;
        if (s < -1 || s > this.height + 1) continue;
        ctx.moveTo(Math.max(0, x0), s);
        ctx.lineTo(Math.min(this.width, x1), s);
      }
      ctx.stroke();
    };
    lines(cell, COLORS.gridMinor);
    lines(cell * 5, COLORS.gridMajor);
  }

  private drawStalls(ctx: CanvasRenderingContext2D, labels: boolean): void {
    const engine = this.draft.engine;
    const issues = this.draft.issues();
    const view = this.toWorld(0, 0);
    const view2 = this.toWorld(this.width, this.height);
    for (const s of engine.stalls) {
      const r = Math.max(s.width, s.length);
      if (s.posX + r < view.x || s.posX - r > view2.x || s.posZ + r < view.z || s.posZ - r > view2.z) continue;
      const cancelled = s.status === 'CANCELLED';
      const selected = engine.selection.has(String(s.id));
      const bad = issues.has(String(s.id));
      this.drawStall(ctx, s, {
        fill: cancelled ? 'transparent' : s.color,
        line: selected ? COLORS.selected : bad ? COLORS.issue : cancelled ? '#64748b' : COLORS.stallLine,
        dashed: cancelled || selected,
        width: selected || bad ? 2 : 1,
      });
      if (selected) this.drawGrips(ctx, s);
      if (labels && !cancelled && this.scale >= 9) this.drawLabel(ctx, s);
    }
  }

  private drawStall(
    ctx: CanvasRenderingContext2D,
    s: Stall,
    style: { fill: string; line: string; dashed: boolean; width: number },
  ): void {
    const fp = toPlacementStall(s);
    const poly = stallPolygon(fp);
    this.path(ctx, poly);
    if (style.fill !== 'transparent') {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash(style.dashed ? [5, 3] : []);
    ctx.strokeStyle = style.line;
    ctx.lineWidth = style.width;
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.status !== 'CANCELLED') {
      ctx.strokeStyle = COLORS.open;
      ctx.lineWidth = Math.max(2, Math.min(4, this.scale * 0.15));
      ctx.beginPath();
      for (const { index } of openEdgeList(fp)) {
        const a = poly[index];
        const b = poly[(index + 1) % poly.length];
        ctx.moveTo(this.sx(a.x), this.sy(a.z));
        ctx.lineTo(this.sx(b.x), this.sy(b.z));
      }
      ctx.stroke();
    }
  }

  private drawGrips(ctx: CanvasRenderingContext2D, s: Stall): void {
    ctx.fillStyle = COLORS.selected;
    for (const p of stallPolygon(toPlacementStall(s))) ctx.fillRect(this.sx(p.x) - 3, this.sy(p.z) - 3, 6, 6);
  }

  private drawLabel(ctx: CanvasRenderingContext2D, s: Stall): void {
    // An L-shape's label goes inside the L, never in its notch (rotation included).
    const at = s.footprint?.length ? interiorPoint(stallPolygon(toPlacementStall(s))) : { x: s.posX, z: s.posZ };
    const size = Math.max(9, Math.min(13, this.scale * 0.45));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.label;
    const maxW = Math.min(s.width, s.length) * this.scale;
    const name = s.name.length * size * 0.55 > maxW * 1.6 && s.name.includes('-') ? s.name.split('-').pop()! : s.name;
    ctx.fillText(name, this.sx(at.x), this.sy(at.z));
  }

  private drawPreview(ctx: CanvasRenderingContext2D, preview: DraftPreview): void {
    for (const s of preview.stalls ?? []) this.drawStall(ctx, s, { fill: COLORS.ghost, line: COLORS.ghost, dashed: true, width: 1.5 });
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = 1;
    for (const [a, b] of preview.lines ?? []) {
      ctx.beginPath();
      ctx.moveTo(this.sx(a.x), this.sy(a.z));
      ctx.lineTo(this.sx(b.x), this.sy(b.z));
      ctx.stroke();
    }
    if (preview.rect) {
      const [a, b] = preview.rect;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.sx(Math.min(a.x, b.x)), this.sy(Math.min(a.z, b.z)), Math.abs(b.x - a.x) * this.scale, Math.abs(b.z - a.z) * this.scale);
      ctx.setLineDash([]);
    }
  }

  private drawBox(ctx: CanvasRenderingContext2D, box: { x0: number; y0: number; x1: number; y1: number }): void {
    const crossing = box.x1 < box.x0;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    ctx.fillStyle = crossing ? 'rgba(34, 197, 94, 0.14)' : 'rgba(59, 130, 246, 0.16)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = crossing ? '#22c55e' : '#3b82f6';
    ctx.setLineDash(crossing ? [5, 4] : []);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  private drawCursor(ctx: CanvasRenderingContext2D, p: Point, kind: string | null): void {
    const x = Math.round(this.sx(p.x)) + 0.5;
    const y = Math.round(this.sy(p.z)) + 0.5;
    const arm = 22;
    ctx.strokeStyle = COLORS.cross;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
    if (this.draft.engine.prompt?.wants !== 'point') ctx.strokeRect(x - 4, y - 4, 8, 8);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 2;
    if (kind === 'endpoint') ctx.strokeRect(x - 6, y - 6, 12, 12);
    if (kind === 'midpoint') {
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y + 6);
      ctx.lineTo(x - 7, y + 6);
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** Dynamic input (DYN): the prompt and the live value next to the cursor. */
  private drawDyn(ctx: CanvasRenderingContext2D, p: Point): void {
    const engine = this.draft.engine;
    const frame = this.draft.frame();
    const u = frame.toUser(p);
    const base = engine.prompt?.base;
    const value = base
      ? `${fmt(Math.hypot(p.x - base.x, p.z - base.z))} m  <  ${fmt(DraftFrame.angle(base, p), 0)}°`
      : `${fmt(u.x)}, ${fmt(u.y)}`;
    const lines = engine.prompt ? [engine.prompt.text.replace(/:$/, ''), value] : [value];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
    const h = lines.length * 16 + 6;
    let x = this.sx(p.x) + 18;
    let y = this.sy(p.z) + 18;
    if (x + w > this.width) x -= w + 36;
    if (y + h > this.height) y -= h + 36;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = '#e2e8f0';
    lines.forEach((l, i) => ctx.fillText(l, x + 6, y + 4 + i * 16));
  }
}
