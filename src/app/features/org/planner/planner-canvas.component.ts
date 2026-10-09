import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { FloorAreaKind as AreaKind, HallFloor } from '../../../core/api/api.models';
import {
  PlanContent,
  PlanObject,
  PlanObjectKind,
  PlanStall,
  stallLabel,
  StallSide,
} from '../../../core/plans/plans.models';
import type { MultiPolygon, Point } from '../../../core/venues/floor-plan.models';
import {
  facilityCardCanvas,
  iconGroupSize,
  labelCanvas,
  labelSize,
} from '../../../shared/floor/floor-annotations';
import {
  objectOutline,
  pointInRing,
  polygonArea,
  Rect,
  ringBox,
  segmentDistance,
  snap,
  stallRect,
  textBox,
} from './planner-geometry';
import { AREA_LABELS } from '../../../shared/floor/floor-view.component';
import { buildScene3d } from './planner-scene-3d';
import type { Selection, SelectionKind } from './planner.store';

export type PlannerTool =
  | 'select'
  | 'pan'
  | 'zone-rect'
  | 'zone-poly'
  | 'booth'
  | 'line'
  | 'rect'
  | 'circle'
  | 'polyline'
  | 'text'
  | 'mirror-line'
  | 'zoom-window'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-angle'
  | 'measure-height';

/** A drawing made with a drawing tool, for the page to add. */
export interface DrawObjectEvent {
  kind: PlanObjectKind;
  points: Point[];
}

/** Tools that change nothing, so they work on a read-only plan too. */
const VIEW_TOOLS: ReadonlySet<PlannerTool> = new Set<PlannerTool>([
  'zoom-window',
  'measure-distance',
  'measure-area',
  'measure-angle',
  'measure-height',
]);
/** Points a click-by-click tool takes before it is done by itself. */
const SHAPE_POINTS: Partial<Record<PlannerTool, number>> = { line: 2, 'mirror-line': 2 };

/** A side of the view cube: the plan from above, or the hall in 3D from one side. */
export type ViewFace = 'top' | 'front' | 'back' | 'left' | 'right';

