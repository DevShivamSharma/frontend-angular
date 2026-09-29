import {
  afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, viewChild
} from '@angular/core';

import { floorOutlines, planSize } from '../geometry/hall-plan';
import type { Footprint, Point, Rect } from '../geometry/placement-rules';
import { polygonBounds } from '../geometry/placement-rules';
import { stallPolygon } from '../geometry/polygon-geometry';
import type { Hall } from '../models/hall.model';
import type { GateSide, Stall } from '../models/stall.model';
import { PlannerStore } from '../planner-store.service';
import { boundsOfAll, cadAngle, dist } from './cad-geometry';
import { trim } from './cad-input';
import { DraftingEngine, Preview } from './drafting-engine.service';

/** CAD model space colours: dark in both themes, as AutoCAD's. */
const C = {
  bg: '#1c222a',
  gridMinor: 'rgba(135,149,166,0.10)',
  gridMajor: 'rgba(135,149,166,0.22)',
  floor: '#222a34',
  outline: '#8a9bb1',
  outside: '#161b21',
  wall: '#56606d',
  stall: '#dfe6ee',
  stallFill: 'rgba(223,230,238,0.05)',
  open: '#f0a35e',
  select: '#4ea1ff',
  hover: '#9cc9ff',
  bad: '#ff6b5e',
  ok: '#58c98f',
  ghost: '#7fdbff',
  cross: 'rgba(205,214,225,0.55)',
  snap: '#f2c94c',
  text: '#cdd6e1',
  dim: '#8795a6'
};

const ZONE_COLOURS: Record<string, string> = {
  PASSAGE: '#e0554a',
  NO_CONSTRUCTION: '#b0703c',
  EMERGENCY_EXIT_ACCESS: '#58c98f',
  ENTRY_EXIT_ACCESS: '#58c98f',
  FACILITY_ACCESS: '#d9b44a',
  FOYER: '#6c8ebf',
  PARTITION: '#a0a8b4',
  SMOKE_CURTAIN: '#c77dde'
};

const OPENING_COLOURS: Record<string, string> = { ENTRY: '#6cb4ff', EXIT: '#58c98f', EMERGENCY: '#58c98f', SERVICE: '#d9b44a' };

/** Polygon corner order is BACK, RIGHT, FRONT, LEFT edges (see stallPolygon). */
const EDGE_OF: Record<GateSide, number> = { BACK: 0, RIGHT: 1, FRONT: 2, LEFT: 3 };

const DRAG_THRESHOLD = 4;

/**
 * The drafting canvas: a 2D model space drawn with Canvas 2D so a hall of a thousand stalls stays
 * smooth. Pointer input is turned into world metres and handed to the `DraftingEngine`; the
 * canvas owns only the view (zoom and pan).
 *
 * Mouse, as in AutoCAD: wheel zooms at the cursor, middle drag pans, double middle click zooms to
 * extents, left drag left-to-right is a window, right-to-left a crossing, right click is Enter.
 */
