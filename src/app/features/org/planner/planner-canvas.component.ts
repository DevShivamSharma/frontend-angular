import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as T from 'three';

import type { FloorAreaKind as AreaKind, HallFloor } from '../../../core/api/api.models';
import { PlanContent, PlanStall, stallLabel, StallSide } from '../../../core/plans/plans.models';
import type { MultiPolygon, Point } from '../../../core/venues/floor-plan.models';
import { pointInRing, polygonArea, Rect, ringBox, snap, stallRect } from './planner-geometry';
import type { Selection, SelectionKind } from './planner.store';

export type PlannerTool = 'select' | 'pan' | 'zone-rect' | 'zone-poly' | 'booth';

export interface PickEvent {
  kind: SelectionKind;
  ids: string[];
  /** Shift or Ctrl held: add to the selection. */
  additive: boolean;
}

export interface MoveEvent {
  kind: SelectionKind;
  ids: string[];
  dx: number;
  dy: number;
}

interface Chip {
  x: number;
  y: number;
  text: string;
  kind: 'length' | 'area' | 'zone';
}

/** Colours of floor areas, as the hall pages draw them (ITPO's palette). */
const AREA_COLORS: Record<AreaKind, string> = {
  outside: '#d9dee5',
  wall: '#742371',
  column: '#808080',
  passage: '#e53935',
  fire_curtain: '#8a2be2',
  no_build: '#8b4513',
  utility: '#1e88e5',
  entry: '#2e8b57',
  unavailable: '#f2c200',
  marking: '#9e9e9e',
  void: '#151e29',
  facility: '#5681ad',
};

const STALL_FILL = '#86efac';
const STALL_BLOCKED = '#cbd5e1';
const STALL_EDGE = '#15803d';
const SEAT_FILL = '#a855f7';
const SELECTED = '#1d4ed8';
const DRAFT = '#ea580c';
/** Pixels: a click that moved less than this is a click, not a drag. */
const CLICK_PX = 5;
/** Booths at most this many get their number drawn. */
const LABELLED = 1500;

/**
 * The plan to scale, top view, in Three.js: the hall's floor with a 1 m grid, and the zones,
 * stalls and seats on it. Drawing tools report shapes; nothing here changes the plan, the page
 * decides (and the server checks) what is made of them.
 */