/** Degrees round from the front (the bottom edge of the plan), clockwise seen from above. */
const AZIMUTH: Record<Exclude<ViewFace, 'top'>, number> = {
  front: 0,
  right: 90,
  back: 180,
  left: -90,
};
/** 3D opens from the front, a little to the left, looking down this many degrees. */
const HOME_AZIMUTH = -35;
const ELEVATION = 38;
/** Tools that work in 3D too; the others go back to the plan from above. */
const TOOLS_3D: ReadonlySet<PlannerTool> = new Set<PlannerTool>(['select', 'pan', 'booth']);
const HINTS_3D: Partial<Record<PlannerTool, string>> = {
  select: 'Click a stall to select it · Drag to look round · Right-drag to pan · Scroll to zoom',
  pan: 'Drag to pan · Scroll to zoom',
  booth:
    'Drag on the floor to draw a booth, or click to place 3 × 3 m · Right-drag to pan · Scroll to zoom',
};
/** The floor, for finding where the pointer is in 3D. */
const FLOOR_PLANE = new T.Plane(new T.Vector3(0, 1, 0), 0);

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
const MEASURE = '#6d28d9';
/** Pixels: a drawing within this of the pointer is under it. */
const HIT_PX = 6;
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
    <details class="legend" open>
      <summary>Legend</summary>
      @if (hallLegend().length) {
        <h4>Hall</h4>
        <ul>
          @for (l of hallLegend(); track $index) {
            <li>
              <span class="swatch" [style.background]="l.color">{{ l.code }}</span
              >{{ l.label }}
            </li>
          }
        </ul>
      }
      <h4>Plan</h4>
      <ul>
        @for (l of planLegend; track l.label) {
          <li>
            <span
              class="swatch"
              [class.line]="l.line"
              [style.background]="l.line ? null : l.color"
              [style.border-color]="l.border ?? l.color"
            ></span
            >{{ l.label }}
          </li>
        }
      </ul>
    </details>
    <div class="cube-wrap">
      @if (is3d()) {
        <div class="cube">
          <!-- The wheel: drag it round to turn the view; N follows the hall's north. -->
          <div
            class="ring"
            [style.transform]="'rotate(' + ringAngle() + 'deg)'"
            (pointerdown)="ringDown($event)"
            title="Drag to turn the view"
          >
            <span class="n">N</span>
            <span class="cardinal e">E</span>
            <span class="cardinal s">S</span>
            <span class="cardinal w">W</span>
          </div>
          @for (f of faces; track f.id) {
            <button
              type="button"
              class="face"
              [class]="'face ' + f.id"
              [class.on]="face() === f.id"
              [attr.aria-pressed]="face() === f.id"
              [attr.data-tour]="f.id === 'top' ? 'cube-top' : null"
              (click)="setFace(f.id)"
              [title]="f.title"
            >
              {{ f.label }}
            </button>
          }
        </div>
      }
      <div class="views">
        <button type="button" class="home" (click)="home()" title="Back to the whole hall">
          <i class="pi pi-home"></i> Home
        </button>
        <div class="dims" role="group" aria-label="2D or 3D" data-tour="view-switch">
          <button
            type="button"
            [class.on]="!is3d()"
            [attr.aria-pressed]="!is3d()"
            (click)="setFace('top')"
            title="The plan from above, to draw on"
          >
            2D
          </button>
          <button
            type="button"
            [class.on]="is3d()"
            [attr.aria-pressed]="is3d()"
            (click)="enter3d()"
            title="The hall in 3D, to look round"
          >
            3D
          </button>
        </div>
      </div>
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
    .tool-booth,
    .tool-line,
    .tool-rect,
    .tool-circle,
    .tool-polyline,
    .tool-text,
    .tool-mirror-line,
    .tool-zoom-window,
    .tool-measure-distance,
    .tool-measure-area,
    .tool-measure-angle,
    .tool-measure-height {
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
    .legend {
      position: absolute;
      top: 44px;
      left: 10px;
      max-width: 210px;
      max-height: calc(100% - 160px);
      overflow: auto;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgb(255 255 255 / 0.94);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
      font: 12px/1.3 var(--app-font-family, sans-serif);
      color: #1e293b;
    }
    .legend summary {
      cursor: pointer;
      font-weight: 700;
    }
    .legend h4 {
      margin: 8px 0 4px;
      font: 700 10px/1 var(--app-font-family, sans-serif);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #64748b;
    }
    .legend ul {
      display: grid;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .swatch {
      display: grid;
      place-items: center;
      flex: none;
      width: 20px;
      height: 14px;
      box-sizing: border-box;
      border: 1px solid rgb(0 0 0 / 0.2);
      border-radius: 3px;
      font-size: 8px;
      color: #fff;
    }
    .swatch.line {
      height: 0;
      border-width: 2px 0 0;
      border-style: dashed;
      border-radius: 0;
    }
    .cube-wrap {
      position: absolute;
      top: 16px;
      right: 16px;
      display: grid;
      justify-items: center;
      gap: 10px;
    }
    .cube {
      position: relative;
      display: grid;
      grid-template-columns: 22px 44px 22px;
      grid-template-rows: 22px 44px 22px;
      place-items: center;
      width: 104px;
      height: 104px;
      padding: 8px;
      box-sizing: border-box;
    }
    .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1px solid #cbd5e1;
      background: rgb(255 255 255 / 0.9);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
      cursor: grab;
      touch-action: none;
    }
    .ring:active {
      cursor: grabbing;
    }
    .n,
    .cardinal {
      position: absolute;
      font: 700 9px/1 sans-serif;
      color: #64748b;
      pointer-events: none;
    }
    .n {
      top: -2px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      color: #dc2626;
    }
    .cardinal.e {
      right: 1px;
      top: 50%;
      transform: translateY(-50%);
    }
    .cardinal.s {
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
    }
    .cardinal.w {
      left: 1px;
      top: 50%;
      transform: translateY(-50%);
    }
    .face {
      position: relative;
      z-index: 1;
      display: grid;
      place-items: center;
      padding: 0;
      font: 600 8px/1 sans-serif;
      letter-spacing: 0.04em;
      color: #334155;
      background: #fff;
      border: 1px solid #cbd5e1;
      border-radius: 3px;
      cursor: pointer;
    }
    .face:hover,
    .face:focus-visible {
      border-color: #2563eb;
      color: #1d4ed8;
    }
    .face.on {
      background: #1e293b;
      border-color: #1e293b;
      color: #fff;
    }
    .face.back {
      grid-area: 1 / 2;
      width: 44px;
      height: 16px;
    }
    .face.front {
      grid-area: 3 / 2;
      width: 44px;
      height: 16px;
    }
    .face.left,
    .face.right {
      width: 16px;
      height: 44px;
      writing-mode: vertical-rl;
    }
    .face.left {
      grid-area: 2 / 1;
      transform: rotate(180deg);
    }
    .face.right {
      grid-area: 2 / 3;
    }
    .face.top {
      grid-area: 2 / 2;
      width: 44px;
      height: 44px;
      font-size: 10px;
    }
    .views {
      display: grid;
      gap: 6px;
      justify-items: center;
    }
    .home {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      color: #1e293b;
      font: 500 13px/1.2 var(--app-font-family, sans-serif);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
      cursor: pointer;
    }
    .home:hover,
    .home:focus-visible {
      background: #f1f5f9;
    }
    .dims {
      display: flex;
      padding: 2px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
    }
    .dims button {
      min-width: 36px;
      padding: 4px 8px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: #334155;
      font: 600 12px/1.2 var(--app-font-family, sans-serif);
      cursor: pointer;
    }
    .dims button.on {
      background: #1e293b;
      color: #fff;
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
  readonly showGrid = input(true);
  readonly showLabels = input(true);

  readonly drawRect = output<Rect>();
  readonly drawObject = output<DrawObjectEvent>();
  /** A line drawn with Mirror line: the selection is mirrored across it. */
  readonly mirrorLine = output<[Point, Point]>();
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
  readonly is3d = signal(false);
  /** The hall's own legend, or else what kinds of area the floor has. */
  protected readonly hallLegend = computed(() => {
    const f = this.floor();
    const own = (f.legend ?? []).filter((l) => l.showInView !== false && l.label);
    if (own.length) {
      return own.map((l) => ({
        label: l.label,
        code: l.code ?? '',
        color: l.color ?? (l.kind ? AREA_COLORS[l.kind] : '#cbd5e1'),
      }));
    }
    const kinds = new Set<AreaKind>(
      f.geometry ? f.geometry.objects.map((o) => o.kind as AreaKind) : f.areas.map((a) => a.kind),
    );
    kinds.delete('outside');
    return [...kinds].map((k) => ({ label: AREA_LABELS[k], code: '', color: AREA_COLORS[k] }));
  });
  protected readonly planLegend: Array<{
    label: string;
    color: string;
    border?: string;
    line?: boolean;
  }> = [
    { label: 'Stall', color: STALL_FILL, border: STALL_EDGE },
    { label: 'Open side', color: STALL_EDGE, line: true },
    { label: 'Blocked stall', color: STALL_BLOCKED, border: '#94a3b8' },
    { label: 'Seat', color: SEAT_FILL },
    { label: 'Zone', color: 'rgb(59 130 246 / 0.15)', border: '#3b82f6' },
    { label: 'Selected', color: 'rgb(29 78 216 / 0.15)', border: SELECTED },
  ];
  protected readonly face = signal<ViewFace>('top');
  /** The wheel's turn: north, plus how far the view is turned. */
  protected readonly ringAngle = signal(0);
  protected readonly faces: Array<{ id: ViewFace; label: string; title: string }> = [
    { id: 'back', label: 'BACK', title: 'The hall in 3D from the back' },
    { id: 'left', label: 'LEFT', title: 'The hall in 3D from the left' },
    { id: 'top', label: 'TOP', title: 'The plan from above (2D)' },
    { id: 'right', label: 'RIGHT', title: 'The hall in 3D from the right' },
    { id: 'front', label: 'FRONT', title: 'The hall in 3D from the front' },
  ];

  private renderer?: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.OrthographicCamera();
  private readonly floorGroup = new T.Group();
  private readonly planGroup = new T.Group();
  private readonly draftGroup = new T.Group();
  private readonly gridGroup = new T.Group();
  /** The hall's text labels and helper cards (toilets, exits…), shown with the labels. */
  private readonly noteGroup = new T.Group();
  private observer?: ResizeObserver;
  private extent: Rect = { x: 0, y: 0, width: 100, height: 100 };
  /** The hall itself, without the labels around it. */
  private hallExtent: Rect = { x: 0, y: 0, width: 100, height: 100 };
  /** Degrees the 2D plan is turned clockwise on screen. */
  private spin = 0;
  private readonly raycaster = new T.Raycaster();
  /** A booth being drawn in 3D. */
  private readonly draft3 = new T.Group();
  private readonly scene3 = new T.Scene();
  private readonly group3 = new T.Group();
  private readonly camera3 = new T.PerspectiveCamera(45, 1, 0.1, 20000);
  private controls?: OrbitControls;

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
  /** Points of a measure; done once a distance has two or an area is closed. */
  private measure: Point[] = [];
  private measureDone = false;
  /** Points of a line, polyline or mirror line being drawn click by click. */
  private shape: Point[] = [];
  /** A circle being dragged out: its centre and radius. */
  private draftCircle: { c: Point; r: number } | null = null;
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
      this.showLabels();
      untracked(() => this.buildPlan());
    });
    effect(() => {
      this.gridGroup.visible = this.showGrid();
      untracked(() => this.render());
    });
    effect(() => {
      this.noteGroup.visible = this.showLabels();
      untracked(() => this.render());
    });
    effect(() => {
      const tool = this.tool();
      untracked(() => {
        this.cancel();
        // Drawing happens on the plan from above.
        if (this.is3d() && !TOOLS_3D.has(tool)) this.leave3d();
        this.setControlButtons();
        this.hint.set(this.is3d() ? this.hint3d() : HINTS[tool]);
      });
    });
    effect(() => {
      const input = {
        floor: this.floor(),
        plan: this.plan(),
        selection: this.selection(),
        categoryColors: this.categoryColors(),
        showGrid: this.showGrid(),
        showLabels: this.showLabels(),
      };
      if (!this.is3d()) return;
      untracked(() => {
        dispose(this.group3);
        buildScene3d(this.group3, input, this.hallExtent);
        this.render();
      });
    });
    destroyRef.onDestroy(() => this.stop());
  }

  // ---- public controls ----------------------------------------------------------------------

  /** Drops a shape being drawn. */
  cancel(): void {
    this.polygon = [];
    this.measure = [];
    this.measureDone = false;
    this.shape = [];
    this.draftCircle = null;
    this.draftRect = null;
    this.down = null;
    this.buildDraft();
  }

  /**
   * Closes the polygon being drawn, or the area being measured, when it has three corners; ends
   * a polyline that has two.
   */
  finishPolygon(): void {
    if (this.tool() === 'polyline' && this.shape.length >= 2) {
      const points = this.shape;
      this.cancel();
      this.drawObject.emit({ kind: 'polyline', points });
      return;
    }
    if (this.tool() === 'measure-area' && !this.measureDone && this.measure.length >= 3) {
      this.measureDone = true;
      this.pointer = null;
      this.buildDraft();
      return;
    }
    if (this.tool() !== 'zone-poly' || this.polygon.length < 3) return;
    const points = this.polygon;
    this.cancel();
    this.drawPolygon.emit(points);
  }

  /** Takes back the last corner of the polygon being drawn or the measure being taken. */
  undoCorner(): boolean {
    if (this.shape.length) {
      this.shape = this.shape.slice(0, -1);
      this.buildDraft();
      return true;
    }
    if (this.measure.length && !this.measureDone) {
      this.measure = this.measure.slice(0, -1);
      this.buildDraft();
      return true;
    }
    if (!this.polygon.length) return false;
    this.polygon = this.polygon.slice(0, -1);
    this.buildDraft();
    return true;
  }

  get drawing(): boolean {
    return (
      this.polygon.length > 0 ||
      this.measure.length > 0 ||
      this.shape.length > 0 ||
      this.draftRect !== null ||
      this.draftCircle !== null
    );
  }

  zoomBy(factor: number): void {
    if (this.is3d() && this.controls) {
      const target = this.controls.target;
      this.camera3.position.sub(target).divideScalar(factor).add(target);
      this.controls.update();
      return;
    }
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

  /** Fills the view with a box of the floor (Zoom window). */
  zoomTo(r: Rect): void {
    if (r.width <= 0 || r.height <= 0) return;
    this.camera.position.x = r.x + r.width / 2;
    this.camera.position.y = -(r.y + r.height / 2);
    const fit = Math.min(
      (this.camera.right - this.camera.left) / r.width,
      (this.camera.top - this.camera.bottom) / r.height,
    );
    this.camera.zoom = Math.max(0.05, Math.min(400, fit));
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** The middle of what is in view, floor metres. */
  viewCentre(): Point {
    if (this.is3d() && this.controls) return [this.controls.target.x, this.controls.target.z];
    return [this.camera.position.x, -this.camera.position.y];
  }

  // ---- view cube, wheel and 3D --------------------------------------------------------------

  /** TOP is the plan to draw on; a side opens the hall in 3D, seen from that side. */
  setFace(face: ViewFace): void {
    if (face === 'top') this.leave3d();
    else this.enter3d(AZIMUTH[face]);
  }

  /** The hall in 3D; from where it was last seen, or from `azimuth`. */
  enter3d(azimuth?: number): void {
    if (!this.renderer || !this.controls) return;
    const opening = !this.is3d();
    if (!opening && azimuth === undefined) return;
    this.down = null;
    this.cancel();
    this.is3d.set(true);
    this.controls.enabled = true;
    this.setControlButtons();
    this.place3d(azimuth ?? HOME_AZIMUTH);
    this.hint.set(this.hint3d());
    this.render();
  }

  private hint3d(): string {
    return HINTS_3D[this.tool()] ?? HINTS_3D.select!;
  }

  /** In 3D the left button turns the view, pans with Pan, and draws with Booth. */
  private setControlButtons(): void {
    if (!this.controls) return;
    const tool = this.tool();
    this.controls.mouseButtons.LEFT =
      tool === 'booth' ? null : tool === 'pan' ? T.MOUSE.PAN : T.MOUSE.ROTATE;
  }

  /** Where on the floor the pointer is in 3D, floor metres; null off the floor plane. */
  private floorPoint(e: { clientX: number; clientY: number }): Point | null {
    const r = this.renderer!.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera3,
    );
    const hit = new T.Vector3();
    return this.raycaster.ray.intersectPlane(FLOOR_PLANE, hit) ? [hit.x, hit.z] : null;
  }

  /** In 3D: Booth draws on the floor; Select picks with a click (a drag turns the view). */
  private down3d(e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = this.floorPoint(e);
    if (!p) return;
    const tool = this.tool();
    const base = { px: e.clientX, py: e.clientY, cam: [0, 0] as [number, number] };
    if (tool === 'booth' && !this.readonly()) {
      this.renderer!.domElement.setPointerCapture(e.pointerId);
      this.down = { ...base, world: p, mode: 'draw' };
    } else if (tool === 'select') {
      this.down = { ...base, world: p, mode: 'none' };
    }
  }

  private move3d(e: PointerEvent): void {
    const d = this.down;
    if (d?.mode !== 'draw' || Math.hypot(e.clientX - d.px, e.clientY - d.py) < CLICK_PX) return;
    const p = this.floorPoint(e);
    if (!p) return;
    this.draftRect = cellsBetween(d.world, p);
    this.buildDraft();
  }

  private up3d(e: PointerEvent): void {
    const d = this.down;
    if (!d) return;
    const click = Math.hypot(e.clientX - d.px, e.clientY - d.py) < CLICK_PX;
    const p = this.floorPoint(e);
    if (d.mode === 'draw') {
      const r = this.draftRect;
      if (r && r.width > 0 && r.height > 0) this.drawRect.emit(r);
      else if (click && p) this.placeAt.emit(cellCentre(p));
    } else if (click && p) {
      const hit = this.hit(p);
      this.pick.emit(hit ? { kind: hit.kind, ids: [hit.id], additive: e.shiftKey } : null);
    }
    this.down = null;
    this.draftRect = null;
    this.buildDraft();
  }

  /** The booth being drawn in 3D: a box as tall as a shell stall. */
  private buildDraft3d(): void {
    dispose(this.draft3);
    const r = this.draftRect;
    if (r && r.width > 0 && r.height > 0) {
      const box = new T.BoxGeometry(r.width, 2.5, r.height);
      const mesh = new T.Mesh(
        box,
        new T.MeshBasicMaterial({
          color: DRAFT,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      const edges = new T.LineSegments(
        new T.EdgesGeometry(box),
        new T.LineBasicMaterial({ color: DRAFT }),
      );
      for (const o of [mesh, edges]) o.position.set(r.x + r.width / 2, 1.25, r.y + r.height / 2);
      this.draft3.add(mesh, edges);
    }
    this.render();
  }

  /** Back to the plan from above. */
  leave3d(): void {
    if (!this.is3d()) return;
    this.is3d.set(false);
    if (this.controls) this.controls.enabled = false;
    this.draftRect = null;
    dispose(this.draft3);
    this.face.set('top');
    this.hint.set(HINTS[this.tool()]);
    this.applySpin();
  }

  /** The whole hall again: from above unturned, or in 3D from the opening side. */
  home(): void {
    if (this.is3d()) {
      this.place3d(HOME_AZIMUTH);
      this.render();
      return;
    }
    this.spin = 0;
    this.applySpin();
    this.fit();
  }

  /** Drags the wheel: the view turns as far as the wheel does. */
  protected ringDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const ring = e.currentTarget as HTMLElement;
    const box = ring.getBoundingClientRect();
    const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
    const angle = (ev: PointerEvent) =>
      (Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180) / Math.PI;
    const start = angle(e);
    const from = this.is3d() ? this.azimuth3d() : this.spin;
    ring.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const turn = angle(ev) - start;
      if (this.is3d()) this.setAzimuth(from + turn);
      else {
        this.spin = normalise(from + turn);
        this.applySpin();
      }
    };
    const up = () => {
      ring.removeEventListener('pointermove', move);
      ring.removeEventListener('pointerup', up);
      ring.removeEventListener('pointercancel', up);
    };
    ring.addEventListener('pointermove', move);
    ring.addEventListener('pointerup', up);
    ring.addEventListener('pointercancel', up);
  }

  /** Turns the 2D plan on screen; drawing still follows the hall's own axes. */
  private applySpin(): void {
    const a = (this.spin * Math.PI) / 180;
    this.camera.up.set(-Math.sin(a), Math.cos(a), 0);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.ringAngle.set(this.north() + this.spin);
    this.render();
  }

  /** Puts the 3D camera round the middle of the hall, looking down at it. */
  private place3d(azimuth: number): void {
    const e = this.hallExtent;
    const target = new T.Vector3(e.x + e.width / 2, 0, e.y + e.height / 2);
    const distance = Math.max(e.width, e.height, 10) * 1.05;
    const el = (ELEVATION * Math.PI) / 180;
    const az = (azimuth * Math.PI) / 180;
    const across = distance * Math.cos(el);
    this.camera3.position.set(
      target.x + across * Math.sin(az),
      distance * Math.sin(el),
      target.z + across * Math.cos(az),
    );
    this.controls!.target.copy(target);
    this.controls!.update();
  }

  /** Where the 3D camera stands round the hall, degrees from the front. */
  private azimuth3d(): number {
    const t = this.controls?.target ?? new T.Vector3();
    const d = this.camera3.position.clone().sub(t);
    return (Math.atan2(d.x, d.z) * 180) / Math.PI;
  }

  private setAzimuth(degrees: number): void {
    if (!this.controls) return;
    const t = this.controls.target;
    const d = this.camera3.position.clone().sub(t);
    const across = Math.hypot(d.x, d.z);
    const az = (degrees * Math.PI) / 180;
    this.camera3.position.set(t.x + across * Math.sin(az), t.y + d.y, t.z + across * Math.cos(az));
    this.controls.update();
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
    this.scene.add(
      this.floorGroup,
      this.gridGroup,
      this.noteGroup,
      this.planGroup,
      this.draftGroup,
    );
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
    this.scene3.background = new T.Color('#e8edf3');
    this.scene3.add(this.group3, this.draft3);
    this.controls = new OrbitControls(this.camera3, el);
    this.controls.enabled = false;
    // Never under the floor.
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.addEventListener('change', () => this.render());
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
    this.controls?.dispose();
    dispose(this.group3);
    dispose(this.draft3);
    for (const g of [
      this.floorGroup,
      this.gridGroup,
      this.noteGroup,
      this.planGroup,
      this.draftGroup,
    ])
      dispose(g);
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
    this.camera3.aspect = aspect;
    this.camera3.updateProjectionMatrix();
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
    if (this.is3d()) {
      this.renderer.render(this.scene3, this.camera3);
      const az = normalise(this.azimuth3d());
      this.face.set(
        Math.abs(az) <= 45
          ? 'front'
          : az > 45 && az <= 135
            ? 'right'
            : az < -45 && az >= -135
              ? 'left'
              : 'back',
      );
      this.ringAngle.set(this.north() + az);
      const chips = this.zoneChips3d();
      const r = this.draftRect;
      if (r && r.width > 0 && r.height > 0) {
        const v = new T.Vector3(r.x + r.width / 2, 2.7, r.y + r.height / 2).project(this.camera3);
        const host = this.host().nativeElement;
        chips.push({
          x: ((v.x + 1) / 2) * host.clientWidth,
          y: ((1 - v.y) / 2) * host.clientHeight,
          text: `${fmt(r.width)} × ${fmt(r.height)} = ${fmt(r.width * r.height)} m²`,
          kind: 'area',
        });
      }
      this.chips.set(chips);
      return;
    }
    this.renderer.render(this.scene, this.camera);
    this.updateChips();
  }

  /** Zone names, where the zones are in the 3D view. */
  private zoneChips3d(): Chip[] {
    const host = this.host().nativeElement;
    const chips: Chip[] = [];
    for (const z of this.plan().zones) {
      const [x, y] = centroid(z.polygon);
      const v = new T.Vector3(x, 0.05, y).project(this.camera3);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      chips.push({
        x: ((v.x + 1) / 2) * host.clientWidth,
        y: ((1 - v.y) / 2) * host.clientHeight,
        text: z.name,
        kind: 'zone',
      });
    }
    return chips;
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
    this.hallExtent = this.extent;
    this.north.set(f.north?.rotation ?? 0);
    this.ringAngle.set(this.north() + this.spin);
    dispose(this.gridGroup);
    addGrid(this.gridGroup, this.extent);
    dispose(this.noteGroup);
    addNotes(this.noteGroup, f);
    // Labels and helper cards often sit beside the hall; fitting the view shows them too.
    this.extent = ringBox([
      ...rectPoints(this.extent),
      ...noteBoxes(f).flatMap((b) => rectPoints(b)),
    ]);
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

    // Drawings: outlines, and text where it is written.
    for (const o of plan.objects) {
      const color = sel?.kind === 'object' && selected.has(o.id) ? SELECTED : o.color;
      if (o.kind === 'text') {
        addText(g, o.text ?? '', textBox(o), color);
        if (color === SELECTED) addLine(g, objectOutline(o).points, SELECTED, 16, true);
        continue;
      }
      const { points, closed } = objectOutline(o);
      addLine(g, points, color, 16, closed);
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
    if (this.showLabels() && plan.stalls.length <= LABELLED) {
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
    if (this.is3d()) {
      this.buildDraft3d();
      return;
    }
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
    if (this.measure.length) {
      let ring = this.measureRing();
      // Height goes straight up or down first, then across to the second point.
      if (this.tool() === 'measure-height' && ring.length >= 2) {
        ring = [ring[0], [ring[0][0], ring[1][1]], ring[1]];
      }
      const closed = this.tool() === 'measure-area' && this.measureDone;
      if (closed) addPolygons(g, [[ring]], MEASURE, 0.15, 40);
      addLine(g, ring, MEASURE, 41, closed);
      const geom = new T.BufferGeometry();
      geom.setAttribute(
        'position',
        new T.Float32BufferAttribute(
          this.measure.flatMap((p) => [p[0], -p[1], 42]),
          3,
        ),
      );
      const points = new T.Points(
        geom,
        new T.PointsMaterial({ color: MEASURE, size: 7, sizeAttenuation: false, depthTest: false }),
      );
      points.renderOrder = 42;
      g.add(points);
    }
    if (this.shape.length) {
      const line = this.pointer ? [...this.shape, this.pointer] : this.shape;
      addLine(g, line, this.tool() === 'mirror-line' ? SELECTED : DRAFT, 41, false);
    }
    if (this.draftCircle) {
      const { c, r } = this.draftCircle;
      const ring = objectOutline({ kind: 'circle', points: [c, [c[0] + r, c[1]]], text: null });
      addLine(g, ring.points, DRAFT, 41, true);
    }
    if (this.down?.mode === 'move' && this.down.move?.kind === 'object') {
      const [dx, dy] = this.moveOffset;
      const ids = new Set(this.down.move.ids);
      for (const o of this.plan().objects.filter((x) => ids.has(x.id))) {
        const { points, closed } = objectOutline(o);
        addLine(
          g,
          points.map(([x, y]) => [x + dx, y + dy] as Point),
          DRAFT,
          41,
          closed,
        );
      }
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
    if (this.shape.length) {
      const line = this.pointer ? [...this.shape, this.pointer] : this.shape;
      for (let i = 1; i < line.length; i++) chips.push(this.lengthChip(line[i - 1], line[i]));
    }
    if (this.draftCircle) {
      const { c, r } = this.draftCircle;
      chips.push({ ...this.screen(c), text: `r ${fmt(r)} m`, kind: 'length' });
    }
    const measureTool = this.tool();
    if (this.measure.length && measureTool === 'measure-angle') {
      const ring = this.measureRing();
      for (let i = 1; i < ring.length; i++) chips.push(this.lengthChip(ring[i - 1], ring[i]));
      if (ring.length >= 3) {
        const [a, b, c] = ring;
        const turn = Math.abs(
          Math.atan2(a[1] - b[1], a[0] - b[0]) - Math.atan2(c[1] - b[1], c[0] - b[0]),
        );
        const deg = (Math.min(turn, Math.PI * 2 - turn) * 180) / Math.PI;
        chips.push({ ...this.screen(b), text: `${fmt(deg)}°`, kind: 'area' });
      }
    } else if (this.measure.length && measureTool === 'measure-height') {
      const ring = this.measureRing();
      if (ring.length >= 2) {
        const [a, b] = ring;
        chips.push({
          ...this.screen([a[0], (a[1] + b[1]) / 2]),
          text: `↕ ${fmt(Math.abs(b[1] - a[1]))} m`,
          kind: 'area',
        });
      }
    } else if (this.measure.length) {
      const ring = this.measureRing();
      const area = measureTool === 'measure-area';
      const edges = area && this.measureDone ? [...ring, ring[0]] : ring;
      for (let i = 1; i < edges.length; i++) chips.push(this.lengthChip(edges[i - 1], edges[i]));
      if (area && ring.length >= 3) {
        chips.push({
          ...this.screen(centroid(ring)),
          text: `${fmt(polygonArea(ring))} m²`,
          kind: 'area',
        });
      } else if (!area && edges.length > 2) {
        let total = 0;
        for (let i = 1; i < edges.length; i++) {
          total += Math.hypot(edges[i][0] - edges[i - 1][0], edges[i][1] - edges[i - 1][1]);
        }
        chips.push({
          ...this.screen(edges[edges.length - 1]),
          text: `Total ${fmt(total)} m`,
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
    if (this.is3d()) return;
    const before = this.world(e);
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    const after = this.world(e);
    this.camera.position.x += before[0] - after[0];
    this.camera.position.y -= before[1] - after[1];
    this.render();
  };

  private readonly onDown = (e: PointerEvent) => {
    // In 3D the orbit controls have the pointer, but for drawing a booth or picking.
    if (this.is3d()) {
      this.down3d(e);
      return;
    }
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
    if (tool === 'zoom-window') {
      this.down = { ...base, mode: 'draw' };
      return;
    }
    if (VIEW_TOOLS.has(tool)) {
      this.down = { ...base, mode: 'none' };
      return;
    }
    if (this.readonly()) {
      this.down = { ...base, mode: 'pan' };
      return;
    }
    if (CELL_TOOLS.has(tool)) {
      // Kept as it is: the box is widened to whole grid cells as it is drawn.
      this.down = { ...base, world, mode: 'draw' };
      return;
    }
    if (tool === 'circle') {
      this.down = { ...base, world: this.snapped(world), mode: 'draw' };
      return;
    }
    if (
      tool === 'zone-poly' ||
      tool === 'line' ||
      tool === 'polyline' ||
      tool === 'mirror-line' ||
      tool === 'text'
    ) {
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
    if (this.is3d()) {
      this.move3d(e);
      return;
    }
    const world = this.world(e);
    if (
      (this.tool() === 'zone-poly' && this.polygon.length) ||
      (this.measure.length && !this.measureDone) ||
      this.shape.length
    ) {
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
    } else if (d.mode === 'draw' && far && this.tool() === 'circle') {
      const edge = this.snapped(world);
      this.draftCircle = { c: d.world, r: Math.hypot(edge[0] - d.world[0], edge[1] - d.world[1]) };
      this.buildDraft();
    } else if (d.mode === 'draw' && far) {
      const tool = this.tool();
      this.draftRect = CELL_TOOLS.has(tool)
        ? cellsBetween(d.world, world)
        : rectBetween(d.world, tool === 'zoom-window' ? world : this.snapped(world));
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
    if (this.is3d()) {
      this.up3d(e);
      return;
    }
    const d = this.down;
    if (!d) return;
    const click = Math.hypot(e.clientX - d.px, e.clientY - d.py) < CLICK_PX;
    const world = this.world(e);
    const tool = this.tool();
    if (d.mode === 'draw' && tool === 'zoom-window') {
      if (this.draftRect) this.zoomTo(this.draftRect);
    } else if (d.mode === 'draw' && tool === 'circle') {
      const c = this.draftCircle;
      if (c && c.r > 0)
        this.drawObject.emit({ kind: 'circle', points: [c.c, [c.c[0] + c.r, c.c[1]]] });
    } else if (d.mode === 'draw' && tool === 'rect') {
      const r = this.draftRect;
      if (r && r.width > 0 && r.height > 0) {
        this.drawObject.emit({
          kind: 'rect',
          points: [
            [r.x, r.y],
            [r.x + r.width, r.y + r.height],
          ],
        });
      }
    } else if (d.mode === 'draw') {
      const r = this.draftRect;
      if (r && r.width > 0 && r.height > 0) this.drawRect.emit(r);
      else if (click && tool === 'booth') this.placeAt.emit(cellCentre(world));
    } else if (d.mode === 'none' && tool === 'zone-poly' && click) {
      this.addCorner(this.snapped(world));
    } else if (d.mode === 'none' && tool === 'text' && click) {
      this.drawObject.emit({ kind: 'text', points: [this.snapped(world)] });
    } else if (
      d.mode === 'none' &&
      click &&
      (tool === 'line' || tool === 'polyline' || tool === 'mirror-line')
    ) {
      this.addShapePoint(this.snapped(world));
    } else if (d.mode === 'none' && click && tool.startsWith('measure-')) {
      this.addMeasurePoint(this.snapped(world));
    } else if (d.mode === 'marquee') {
      if (click) this.pick.emit(null);
      else if (this.draftRect) this.pick.emit(this.inBox(this.draftRect, e.shiftKey));
    } else if (d.mode === 'move' && d.move && !click) {
      const [dx, dy] = this.moveOffset;
      if (dx || dy) this.move.emit({ ...d.move, dx, dy });
    }
    this.down = null;
    this.draftRect = null;
    this.draftCircle = null;
    this.moveOffset = [0, 0];
    this.buildDraft();
  };

  private readonly onCancel = () => {
    this.down = null;
    this.draftRect = null;
    this.draftCircle = null;
    this.buildDraft();
  };

  private readonly onLeave = () => {
    if (this.polygon.length || this.shape.length || (this.measure.length && !this.measureDone)) {
      this.pointer = null;
      this.buildDraft();
    }
  };

  private readonly onDoubleClick = () => {
    if (this.is3d()) return;
    if (this.tool() === 'measure-distance' && this.measure.length >= 2) {
      this.measureDone = true;
      this.pointer = null;
      this.buildDraft();
      return;
    }
    this.finishPolygon();
  };

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

  /** A point of the measure; after a finished one, a click starts a new one. */
  private addMeasurePoint(p: Point): void {
    if (this.measureDone) {
      this.measure = [];
      this.measureDone = false;
    }
    const last = this.measure[this.measure.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    this.measure = [...this.measure, p];
    // An angle is three points (the corner in the middle); a height two.
    const done = { 'measure-angle': 3, 'measure-height': 2 }[this.tool() as 'measure-angle'];
    if (done && this.measure.length >= done) {
      this.measureDone = true;
      this.pointer = null;
    }
    this.buildDraft();
  }

  /** A point of a line, polyline or mirror line; a line or mirror line ends at its second. */
  private addShapePoint(p: Point): void {
    const last = this.shape[this.shape.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    this.shape = [...this.shape, p];
    const tool = this.tool();
    if (this.shape.length >= (SHAPE_POINTS[tool] ?? Infinity)) {
      const [a, b] = this.shape;
      this.cancel();
      if (tool === 'mirror-line') this.mirrorLine.emit([a, b]);
      else this.drawObject.emit({ kind: 'line', points: [a, b] });
      return;
    }
    this.buildDraft();
  }

  /** The measure with the point under the pointer while it is being taken. */
  private measureRing(): Point[] {
    return this.pointer && !this.measureDone ? [...this.measure, this.pointer] : this.measure;
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
    // Drawings are picked near their outline; text anywhere in its box.
    const near = HIT_PX * this.metresPerPixel();
    for (let i = plan.objects.length - 1; i >= 0; i--) {
      const o = plan.objects[i];
      if (o.kind === 'text') {
        if (at(textBox(o))) return { kind: 'object', id: o.id };
        continue;
      }
      const { points, closed } = objectOutline(o);
      const ring = closed ? [...points, points[0]] : points;
      for (let j = 1; j < ring.length; j++) {
        if (segmentDistance(p, ring[j - 1], ring[j]) <= near) return { kind: 'object', id: o.id };
      }
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
    const objects = plan.objects
      .filter((o) => within(ringBox(objectOutline(o).points)))
      .map((o) => o.id);
    if (objects.length) return { kind: 'object', ids: objects, additive };
    return null;
  }

  /** Floor metres one screen pixel spans at the current zoom. */
  private metresPerPixel(): number {
    const width = Math.max(1, this.host().nativeElement.clientWidth);
    return (this.camera.right - this.camera.left) / this.camera.zoom / width;
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
  line: 'Click where the line starts, then where it ends · Esc to cancel',
  rect: 'Drag to draw a rectangle · Esc to cancel',
  circle: 'Drag from the centre out to draw a circle · Esc to cancel',
  polyline: 'Click each point · Double-click or Enter to finish · Backspace removes a point',
  text: 'Click where the text goes, then write it in Properties',
  'mirror-line':
    'Click two points of the line to mirror the selected booths across (copies are made)',
  'zoom-window': 'Drag a box around what to zoom to',
  'measure-distance': 'Click points to measure · Double-click to finish · Esc to clear',
  'measure-area':
    'Click each corner · Double-click or Enter to close · Backspace removes a corner · Esc to clear',
  'measure-angle': 'Click a point, then the corner, then a second point · Esc to clear',
  'measure-height': 'Click two points to measure the height between them · Esc to clear',
};

// ---- drawing helpers ------------------------------------------------------------------------

/** Degrees in (-180, 180]. */
function normalise(degrees: number): number {
  const d = ((degrees % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('en-IN');
}

/** Metres a grid cell is: the 1 m grid the plan draws. */
const CELL = 1;
/** Tools that draw a box of whole grid cells. */
const CELL_TOOLS: ReadonlySet<PlannerTool> = new Set<PlannerTool>(['booth', 'zone-rect', 'rect']);

/**
 * The whole grid cells a drag touches: a drag started or ended part-way into a cell takes that
 * cell in full.
 */
function cellsBetween(a: Point, b: Point): Rect {
  const x0 = Math.floor(Math.min(a[0], b[0]) / CELL) * CELL;
  const y0 = Math.floor(Math.min(a[1], b[1]) / CELL) * CELL;
  const x1 = Math.max(x0 + CELL, Math.ceil(Math.max(a[0], b[0]) / CELL) * CELL);
  const y1 = Math.max(y0 + CELL, Math.ceil(Math.max(a[1], b[1]) / CELL) * CELL);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The middle of the grid cell a point is in; a booth placed by a click is centred there. */
function cellCentre(p: Point): Point {
  return [Math.floor(p[0] / CELL) * CELL + CELL / 2, Math.floor(p[1] / CELL) * CELL + CELL / 2];
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

/** Where the hall's text labels and helper cards are. */
function noteBoxes(f: HallFloor): Rect[] {
  return [
    ...(f.labels ?? []).map((l) => ({ x: l.x, y: l.y, ...labelSize(f, l) })),
    ...(f.iconGroups ?? [])
      .filter((g) => g.icons.length)
      .map((g) => ({ x: g.x, y: g.y, ...iconGroupSize(f, g) })),
  ];
}

/** The hall's text labels and helper cards, where the hall pages draw them. */
function addNotes(g: T.Group, f: HallFloor): void {
  const sprite = (canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false }));
    s.position.set(x + w / 2, -(y + h / 2), 5);
    s.scale.set(w, h, 1);
    s.renderOrder = 5;
    g.add(s);
  };
  for (const l of f.labels ?? []) {
    const size = labelSize(f, l);
    sprite(labelCanvas(l.text), l.x, l.y, size.width, size.height);
  }
  for (const group of f.iconGroups ?? []) {
    const canvas = facilityCardCanvas(group);
    if (!canvas) continue;
    const size = iconGroupSize(f, group);
    sprite(canvas, group.x, group.y, size.width, size.height);
  }
}

/** A drawing's text, left-aligned in its box, in its colour. */
function addText(g: T.Group, text: string, r: Rect, color: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round((r.width / r.height) * 96));
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = '64px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 50, canvas.width);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false }));
  sprite.scale.set(r.width, r.height, 1);
  sprite.position.set(r.x + r.width / 2, -(r.y + r.height / 2), 17);
  sprite.renderOrder = 17;
  g.add(sprite);
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