@Component({
  selector: 'app-cad-canvas',
  template: `
    <canvas
      #canvas
      [class.is-pan]="engine.panMode() || panning()"
      (mousedown)="down($event)"
      (mousemove)="move($event)"
      (mouseup)="up($event)"
      (mouseleave)="leave()"
      (wheel)="wheel($event)"
      (contextmenu)="context($event)"
      (auxclick)="$event.preventDefault()"
      aria-label="Drawing canvas"
      role="img"
    ></canvas>
    @if (tooltip(); as t) {
      <div class="dyn" [style.left.px]="t.x" [style.top.px]="t.y">
        <span class="dyn-prompt">{{ t.prompt }}</span>
        <span class="dyn-value">{{ t.value }}</span>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: block; min-width: 0; min-height: 0; overflow: hidden; background: #1c222a; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: none; touch-action: none; }
    canvas.is-pan { cursor: grab; }
    .dyn {
      position: absolute; pointer-events: none; display: flex; gap: 8px; align-items: center;
      padding: 3px 8px; border-radius: 3px; background: rgba(38, 45, 55, 0.94); border: 1px solid #3a4452;
      font: 12px/1.4 var(--cad-mono, ui-monospace, Menlo, Consolas, monospace); color: #cdd6e1; white-space: nowrap;
      max-width: 60ch; overflow: hidden; text-overflow: ellipsis;
    }
    .dyn-value { color: #7fdbff; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CadCanvasComponent {
  readonly engine = inject(DraftingEngine);
  private readonly store = inject(PlannerStore);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  // View: screen = (world - origin) * scale.
  private scale = 4;
  private originX = 0;
  private originZ = 0;
  private width = 0;
  private height = 0;
  private fitted = false;

  private readonly pointer = signal<{ x: number; y: number } | null>(null);
  readonly panning = signal(false);
  private pan: { x: number; y: number } | null = null;
  private press: { x: number; y: number; shift: boolean } | null = null;
  private windowRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastMiddle = 0;
  private frame = 0;

  /** Redraw on any change to what is shown. */
  private readonly scene = computed(() => ({
    hall: this.store.currentHall(),
    stalls: this.engine.stalls(),
    selection: this.engine.selection(),
    hovered: this.engine.hovered(),
    preview: this.engine.preview(),
    cursor: this.engine.cursor(),
    snap: this.engine.snapMark(),
    layers: this.engine.layers(),
    toggles: this.engine.toggles(),
    issues: this.engine.issueStallIds(),
    proposals: this.store.proposals(),
    proposalIndex: this.engine.proposalIndex(),
    request: this.engine.request(),
    pointer: this.pointer()
  }));

  readonly tooltip = computed(() => {
    const p = this.pointer();
    const request = this.engine.request();
    if (!p || !this.engine.toggles().dyn || !request || this.panning()) return null;
    const cursor = this.engine.cursor();
    let value = '';
    if (cursor && request.kind === 'point') {
      const base = request.base;
      if (base) value = `${trim(dist(base, cursor))} m < ${trim(cadAngle(base, cursor), 1)}°`;
      else {
        const c = this.engine.frame().toCad(cursor);
        value = `${trim(c.x)}, ${trim(c.y)}`;
      }
    }
    const prompt = request.message.length > 48 ? request.message.slice(0, 46) + '…' : request.message;
    return { x: Math.min(p.x + 18, this.width - 260), y: p.y + 20, prompt, value };
  });

  constructor() {
    effect(() => {
      this.scene();
      untracked(() => this.schedule());
    });

    effect(() => {
      const v = this.engine.view();
      if (!v) return;
      untracked(() => {
        if (v.request.kind === 'extents') this.zoomExtents();
        else this.fit(v.request.rect);
      });
    });

    // Open on the whole plan once the hall is known.
    effect(() => {
      const hall = this.store.currentHall();
      if (!hall) return;
      untracked(() => {
        if (this.width) this.zoomExtents();
        else this.fitted = false;
      });
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.canvasRef().nativeElement;
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(el);
      this.resize();
      destroyRef.onDestroy(() => {
        observer.disconnect();
        cancelAnimationFrame(this.frame);
      });
    });
  }

  // --- view ------------------------------------------------------------------------------------------

  private resize(): void {
    const el = this.canvasRef().nativeElement;
    const rect = el.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.round(rect.width * dpr));
    el.height = Math.max(1, Math.round(rect.height * dpr));
    if (!this.fitted && this.store.currentHall()) this.zoomExtents();
    this.draw();
  }

  private extents(): Rect | null {
    const plan = this.engine.plan();
    const stalls = boundsOfAll(this.engine.stalls());
    if (!plan) return stalls;
    if (!stalls) return plan;
    return {
      minX: Math.min(plan.minX, stalls.minX), maxX: Math.max(plan.maxX, stalls.maxX),
      minZ: Math.min(plan.minZ, stalls.minZ), maxZ: Math.max(plan.maxZ, stalls.maxZ)
    };
  }

  zoomExtents(): void {
    const box = this.extents();
    if (box) this.fit(box);
  }

  private fit(box: Rect): void {
    if (!this.width || !this.height) return;
    const pad = 28;
    const w = Math.max(box.maxX - box.minX, 1), h = Math.max(box.maxZ - box.minZ, 1);
    this.scale = Math.min((this.width - pad * 2) / w, (this.height - pad * 2) / h);
    this.scale = Math.min(Math.max(this.scale, 0.2), 400);
    this.originX = (box.minX + box.maxX) / 2 - this.width / 2 / this.scale;
    this.originZ = (box.minZ + box.maxZ) / 2 - this.height / 2 / this.scale;
    this.fitted = true;
    this.schedule();
  }

  private toWorld(x: number, y: number): Point {
    return { x: this.originX + x / this.scale, z: this.originZ + y / this.scale };
  }

  private sx(x: number): number {
    return (x - this.originX) * this.scale;
  }

  private sy(z: number): number {
    return (z - this.originZ) * this.scale;
  }

  // --- pointer ---------------------------------------------------------------------------------------

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e: MouseEvent): void {
    const p = this.local(e);
    if (e.button === 1 || (e.button === 0 && this.engine.panMode())) {
      e.preventDefault();
      const now = performance.now();
      if (e.button === 1 && now - this.lastMiddle < 350) {
        this.zoomExtents();
        this.lastMiddle = 0;
        return;
      }
      if (e.button === 1) this.lastMiddle = now;
      this.pan = p;
      this.panning.set(true);
      return;
    }
    if (e.button !== 0) return;
    // Keyboard input keeps going to the command line.
    e.preventDefault();
    this.press = { ...p, shift: e.shiftKey };
  }

  move(e: MouseEvent): void {
    const p = this.local(e);
    this.pointer.set(p);
    if (this.pan) {
      this.originX -= (p.x - this.pan.x) / this.scale;
      this.originZ -= (p.y - this.pan.y) / this.scale;
      this.pan = p;
      this.schedule();
      return;
    }
    if (this.press && this.canWindow()) {
      if (Math.hypot(p.x - this.press.x, p.y - this.press.y) > DRAG_THRESHOLD || this.windowRect) {
        this.windowRect = { x0: this.press.x, y0: this.press.y, x1: p.x, y1: p.y };
      }
    }
    this.engine.pointerMove(this.toWorld(p.x, p.y), 1 / this.scale);
    this.schedule();
  }

  up(e: MouseEvent): void {
    if (this.pan) {
      this.pan = null;
      this.panning.set(false);
      return;
    }
    const press = this.press;
    this.press = null;
    if (!press || e.button !== 0) return;
    const p = this.local(e);
    const box = this.windowRect;
    this.windowRect = null;
    if (box) {
      const a = this.toWorld(box.x0, box.y0), b = this.toWorld(box.x1, box.y1);
      this.engine.windowSelect(
        { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) },
        box.x1 < box.x0,
        press.shift
      );
    } else {
      this.engine.click(this.toWorld(p.x, p.y), press.shift);
    }
    this.schedule();
  }

  leave(): void {
    this.pointer.set(null);
    this.pan = null;
    this.panning.set(false);
    this.press = null;
    this.windowRect = null;
    this.engine.pointerLeave();
  }

  wheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const before = this.toWorld(p.x, p.y);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.scale = Math.min(Math.max(this.scale * factor, 0.2), 400);
    this.originX = before.x - p.x / this.scale;
    this.originZ = before.z - p.y / this.scale;
    this.engine.pointerMove(this.toWorld(p.x, p.y), 1 / this.scale);
    this.schedule();
  }

  context(e: MouseEvent): void {
    e.preventDefault();
    this.engine.enter();
  }

  private canWindow(): boolean {
    const r = this.engine.request();
    return !r || r.kind === 'select';
  }

  // --- drawing ---------------------------------------------------------------------------------------

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const el = this.canvasRef().nativeElement;
    const ctx = el.getContext('2d');
    if (!ctx || !this.width) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const s = this.scene();
    const hall = s.hall;
    if (!hall) return;
    const view: Rect = { minX: this.originX, minZ: this.originZ, maxX: this.originX + this.width / this.scale, maxZ: this.originZ + this.height / this.scale };

    if (s.layers.base) this.drawBase(ctx, hall);
    if (s.toggles.grid) this.drawGrid(ctx, view);
    if (s.layers.base) this.drawOutline(ctx, hall);
    if (s.layers.zones) this.drawZones(ctx, hall);
    if (s.layers.services) this.drawServices(ctx, hall);
    if (s.layers.notes) this.drawNotes(ctx, hall);
    if (s.layers.stalls) this.drawStalls(ctx, s.stalls, view, s);
    if (s.proposals?.length) this.drawProposals(ctx, s.proposals, s.proposalIndex);
    if (s.preview) this.drawPreview(ctx, s.preview);
    const req = s.request;
    if (req?.kind === 'point' && req.base && s.cursor) {
      ctx.setLineDash([6, 4]);
      this.line(ctx, req.base, s.cursor, C.ghost, 1);
      ctx.setLineDash([]);
    }
    this.drawWindow(ctx);
    this.drawCursor(ctx, s);
  }

  private path(ctx: CanvasRenderingContext2D, poly: readonly Point[]): void {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(this.sx(p.x), this.sy(p.z)) : ctx.moveTo(this.sx(p.x), this.sy(p.z))));
    ctx.closePath();
  }

  private line(ctx: CanvasRenderingContext2D, a: Point, b: Point, colour: string, width: number): void {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(this.sx(a.x), this.sy(a.z));
    ctx.lineTo(this.sx(b.x), this.sy(b.z));
    ctx.stroke();
  }

  private hallShapes(hall: Hall): Point[][] {
    const outlines = floorOutlines(hall);
    if (outlines.length) return outlines;
    const { width, length } = planSize(hall);
    if (hall.shape === 'CIRCLE') {
      const r = hall.radius || width / 2;
      return [Array.from({ length: 72 }, (_, i) => ({ x: r * Math.cos((i / 72) * Math.PI * 2), z: r * Math.sin((i / 72) * Math.PI * 2) }))];
    }
    return [[{ x: -width / 2, z: -length / 2 }, { x: width / 2, z: -length / 2 }, { x: width / 2, z: length / 2 }, { x: -width / 2, z: length / 2 }]];
  }

  private drawBase(ctx: CanvasRenderingContext2D, hall: Hall): void {
    ctx.fillStyle = C.floor;
    for (const poly of this.hallShapes(hall)) {
      this.path(ctx, poly);
      ctx.fill();
    }
    for (const a of hall.blockedAreas ?? []) {
      if (a.hidden || a.kind === 'zone') continue;
      ctx.fillStyle = a.kind === 'wall' ? C.wall : C.outside;
      ctx.fillRect(this.sx(a.posX - a.width / 2), this.sy(a.posZ - a.length / 2), a.width * this.scale, a.length * this.scale);
    }
  }

  private drawOutline(ctx: CanvasRenderingContext2D, hall: Hall): void {
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 1.5;
    for (const poly of this.hallShapes(hall)) {
      this.path(ctx, poly);
      ctx.stroke();
    }
    // Pillars and other plan rectangles: reference only.
    ctx.lineWidth = 1;
    for (const a of hall.blockedAreas ?? []) {
      if (a.hidden || a.kind !== 'zone') continue;
      ctx.strokeStyle = a.strokeColor || a.color || C.dim;
      ctx.strokeRect(this.sx(a.posX - a.width / 2), this.sy(a.posZ - a.length / 2), a.width * this.scale, a.length * this.scale);
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, view: Rect): void {
    const g = this.store.grid();
    if (!g) return;
    const plan = g.bounds;
    const step = g.cellSize || 1;
    const x0 = Math.max(plan.minX, view.minX), x1 = Math.min(plan.maxX, view.maxX);
    const z0 = Math.max(plan.minZ, view.minZ), z1 = Math.min(plan.maxZ, view.maxZ);
    if (x1 <= x0 || z1 <= z0) return;
    const drawLines = (every: number, colour: string) => {
      if (every * this.scale < 6) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const first = (v: number, o: number) => o + Math.ceil((v - o) / every - 1e-9) * every;
      for (let x = first(x0, plan.minX); x <= x1 + 1e-9; x += every) {
        const X = Math.round(this.sx(x)) + 0.5;
        ctx.moveTo(X, this.sy(z0));
        ctx.lineTo(X, this.sy(z1));
      }
      for (let z = first(z0, plan.minZ); z <= z1 + 1e-9; z += every) {
        const Y = Math.round(this.sy(z)) + 0.5;
        ctx.moveTo(this.sx(x0), Y);
        ctx.lineTo(this.sx(x1), Y);
      }
      ctx.stroke();
    };
    drawLines(step, C.gridMinor);
    drawLines(step * 10, C.gridMajor);
    if (step * this.scale < 6) drawLines(step * 5, C.gridMinor);
  }

  private drawZones(ctx: CanvasRenderingContext2D, hall: Hall): void {
    for (const z of hall.zones ?? []) {
      if (z.hidden || z.polygon.length < 3) continue;
      const colour = z.color || ZONE_COLOURS[z.kind] || C.dim;
      this.path(ctx, z.polygon);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (this.scale > 6 && z.label) {
        const b = polygonBounds(z.polygon);
        if ((b.maxX - b.minX) * this.scale > 60) this.text(ctx, z.label, { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }, colour, 11);
      }
    }
  }

  private drawServices(ctx: CanvasRenderingContext2D, hall: Hall): void {
    for (const o of hall.openings ?? []) {
      const colour = OPENING_COLOURS[o.kind] ?? C.ok;
      const across = o.facing === 'NORTH' || o.facing === 'SOUTH';
      const half = o.width / 2;
      const a = across ? { x: o.position.x - half, z: o.position.z } : { x: o.position.x, z: o.position.z - half };
      const b = across ? { x: o.position.x + half, z: o.position.z } : { x: o.position.x, z: o.position.z + half };
      this.line(ctx, a, b, colour, Math.max(3, 0.4 * this.scale));
      if (this.scale > 3 && o.label) this.text(ctx, o.label, o.position, colour, 11, -12);
    }
    for (const a of hall.amenities ?? []) {
      const r = Math.max(4, 0.6 * this.scale);
      ctx.fillStyle = '#2f3743';
      ctx.strokeStyle = '#6cb4ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.sx(a.position.x), this.sy(a.position.z), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (this.scale > 5) this.text(ctx, a.label, a.position, C.dim, 10, r + 8);
    }
  }

  private drawNotes(ctx: CanvasRenderingContext2D, hall: Hall): void {
    if (this.scale < 2) return;
    for (const m of hall.markers ?? []) this.text(ctx, m.text, m.position, C.dim, 11);
  }

  private drawStalls(
    ctx: CanvasRenderingContext2D,
    stalls: readonly Stall[],
    view: Rect,
    s: { selection: ReadonlySet<string>; hovered: string | null; issues: ReadonlySet<string>; layers: { labels: boolean; issues: boolean } }
  ): void {
    const px = this.scale;
    const grips: Point[] = [];
    for (const stall of stalls) {
      const r = Math.max(stall.width, stall.length);
      if (stall.posX + r < view.minX || stall.posX - r > view.maxX || stall.posZ + r < view.minZ || stall.posZ - r > view.maxZ) continue;
      const id = String(stall.id);
      const poly = stallPolygon(stall);
      const selected = s.selection.has(id);
      const bad = s.layers.issues && s.issues.has(id);

      this.path(ctx, poly);
      ctx.fillStyle = selected ? 'rgba(78,161,255,0.18)' : bad ? 'rgba(255,107,94,0.14)' : C.stallFill;
      ctx.fill();
      ctx.strokeStyle = selected ? C.select : s.hovered === id ? C.hover : bad ? C.bad : C.stall;
      ctx.lineWidth = selected || s.hovered === id ? 2 : 1;
      ctx.stroke();
      this.drawOpenSides(ctx, stall, poly);
      if (selected) grips.push({ x: stall.posX, z: stall.posZ });

      if (s.layers.labels && px >= 9) {
        const label = stall.stallNumber ?? stall.name;
        const size = Math.min(12, Math.max(9, px * 0.9));
        if (ctx.measureText(label).width < Math.min(stall.width, stall.length) * px * 1.6 || px > 18) {
          this.text(ctx, label, { x: stall.posX, z: stall.posZ }, bad ? C.bad : C.text, size, px >= 20 ? -6 : 0);
          if (px >= 20) this.text(ctx, `${trim(stall.width)}×${trim(stall.length)}`, { x: stall.posX, z: stall.posZ }, C.dim, size - 1, 8);
        }
      }
    }
    if (grips.length <= 300) {
      ctx.fillStyle = C.select;
      for (const g of grips) ctx.fillRect(this.sx(g.x) - 3.5, this.sy(g.z) - 3.5, 7, 7);
    }
  }

  private drawOpenSides(ctx: CanvasRenderingContext2D, f: Footprint & Partial<Pick<Stall, 'openEdges'>>, poly: Point[]): void {
    const edges = f.footprint && f.footprint.length >= 3
      ? (f.openEdges ?? [])
      : (f.openSides ?? []).map(side => EDGE_OF[side]);
    if (!edges.length) return;
    ctx.setLineDash([5, 3]);
    for (const i of edges) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (a && b) this.line(ctx, a, b, C.open, 2);
    }
    ctx.setLineDash([]);
  }

  private drawProposals(ctx: CanvasRenderingContext2D, proposals: ReadonlyArray<{ footprint: Footprint; valid: boolean }>, current: number): void {
    ctx.setLineDash([6, 4]);
    proposals.forEach((p, i) => {
      this.path(ctx, stallPolygon(p.footprint));
      ctx.strokeStyle = p.valid ? C.ok : C.bad;
      ctx.lineWidth = i === current ? 3 : 1.5;
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  private drawPreview(ctx: CanvasRenderingContext2D, preview: Preview): void {
    ctx.setLineDash([6, 4]);
    for (const f of preview.stalls ?? []) {
      const poly = stallPolygon(f);
      this.path(ctx, poly);
      ctx.fillStyle = 'rgba(127,219,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = C.ghost;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawOpenSides(ctx, f, poly);
      ctx.setLineDash([6, 4]);
    }
    for (const [a, b] of preview.lines ?? []) this.line(ctx, a, b, C.ghost, 1);
    if (preview.rect) {
      const r = preview.rect;
      ctx.strokeStyle = C.ghost;
      ctx.strokeRect(this.sx(r.minX), this.sy(r.minZ), (r.maxX - r.minX) * this.scale, (r.maxZ - r.minZ) * this.scale);
    }
    if (preview.polygon && preview.polygon.length >= 2) {
      this.path(ctx, preview.polygon);
      ctx.fillStyle = 'rgba(127,219,255,0.12)';
      ctx.fill();
      ctx.strokeStyle = C.ghost;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const [a, b] of preview.edges ?? []) this.line(ctx, a, b, C.snap, 4);
    if (preview.stalls?.length && this.scale > 4) {
      const box = boundsOfAll(preview.stalls)!;
      this.text(ctx, `${preview.stalls.length} ${preview.stalls.length === 1 ? 'stall' : 'stalls'}`, { x: box.maxX, z: box.minZ }, C.ghost, 11, -8, 'left');
    }
  }

  private drawWindow(ctx: CanvasRenderingContext2D): void {
    const w = this.windowRect;
    if (!w) return;
    const crossing = w.x1 < w.x0;
    const x = Math.min(w.x0, w.x1), y = Math.min(w.y0, w.y1);
    ctx.fillStyle = crossing ? 'rgba(88,201,143,0.12)' : 'rgba(78,161,255,0.12)';
    ctx.fillRect(x, y, Math.abs(w.x1 - w.x0), Math.abs(w.y1 - w.y0));
    ctx.strokeStyle = crossing ? C.ok : C.select;
    ctx.lineWidth = 1;
    ctx.setLineDash(crossing ? [5, 3] : []);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(w.x1 - w.x0), Math.abs(w.y1 - w.y0));
    ctx.setLineDash([]);
  }

  private drawCursor(ctx: CanvasRenderingContext2D, s: ReturnType<typeof this.scene>): void {
    const p = s.pointer;
    if (!p || this.panning() || this.engine.panMode()) return;
    const wantsPoint = s.request?.kind === 'point';
    // Crosshair on the snapped point while a point is wanted, on the mouse otherwise.
    const at = wantsPoint && s.cursor ? { x: this.sx(s.cursor.x), y: this.sy(s.cursor.z) } : p;
    ctx.strokeStyle = C.cross;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(at.y) + 0.5);
    ctx.lineTo(this.width, Math.round(at.y) + 0.5);
    ctx.moveTo(Math.round(at.x) + 0.5, 0);
    ctx.lineTo(Math.round(at.x) + 0.5, this.height);
    ctx.stroke();
    if (!wantsPoint) {
      ctx.strokeStyle = C.text;
      ctx.strokeRect(Math.round(at.x) - 4.5, Math.round(at.y) - 4.5, 9, 9);
    }
    const mark = s.snap;
    if (mark?.kind && wantsPoint) {
      const x = this.sx(mark.point.x), y = this.sy(mark.point.z);
      ctx.strokeStyle = C.snap;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (mark.kind === 'endpoint') ctx.rect(x - 6, y - 6, 12, 12);
      else {
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 7, y + 5);
        ctx.lineTo(x - 7, y + 5);
        ctx.closePath();
      }
      ctx.stroke();
    }
  }

  private text(ctx: CanvasRenderingContext2D, text: string, at: Point, colour: string, size: number, dy = 0, align: CanvasTextAlign = 'center'): void {
    ctx.font = `${size}px ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.sx(at.x), this.sy(at.z) + dy);
  }
}