@Component({
  selector: 'app-planner-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host" [class]="'tool-' + tool()" tabindex="-1"></div>
    <div class="overlay" aria-hidden="true">
      @for (c of chips(); track $index) {
        <span class="chip" [class]="c.kind" [style.left.px]="c.x" [style.top.px]="c.y">{{
          c.text
        }}</span>
      }
    </div>
    @if (hint()) {
      <p class="hint">{{ hint() }}</p>
    }
    <div class="compass" [style.transform]="'rotate(' + north() + 'deg)'" aria-label="North">
      <span>N</span>
    </div>
    <div class="zoom">
      <button type="button" (click)="zoomBy(1.25)" aria-label="Zoom in" title="Zoom in">
        <i class="pi pi-search-plus"></i>
      </button>
      <button type="button" (click)="zoomBy(0.8)" aria-label="Zoom out" title="Zoom out">
        <i class="pi pi-search-minus"></i>
      </button>
      <button type="button" (click)="fit()" aria-label="Fit the hall" title="Fit the hall">
        <i class="pi pi-expand"></i>
      </button>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: #eef2f6;
    }
    .host {
      position: absolute;
      inset: 0;
      touch-action: none;
      outline: none;
    }
    .tool-pan {
      cursor: grab;
    }
    .tool-zone-rect,
    .tool-zone-poly,
    .tool-booth {
      cursor: crosshair;
    }
    .overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .chip {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 2px 7px;
      border-radius: 6px;
      font: 600 12px/1.4 var(--app-font-family, sans-serif);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: #fff;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    }
    .chip.length {
      background: #ea580c;
    }
    .chip.area {
      background: #6d28d9;
    }
    .chip.zone {
      background: rgb(255 255 255 / 0.9);
      color: #1e293b;
      font-weight: 600;
    }
    .hint {
      position: absolute;
      top: 10px;
      left: 10px;
      margin: 0;
      padding: 4px 10px;
      border-radius: 6px;
      background: rgb(255 255 255 / 0.92);
      color: #334155;
      font-size: 12px;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
      pointer-events: none;
    }
    .compass {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #fff;
      border: 1px solid #cbd5e1;
      display: grid;
      place-items: start center;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
      pointer-events: none;
    }
    .compass span {
      margin-top: 3px;
      font: 700 12px/1 sans-serif;
      color: #dc2626;
    }
    .compass::after {
      content: '';
      position: absolute;
      top: 17px;
      left: 50%;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 14px solid #dc2626;
      transform: translateX(-50%);
    }
    .zoom {
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      gap: 2px;
      padding: 3px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
    }
    .zoom button {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: #334155;
      cursor: pointer;
    }
    .zoom button:hover,
    .zoom button:focus-visible {
      background: #e2e8f0;
    }
    .error {
      position: absolute;
      inset: auto 16px 16px 16px;
      padding: 12px;
      background: #fff;
      border-radius: 8px;
    }
  `,
})
export class PlannerCanvasComponent {
  readonly floor = input.required<HallFloor>();
  readonly plan = input.required<PlanContent>();
  readonly selection = input<Selection | null>(null);
  readonly tool = input<PlannerTool>('select');
  /** Metres positions and sizes snap to. */
  readonly snapStep = input(0.5);
  readonly categoryColors = input<ReadonlyMap<string, string>>(new Map());
  readonly readonly = input(false);

  readonly drawRect = output<Rect>();
  readonly drawPolygon = output<Point[]>();
  /** A booth placed by a click: its centre. */
  readonly placeAt = output<Point>();
  readonly pick = output<PickEvent | null>();
  readonly move = output<MoveEvent>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  protected readonly chips = signal<Chip[]>([]);
  protected readonly error = signal('');
  protected readonly hint = signal('');
  protected readonly north = signal(0);

  private renderer?: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.OrthographicCamera();
  private readonly floorGroup = new T.Group();
  private readonly planGroup = new T.Group();
  private readonly draftGroup = new T.Group();
  private observer?: ResizeObserver;
  private extent: Rect = { x: 0, y: 0, width: 100, height: 100 };

  private down: {
    px: number;
    py: number;
    world: Point;
    cam: [number, number];
    mode: 'pan' | 'draw' | 'move' | 'marquee' | 'none';
    move?: { kind: SelectionKind; ids: string[] };
  } | null = null;
  private pointer: Point | null = null;
  private polygon: Point[] = [];
  private draftRect: Rect | null = null;
  private moveOffset: Point = [0, 0];
  private spaceHeld = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const host = this.host().nativeElement;
      untracked(() => this.start(host));
    });
    effect(() => {
      const floor = this.floor();
      untracked(() => {
        this.buildFloor(floor);
        this.fit();
      });
    });
    effect(() => {
      this.plan();
      this.selection();
      this.categoryColors();
      untracked(() => this.buildPlan());
    });
    effect(() => {
      const tool = this.tool();
      untracked(() => {
        this.cancel();
        this.hint.set(HINTS[tool]);
      });
    });
    destroyRef.onDestroy(() => this.stop());
  }

  // ---- public controls ----------------------------------------------------------------------

  /** Drops a shape being drawn. */
  cancel(): void {
    this.polygon = [];
    this.draftRect = null;
    this.down = null;
    this.buildDraft();
  }

  /** Closes the polygon being drawn, when it has three corners. */
  finishPolygon(): void {
    if (this.tool() !== 'zone-poly' || this.polygon.length < 3) return;
    const points = this.polygon;
    this.cancel();
    this.drawPolygon.emit(points);
  }

  /** Takes back the last corner of the polygon being drawn. */
  undoCorner(): boolean {
    if (!this.polygon.length) return false;
    this.polygon = this.polygon.slice(0, -1);
    this.buildDraft();
    return true;
  }

  get drawing(): boolean {
    return this.polygon.length > 0 || this.draftRect !== null;
  }

  zoomBy(factor: number): void {
    this.camera.zoom = Math.max(0.05, Math.min(400, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
    this.render();
  }

  fit(): void {
    const e = this.extent;
    this.camera.position.set(e.x + e.width / 2, -(e.y + e.height / 2), 100);
    this.camera.zoom = 1;
    this.resize();
  }

  /** The middle of what is in view, floor metres. */
  viewCentre(): Point {
    return [this.camera.position.x, -this.camera.position.y];
  }

  // ---- setup --------------------------------------------------------------------------------

  private start(host: HTMLDivElement): void {
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true });
    } catch {
      this.error.set('WebGL could not start. Turn on hardware acceleration to plan stalls.');
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#eef2f6');
    host.appendChild(this.renderer.domElement);
    this.camera.near = 0.1;
    this.camera.far = 1000;
    this.scene.add(this.floorGroup, this.planGroup, this.draftGroup);
    const el = this.renderer.domElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('dblclick', this.onDoubleClick);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.buildFloor(this.floor());
    this.buildPlan();
    this.fit();
  }

  private stop(): void {
    this.observer?.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    for (const g of [this.floorGroup, this.planGroup, this.draftGroup]) dispose(g);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  private resize(): void {
    if (!this.renderer) return;
    const host = this.host().nativeElement;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const e = this.extent;
    const half = Math.max(e.height, e.width / aspect) * 0.55;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (!this.renderer) return;
    this.renderer.render(this.scene, this.camera);
    this.updateChips();
  }

  // ---- scene --------------------------------------------------------------------------------

  private buildFloor(f: HallFloor): void {
    dispose(this.floorGroup);
    const g = this.floorGroup;
    if (f.geometry) {
      const geo = f.geometry;
      addPolygons(g, geo.boundary, '#ffffff', 1, 0);
      for (const o of geo.objects) {
        const kind = o.kind as AreaKind;
        const solid = kind === 'outside' || kind === 'wall' || kind === 'void';
        addPolygons(g, o.geometry, AREA_COLORS[kind] ?? o.color, solid ? 1 : 0.45, 2);
      }
      for (const poly of geo.boundary)
        for (const ring of poly) addLine(g, ring, '#64748b', 4, true);
      const box = ringBox(geo.boundary.flatMap((p) => p[0]));
      this.extent = box;
    } else {
      addPolygons(
        g,
        [[rectPoints({ x: 0, y: 0, width: f.width, height: f.depth })]],
        '#ffffff',
        1,
        0,
      );
      for (const a of [...f.areas].sort((a, b) =>
        a.kind === 'outside' ? -1 : b.kind === 'outside' ? 1 : 0,
      )) {
        const solid = a.kind === 'outside' || a.kind === 'wall' || a.kind === 'void';
        addPolygons(g, [[rectPoints(a)]], a.color ?? AREA_COLORS[a.kind], solid ? 1 : 0.45, 2);
      }
      addLine(g, rectPoints({ x: 0, y: 0, width: f.width, height: f.depth }), '#64748b', 4, true);
      this.extent = { x: 0, y: 0, width: f.width, height: f.depth };
    }
    this.north.set(f.north?.rotation ?? 0);
    addGrid(g, this.extent);
    this.render();
  }

  private buildPlan(): void {
    dispose(this.planGroup);
    const plan = this.plan();
    const sel = this.selection();
    const selected = new Set(sel?.ids ?? []);
    const g = this.planGroup;
    const colors = this.categoryColors();

    for (const z of plan.zones) {
      const on = sel?.kind === 'zone' && selected.has(z.id);
      addPolygons(g, [[z.polygon]], z.color, on ? 0.22 : 0.12, 10);
      addLine(g, z.polygon, on ? SELECTED : z.color, 11, true);
    }

    // Stalls: one mesh for all fills, lines for closed and open sides.
    const fills: number[] = [];
    const fillColors: number[] = [];
    const closed: number[] = [];
    const open: number[] = [];
    const picked: number[] = [];
    const color = new T.Color();
    for (const s of plan.stalls) {
      const r = stallRect(s);
      color.set(s.isBlocked ? STALL_BLOCKED : (colors.get(s.categoryIds[0] ?? '') ?? STALL_FILL));
      pushRect(fills, r, 20);
      for (let i = 0; i < 6; i++) fillColors.push(color.r, color.g, color.b);
      for (const [side, a, b] of sides(r))
        (s.openSides.includes(side) ? open : closed).push(a[0], -a[1], 21, b[0], -b[1], 21);
      if (sel?.kind === 'stall' && selected.has(s.id)) {
        for (const [, a, b] of sides(grow(r, 0.08))) picked.push(a[0], -a[1], 22, b[0], -b[1], 22);
      }
    }
    if (fills.length) {
      const geom = new T.BufferGeometry();
      geom.setAttribute('position', new T.Float32BufferAttribute(fills, 3));
      geom.setAttribute('color', new T.Float32BufferAttribute(fillColors, 3));
      const mesh = new T.Mesh(
        geom,
        new T.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.85,
          side: T.DoubleSide,
          depthTest: false,
        }),
      );
      mesh.renderOrder = 20;
      g.add(mesh);
      addSegments(g, closed, STALL_EDGE, 21, false);
      addSegments(g, open, STALL_EDGE, 21, true);
      addSegments(g, picked, SELECTED, 22, false);
    }
    if (plan.stalls.length <= LABELLED) {
      for (const s of plan.stalls) addLabel(g, stallLabel(s), stallRect(s));
    }

    if (plan.seats.length) {
      const mesh = new T.InstancedMesh(
        new T.PlaneGeometry(1, 1),
        new T.MeshBasicMaterial({ depthTest: false }),
        plan.seats.length,
      );
      const m = new T.Matrix4();
      plan.seats.forEach((s, i) => {
        m.makeScale(s.width, s.depth, 1);
        m.setPosition(s.x + s.width / 2, -(s.y + s.depth / 2), 25);
        mesh.setMatrixAt(i, m);
        const on = sel?.kind === 'seat' && selected.has(s.id);
        mesh.setColorAt(
          i,
          color.set(on ? SELECTED : (colors.get(s.categoryId ?? '') ?? SEAT_FILL)),
        );
      });
      mesh.renderOrder = 25;
      g.add(mesh);
    }
    this.render();
  }

  /** What is being drawn or moved, over the plan. */
  private buildDraft(): void {
    dispose(this.draftGroup);
    const g = this.draftGroup;
    if (this.draftRect) {
      const r = this.draftRect;
      const color = this.down?.mode === 'marquee' ? SELECTED : DRAFT;
      addPolygons(g, [[rectPoints(r)]], color, 0.15, 40);
      addLine(g, rectPoints(r), color, 41, true);
    }
    if (this.polygon.length) {
      const ring = this.pointer ? [...this.polygon, this.pointer] : this.polygon;
      addLine(g, ring, DRAFT, 41, false);
      const dots: number[] = this.polygon.flatMap((p) => [p[0], -p[1], 42]);
      const geom = new T.BufferGeometry();
      geom.setAttribute('position', new T.Float32BufferAttribute(dots, 3));
      const points = new T.Points(
        geom,
        new T.PointsMaterial({ color: DRAFT, size: 7, sizeAttenuation: false, depthTest: false }),
      );
      points.renderOrder = 42;
      g.add(points);
    }
    if (this.down?.mode === 'move' && this.down.move) {
      const [dx, dy] = this.moveOffset;
      for (const r of this.boxesOf(this.down.move)) {
        addLine(g, rectPoints({ ...r, x: r.x + dx, y: r.y + dy }), DRAFT, 41, true);
      }
      for (const z of this.zonesOf(this.down.move)) {
        addLine(
          g,
          z.map(([x, y]) => [x + dx, y + dy] as Point),
          DRAFT,
          41,
          true,
        );
      }
    }
    this.render();
  }

  // ---- chips --------------------------------------------------------------------------------

  /** Lengths and areas of what is drawn, moved or selected; zone names. */
  private updateChips(): void {
    const chips: Chip[] = [];
    const plan = this.plan();
    for (const z of plan.zones) {
      const c = centroid(z.polygon);
      chips.push({ ...this.screen(c), text: z.name, kind: 'zone' });
    }
    if (this.draftRect && this.down?.mode === 'draw') chips.push(...this.rectChips(this.draftRect));
    if (this.polygon.length) {
      const ring = this.pointer ? [...this.polygon, this.pointer] : this.polygon;
      for (let i = 1; i < ring.length; i++) chips.push(this.lengthChip(ring[i - 1], ring[i]));
      if (ring.length >= 3) {
        chips.push({
          ...this.screen(centroid(ring)),
          text: `${fmt(polygonArea(ring))} m²`,
          kind: 'area',
        });
      }
    }
    if (!this.drawing && this.down?.mode !== 'move') {
      const sel = this.selection();
      if (sel?.kind === 'stall' && sel.ids.length === 1) {
        const s = plan.stalls.find((x) => x.id === sel.ids[0]);
        if (s) chips.push(...this.rectChips(stallRect(s)));
      }
      if (sel?.kind === 'zone' && sel.ids.length === 1) {
        const z = plan.zones.find((x) => x.id === sel.ids[0]);
        if (z) {
          const ring = [...z.polygon, z.polygon[0]];
          for (let i = 1; i < ring.length; i++) chips.push(this.lengthChip(ring[i - 1], ring[i]));
        }
      }
    }
    this.chips.set(chips);
  }

  private rectChips(r: Rect): Chip[] {
    return [
      { ...this.screen([r.x + r.width / 2, r.y]), text: `${fmt(r.width)} m`, kind: 'length' },
      {
        ...this.screen([r.x + r.width, r.y + r.height / 2]),
        text: `${fmt(r.height)} m`,
        kind: 'length',
      },
      {
        ...this.screen([r.x + r.width / 2, r.y + r.height / 2]),
        text: `${fmt(r.width)} × ${fmt(r.height)} = ${fmt(r.width * r.height)} m²`,
        kind: 'area',
      },
    ];
  }

  private lengthChip(a: Point, b: Point): Chip {
    return {
      ...this.screen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
      text: `${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]))} m`,
      kind: 'length',
    };
  }

  private screen(p: Point): { x: number; y: number } {
    const host = this.host().nativeElement;
    const v = new T.Vector3(p[0], -p[1], 0).project(this.camera);
    return { x: ((v.x + 1) / 2) * host.clientWidth, y: ((1 - v.y) / 2) * host.clientHeight };
  }

  // ---- pointer ------------------------------------------------------------------------------

  private world(e: { clientX: number; clientY: number }): Point {
    const r = this.renderer!.domElement.getBoundingClientRect();
    const v = new T.Vector3(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
      0,
    ).unproject(this.camera);
    return [v.x, -v.y];
  }

  private snapped(p: Point): Point {
    const s = this.snapStep();
    return [snap(p[0], s), snap(p[1], s)];
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const before = this.world(e);
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    const after = this.world(e);
    this.camera.position.x += before[0] - after[0];
    this.camera.position.y -= before[1] - after[1];
    this.render();
  };

  private readonly onDown = (e: PointerEvent) => {
    this.host().nativeElement.focus({ preventScroll: true });
    const world = this.world(e);
    const base = {
      px: e.clientX,
      py: e.clientY,
      world,
      cam: [this.camera.position.x, this.camera.position.y] as [number, number],
    };
    this.renderer!.domElement.setPointerCapture(e.pointerId);
    const tool = this.tool();
    if (e.button === 1 || e.button === 2 || tool === 'pan' || this.spaceHeld) {
      this.down = { ...base, mode: 'pan' };
      return;
    }
    if (e.button !== 0) return;
    if (this.readonly()) {
      this.down = { ...base, mode: 'pan' };
      return;
    }
    if (tool === 'zone-rect' || tool === 'booth') {
      this.down = { ...base, world: this.snapped(world), mode: 'draw' };
      return;
    }
    if (tool === 'zone-poly') {
      this.down = { ...base, mode: 'none' };
      return;
    }
    // Select: on something, it moves (selected first); on nothing, a box selects.
    const hit = this.hit(world);
    if (hit) {
      const sel = this.selection();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const inSelection = sel?.kind === hit.kind && sel.ids.includes(hit.id);
      if (!inSelection || additive) {
        this.pick.emit({ kind: hit.kind, ids: [hit.id], additive });
      }
      const ids = inSelection && !additive ? sel!.ids : [hit.id];
      this.down = { ...base, mode: 'move', move: { kind: hit.kind, ids } };
      this.moveOffset = [0, 0];
    } else {
      this.down = { ...base, mode: 'marquee' };
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    const world = this.world(e);
    if (this.tool() === 'zone-poly' && this.polygon.length) {
      this.pointer = this.snapped(world);
      this.buildDraft();
    }
    const d = this.down;
    if (!d) return;
    const far = Math.hypot(e.clientX - d.px, e.clientY - d.py) >= CLICK_PX;
    if (d.mode === 'pan') {
      this.camera.position.x = d.cam[0];
      this.camera.position.y = d.cam[1];
      const now = this.world(e);
      this.camera.position.x = d.cam[0] + d.world[0] - now[0];
      this.camera.position.y = d.cam[1] - (d.world[1] - now[1]);
      this.render();
    } else if (d.mode === 'draw' && far) {
      this.draftRect = rectBetween(d.world, this.snapped(world));
      this.buildDraft();
    } else if (d.mode === 'marquee' && far) {
      this.draftRect = rectBetween(d.world, world);
      this.buildDraft();
    } else if (d.mode === 'move' && far) {
      const s = this.snapStep();
      this.moveOffset = [snap(world[0] - d.world[0], s), snap(world[1] - d.world[1], s)];
      this.buildDraft();
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    if (!d) return;
    const click = Math.hypot(e.clientX - d.px, e.clientY - d.py) < CLICK_PX;
    const world = this.world(e);
    const tool = this.tool();
    if (d.mode === 'draw') {
      const r = this.draftRect;
      if (r && r.width > 0 && r.height > 0) this.drawRect.emit(r);
      else if (click && tool === 'booth') this.placeAt.emit(this.snapped(world));
    } else if (d.mode === 'none' && tool === 'zone-poly' && click) {
      this.addCorner(this.snapped(world));
    } else if (d.mode === 'marquee') {
      if (click) this.pick.emit(null);
      else if (this.draftRect) this.pick.emit(this.inBox(this.draftRect, e.shiftKey));
    } else if (d.mode === 'move' && d.move && !click) {
      const [dx, dy] = this.moveOffset;
      if (dx || dy) this.move.emit({ ...d.move, dx, dy });
    }
    this.down = null;
    this.draftRect = null;
    this.moveOffset = [0, 0];
    this.buildDraft();
  };

  private readonly onCancel = () => {
    this.down = null;
    this.draftRect = null;
    this.buildDraft();
  };

  private readonly onLeave = () => {
    if (this.polygon.length) {
      this.pointer = null;
      this.buildDraft();
    }
  };

  private readonly onDoubleClick = () => this.finishPolygon();

  private readonly onKey = (e: KeyboardEvent) => {
    if (
      e.code === 'Space' &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      this.spaceHeld = e.type === 'keydown';
    }
  };

  private addCorner(p: Point): void {
    const first = this.polygon[0];
    const s = this.snapStep();
    // Clicking the first corner again closes the outline.
    if (first && this.polygon.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < s) {
      this.finishPolygon();
      return;
    }
    const last = this.polygon[this.polygon.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    this.polygon = [...this.polygon, p];
    this.buildDraft();
  }

  /** What is under a point: a seat, then a stall, then a zone. */
  private hit(p: Point): { kind: SelectionKind; id: string } | null {
    const plan = this.plan();
    const at = (r: Rect) =>
      p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height;
    for (let i = plan.seats.length - 1; i >= 0; i--) {
      if (at(stallRect(plan.seats[i]))) return { kind: 'seat', id: plan.seats[i].id };
    }
    for (let i = plan.stalls.length - 1; i >= 0; i--) {
      if (at(stallRect(plan.stalls[i]))) return { kind: 'stall', id: plan.stalls[i].id };
    }
    for (let i = plan.zones.length - 1; i >= 0; i--) {
      if (pointInRing(p, plan.zones[i].polygon)) return { kind: 'zone', id: plan.zones[i].id };
    }
    return null;
  }

  /** Stalls in a box, else seats in it. */
  private inBox(box: Rect, additive: boolean): PickEvent | null {
    const plan = this.plan();
    const within = (r: Rect) =>
      r.x >= box.x &&
      r.y >= box.y &&
      r.x + r.width <= box.x + box.width &&
      r.y + r.height <= box.y + box.height;
    const stalls = plan.stalls.filter((s) => within(stallRect(s))).map((s) => s.id);
    if (stalls.length) return { kind: 'stall', ids: stalls, additive };
    const seats = plan.seats.filter((s) => within(stallRect(s))).map((s) => s.id);
    if (seats.length) return { kind: 'seat', ids: seats, additive };
    return null;
  }

  private boxesOf(m: { kind: SelectionKind; ids: string[] }): Rect[] {
    const ids = new Set(m.ids);
    const list: Array<PlanStall | PlanContent['seats'][number]> =
      m.kind === 'stall' ? this.plan().stalls : m.kind === 'seat' ? this.plan().seats : [];
    return list.filter((i) => ids.has(i.id)).map(stallRect);
  }

  private zonesOf(m: { kind: SelectionKind; ids: string[] }): Point[][] {
    if (m.kind !== 'zone') return [];
    const ids = new Set(m.ids);
    return this.plan()
      .zones.filter((z) => ids.has(z.id))
      .map((z) => z.polygon);
  }
}

const HINTS: Record<PlannerTool, string> = {
  select: 'Click to select · Shift-click to add · Drag to move · Drag on the floor to box-select',
  pan: 'Drag to move the view · Scroll to zoom',
  'zone-rect': 'Drag on the floor to draw a zone · Esc to cancel',
  'zone-poly':
    'Click each corner · Double-click or Enter to close · Backspace removes a corner · Esc to cancel',
  booth: 'Drag to draw a booth, or click to place 3 × 3 m · Esc to cancel',
};

// ---- drawing helpers ------------------------------------------------------------------------

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('en-IN');
}

function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(b[0] - a[0]),
    height: Math.abs(b[1] - a[1]),
  };
}

function rectPoints(r: Rect): Point[] {
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ];
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

function sides(r: Rect): Array<[StallSide, Point, Point]> {
  const [a, b, c, d] = rectPoints(r);
  return [
    ['top', a, b],
    ['right', b, c],
    ['bottom', c, d],
    ['left', d, a],
  ];
}

function centroid(ring: Point[]): Point {
  const box = ringBox(ring);
  const c: Point = [box.x + box.width / 2, box.y + box.height / 2];
  if (pointInRing(c, ring)) return c;
  return [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
}

function pushRect(out: number[], r: Rect, z: number): void {
  const [a, b, c, d] = rectPoints(r);
  for (const p of [a, b, c, a, c, d]) out.push(p[0], -p[1], z);
}

function addPolygons(
  g: T.Group,
  polygons: MultiPolygon,
  color: string,
  opacity: number,
  order: number,
): void {
  for (const poly of polygons) {
    if (!poly[0] || poly[0].length < 3) continue;
    const shape = new T.Shape(poly[0].map((p) => new T.Vector2(p[0], -p[1])));
    for (const hole of poly.slice(1))
      shape.holes.push(new T.Path(hole.map((p) => new T.Vector2(p[0], -p[1]))));
    const mesh = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        side: T.DoubleSide,
        depthTest: false,
      }),
    );
    mesh.renderOrder = order;
    g.add(mesh);
  }
}

function addLine(g: T.Group, points: Point[], color: string, order: number, closed: boolean): void {
  if (points.length < 2) return;
  const ring = closed ? [...points, points[0]] : points;
  const line = new T.Line(
    new T.BufferGeometry().setFromPoints(ring.map((p) => new T.Vector3(p[0], -p[1], order))),
    new T.LineBasicMaterial({ color, depthTest: false }),
  );
  line.renderOrder = order;
  g.add(line);
}

function addSegments(
  g: T.Group,
  positions: number[],
  color: string,
  order: number,
  dashed: boolean,
): void {
  if (!positions.length) return;
  const geom = new T.BufferGeometry();
  geom.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  const lines = new T.LineSegments(
    geom,
    dashed
      ? new T.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2, depthTest: false })
      : new T.LineBasicMaterial({ color, depthTest: false }),
  );
  if (dashed) lines.computeLineDistances();
  lines.renderOrder = order;
  g.add(lines);
}

/** The 1 m grid over the hall, every 10 m darker. */
function addGrid(g: T.Group, e: Rect): void {
  const minor: number[] = [];
  const major: number[] = [];
  const [x0, x1] = [Math.floor(e.x), Math.ceil(e.x + e.width)];
  const [y0, y1] = [Math.floor(e.y), Math.ceil(e.y + e.height)];
  for (let x = x0; x <= x1; x++) (x % 10 ? minor : major).push(x, -y0, 1, x, -y1, 1);
  for (let y = y0; y <= y1; y++) (y % 10 ? minor : major).push(x0, -y, 1, x1, -y, 1);
  for (const [list, opacity] of [
    [minor, 0.18],
    [major, 0.4],
  ] as const) {
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(list, 3));
    const lines = new T.LineSegments(
      geom,
      new T.LineBasicMaterial({ color: '#64748b', transparent: true, opacity, depthTest: false }),
    );
    lines.renderOrder = 1;
    g.add(lines);
  }
}

function addLabel(g: T.Group, text: string, r: Rect): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14532d';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50, 248);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false }));
  const w = Math.min(r.width * 0.9, r.height * 0.9 * (256 / 96));
  sprite.scale.set(w, (w * 96) / 256, 1);
  sprite.position.set(r.x + r.width / 2, -(r.y + r.height / 2), 23);
  sprite.renderOrder = 23;
  g.add(sprite);
}

function dispose(g: T.Group): void {
  for (const child of [...g.children]) {
    g.remove(child);
    child.traverse((o) => {
      const mesh = o as T.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        (m as T.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    });
  }
}
