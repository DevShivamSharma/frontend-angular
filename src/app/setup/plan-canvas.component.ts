import {
  AfterViewInit,
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
  viewChild
} from '@angular/core';

import type { HallOpening, Point } from '../planner/geometry/placement-rules';
import { amenityIcon } from './amenity-kinds';
import { pointInPolygon, polygonArea } from './custom-hall';
import type { HallDraft, RoomOutline } from './setup.models';

/** An amenity as the review shows it. */
export interface CanvasAmenity {
  id: string;
  kind: string;
  label: string;
  position: Point;
}

/**
 * What a click on the plan does:
 * - none: select and drag facility icons;
 * - edit: drag the outline's corners, add a corner on an edge, delete the selected one;
 * - measure: two clicks mark a length to calibrate the scale with;
 * - draw: clicks trace a new outline; clicking the first point (or Finish) closes it;
 * - pick: a click chooses one of the plan's closed areas.
 */
export type CanvasTool = 'none' | 'edit' | 'measure' | 'draw' | 'pick';

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ICON_PX = 22;
/** Clicks within this many screen pixels of a line end land on it (Alt switches it off). */
const SNAP_PX = 9;

/**
 * The review plan: the uploaded drawing's linework with what was found on top. Wheel or the
 * buttons zoom and dragging the background pans in every tool. With the plan focused, arrow
 * keys move the selected icon (Shift: 5 m) and Delete removes the selected outline corner.
 */
@Component({
  selector: 'app-plan-canvas',
  templateUrl: './plan-canvas.component.html',
  styleUrl: './plan-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'tool-' + tool() + (placing() ? ' placing' : '') + (underlay() ? ' has-underlay' : '')" }
})
export class PlanCanvasComponent implements AfterViewInit {
  readonly draft = input.required<HallDraft>();
  /** The outline to show and edit; the draft's own when null. */
  readonly outlineOverride = input<Point[] | null>(null);
  readonly amenities = input.required<CanvasAmenity[]>();
  readonly showZones = input(true);
  readonly showPillars = input(true);
  /** Pillars only: 'outside' and 'wall' rectangles carve the floor (see `floorMasks`). */
  readonly pillars = computed(() => this.draft().blockedAreas.filter(b => b.kind === 'zone'));
  readonly floorMasks = computed(() => this.draft().blockedAreas.filter(b => b.kind !== 'zone'));
  readonly showOpenings = input(true);
  readonly showMarkers = input(true);
  readonly selectedId = input<string | null>(null);
  readonly highlightId = input<string | null>(null);
  /** Kind being added; null when not in add mode. */
  readonly placing = input<string | null>(null);
  readonly tool = input<CanvasTool>('none');
  /** A picture of the plan behind everything (image uploads), in this view's metres. */
  readonly underlay = input<{ href: string; x: number; z: number; width: number; height: number } | null>(null);
  /** Doors to draw; the draft's own when null. */
  readonly openingList = input<HallOpening[] | null>(null);
  readonly rooms = input<RoomOutline[]>([]);

  readonly selectItem = output<string | null>();
  readonly moveItem = output<{ id: string; position: Point }>();
  readonly place = output<Point>();
  readonly outlineChange = output<Point[]>();
  readonly measured = output<{ from: Point; to: Point; distance: number }>();
  readonly drawn = output<Point[]>();
  readonly roomPicked = output<RoomOutline>();

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly destroyRef = inject(DestroyRef);
  private readonly pixelWidth = signal(800);
  readonly view = signal<View>({ x: -50, y: -50, w: 100, h: 100 });

  /** Metres per screen pixel, so icons and text keep their on-screen size while zooming. */
  readonly unit = computed(() => this.view().w / Math.max(this.pixelWidth(), 1));
  readonly iconSize = computed(() => this.unit() * ICON_PX);
  readonly viewBox = computed(() => {
    const v = this.view();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  });

  readonly linework = computed(() => {
    const l = this.draft().linework;
    let d = '';
    for (let i = 0; i < l.length; i += 4) d += `M${l[i]} ${l[i + 1]}L${l[i + 2]} ${l[i + 3]}`;
    return d;
  });
  /** Line ends of the drawing, for snapping clicks onto walls and corners. */
  private readonly lineEnds = computed(() => this.draft().linework);
  readonly boundary = computed(() => this.outlineOverride() ?? this.draft().boundary);
  readonly outline = computed(() => pathOf(this.boundary()));
  readonly zones = computed(() => this.draft().zones.map(z => ({ id: z.id, d: pathOf(z.polygon), color: z.color ?? '#7e57c2' })));
  /** Doors as small arrows pointing into the hall. */
  readonly openings = computed(() =>
    (this.openingList() ?? this.draft().openings).map(o => {
      const [dx, dz] = { NORTH: [0, -1], SOUTH: [0, 1], EAST: [1, 0], WEST: [-1, 0] }[o.facing];
      return { id: o.id, x: o.position.x, z: o.position.z, dx, dz, label: o.label };
    })
  );
  readonly roomPaths = computed(() => this.rooms().map(r => ({ room: r, d: pathOf(r.polygon) })));
  /**
   * Midpoints of the outline's edges: where a new corner can be added. Only on edges long enough
   * on screen to click between their corners; zooming in reveals the rest.
   */
  readonly midpoints = computed(() => {
    const b = this.boundary();
    const min = this.unit() * 44;
    return b
      .map((p, i) => {
        const q = b[(i + 1) % b.length];
        return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, edge: i, long: Math.hypot(q.x - p.x, q.z - p.z) >= min };
      })
      .filter(m => m.long);
  });
  readonly iconOf = amenityIcon;

  // Tool state
  readonly selectedCorner = signal<number | null>(null);
  readonly hoverRoom = signal<string | null>(null);
  readonly pending = signal<Point[]>([]);
  readonly cursor = signal<Point | null>(null);
  readonly pendingPath = computed(() => {
    const pts = this.pending();
    const c = this.cursor();
    const all = c && this.tool() !== 'none' ? [...pts, c] : pts;
    return all.length ? 'M' + all.map(p => `${p.x} ${p.z}`).join('L') : '';
  });

  private drag: { id: string; pointer: number } | null = null;
  private cornerDrag: { index: number; pointer: number } | null = null;
  private pan: { pointer: number; x: number; y: number; view: View; moved: boolean } | null = null;

  constructor() {
    // A different plan (another candidate, or the overview) is fitted again.
    effect(() => {
      this.draft();
      queueMicrotask(() => this.fit());
    });
    // A new tool starts clean.
    effect(() => {
      this.tool();
      untracked(() => {
        this.pending.set([]);
        this.selectedCorner.set(null);
        this.hoverRoom.set(null);
      });
    });
  }

  ngAfterViewInit(): void {
    const el = this.svg().nativeElement;
    const observer = new ResizeObserver(entries => this.pixelWidth.set(entries[0].contentRect.width || 800));
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomAt(Math.exp(e.deltaY * 0.0015), this.toPlan(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    });
    this.fit();
  }

  fit(): void {
    const d = this.draft();
    const pts = d.boundary.length ? d.boundary : [{ x: -50, z: -50 }, { x: 50, z: 50 }];
    const xs = pts.map(p => p.x);
    const zs = pts.map(p => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const pad = Math.max(maxX - minX, maxZ - minZ) * 0.08;
    const el = this.svg()?.nativeElement;
    const aspect = el ? el.clientHeight / Math.max(el.clientWidth, 1) || 0.65 : 0.65;
    let w = maxX - minX + 2 * pad;
    let h = maxZ - minZ + 2 * pad;
    if (h / w > aspect) w = h / aspect;
    else h = w * aspect;
    this.view.set({ x: (minX + maxX) / 2 - w / 2, y: (minZ + maxZ) / 2 - h / 2, w, h });
  }

  zoom(factor: number): void {
    const v = this.view();
    this.zoomAt(factor, { x: v.x + v.w / 2, z: v.y + v.h / 2 });
  }

  private zoomAt(factor: number, at: Point): void {
    const v = this.view();
    const w = Math.min(Math.max(v.w * factor, 5), 5000);
    const k = w / v.w;
    this.view.set({ x: at.x - (at.x - v.x) * k, y: at.z - (at.z - v.y) * k, w, h: v.h * k });
  }

  /** Closes the outline being drawn (draw tool). */
  finishDrawing(): void {
    const pts = this.pending();
    if (pts.length < 3) return;
    this.pending.set([]);
    this.drawn.emit(pts);
  }

  /** Takes back the last point (draw and measure tools). */
  undoPoint(): void {
    this.pending.update(pts => pts.slice(0, -1));
  }

  // --- pointer ------------------------------------------------------------------------------

  /**
   * Focus for the keyboard, without the browser scrolling the plan into view: that scroll would
   * move the plan under the pointer between two clicks (a measurement, an outline).
   */
  private grabFocus(event: PointerEvent): void {
    event.preventDefault();
    this.svg().nativeElement.focus({ preventScroll: true });
  }

  onIconDown(event: PointerEvent, id: string): void {
    if (this.placing() || this.tool() !== 'none') return;
    event.stopPropagation();
    this.grabFocus(event);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.drag = { id, pointer: event.pointerId };
    this.selectItem.emit(id);
  }

  onCornerDown(event: PointerEvent, index: number): void {
    event.stopPropagation();
    this.grabFocus(event);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.selectedCorner.set(index);
    this.cornerDrag = { index, pointer: event.pointerId };
  }

  /** A "+" on an edge: a new corner there, already being dragged. */
  onMidpointDown(event: PointerEvent, edge: number): void {
    event.stopPropagation();
    this.grabFocus(event);
    const b = [...this.boundary()];
    const p = this.midpoints()[edge];
    b.splice(edge + 1, 0, { x: round1(p.x), z: round1(p.z) });
    this.outlineChange.emit(b);
    this.svg().nativeElement.setPointerCapture(event.pointerId);
    this.selectedCorner.set(edge + 1);
    this.cornerDrag = { index: edge + 1, pointer: event.pointerId };
  }

  onBackgroundDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.grabFocus(event);
    this.svg().nativeElement.setPointerCapture(event.pointerId);
    this.pan = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: this.view(), moved: false };
  }

  onPointerMove(event: PointerEvent): void {
    const at = this.toPlan(event.clientX, event.clientY);
    if (this.drag && event.pointerId === this.drag.pointer) {
      this.moveItem.emit({ id: this.drag.id, position: round(at) });
      return;
    }
    if (this.cornerDrag && event.pointerId === this.cornerDrag.pointer) {
      const b = [...this.boundary()];
      b[this.cornerDrag.index] = round(this.snap(at, event.altKey));
      this.outlineChange.emit(b);
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointer) {
      const dx = event.clientX - this.pan.x;
      const dy = event.clientY - this.pan.y;
      if (Math.hypot(dx, dy) > 3) this.pan.moved = true;
      const u = this.pan.view.w / Math.max(this.pixelWidth(), 1);
      this.view.set({ ...this.pan.view, x: this.pan.view.x - dx * u, y: this.pan.view.y - dy * u });
      return;
    }
    const tool = this.tool();
    if (tool === 'measure' || tool === 'draw') this.cursor.set(this.snap(at, event.altKey));
    if (tool === 'pick') this.hoverRoom.set(this.roomAt(at)?.id ?? null);
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag && event.pointerId === this.drag.pointer) {
      this.drag = null;
      return;
    }
    if (this.cornerDrag && event.pointerId === this.cornerDrag.pointer) {
      this.cornerDrag = null;
      return;
    }
    if (!this.pan || event.pointerId !== this.pan.pointer) return;
    const click = !this.pan.moved;
    this.pan = null;
    if (!click) return;
    const at = this.toPlan(event.clientX, event.clientY);
    switch (this.tool()) {
      case 'measure': {
        const p = round(this.snap(at, event.altKey));
        const pts = [...this.pending(), p];
        if (pts.length === 2) {
          this.pending.set(pts);
          this.measured.emit({ from: pts[0], to: pts[1], distance: Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) });
        } else this.pending.set([p]);
        return;
      }
      case 'draw': {
        const p = round(this.snap(at, event.altKey));
        const pts = this.pending();
        // Clicking the first point again closes the outline.
        if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.z - pts[0].z) < this.unit() * 12) return this.finishDrawing();
        this.pending.set([...pts, p]);
        return;
      }
      case 'pick': {
        const room = this.roomAt(at);
        if (room) this.roomPicked.emit(room);
        return;
      }
      case 'edit':
        this.selectedCorner.set(null);
        return;
      default:
        if (this.placing()) this.place.emit(round(at));
        else this.selectItem.emit(null);
    }
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === '+' || event.key === '=') return this.zoom(0.8);
    if (event.key === '-') return this.zoom(1.25);
    const tool = this.tool();
    if (tool === 'edit' && (event.key === 'Delete' || event.key === 'Backspace')) {
      const i = this.selectedCorner();
      const b = this.boundary();
      if (i === null || b.length <= 3) return;
      event.preventDefault();
      this.outlineChange.emit(b.filter((_, k) => k !== i));
      this.selectedCorner.set(null);
      return;
    }
    if (tool === 'draw' && event.key === 'Enter') return this.finishDrawing();
    if ((tool === 'draw' || tool === 'measure') && event.key === 'Backspace') {
      event.preventDefault();
      return this.undoPoint();
    }
    const id = this.selectedId();
    const step = event.shiftKey ? 5 : 0.5;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    if (tool !== 'none' || !id || !delta[event.key]) return;
    const item = this.amenities().find(a => a.id === id);
    if (!item) return;
    event.preventDefault();
    const [dx, dz] = delta[event.key];
    this.moveItem.emit({ id, position: round({ x: item.position.x + dx, z: item.position.z + dz }) });
  }

  /** The smallest listed area containing the point: an inner room wins over the building. */
  private roomAt(p: Point): RoomOutline | null {
    let best: RoomOutline | null = null;
    for (const r of this.rooms()) {
      if (pointInPolygon(p, r.polygon) && (!best || polygonArea(r.polygon) < polygonArea(best.polygon))) best = r;
    }
    return best;
  }

  /** The nearest line end within a few screen pixels, else the point itself. */
  private snap(p: Point, off: boolean): Point {
    if (off) return p;
    const l = this.lineEnds();
    const reach = this.unit() * SNAP_PX;
    let best = p;
    let dist = reach;
    for (let i = 0; i < l.length; i += 2) {
      const d = Math.abs(l[i] - p.x) + Math.abs(l[i + 1] - p.z);
      if (d < dist) {
        dist = d;
        best = { x: l[i], z: l[i + 1] };
      }
    }
    return best;
  }

  private toPlan(clientX: number, clientY: number): Point {
    const svg = this.svg().nativeElement;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, z: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y };
  }
}

function pathOf(points: Point[]): string {
  return points.length ? 'M' + points.map(p => `${p.x} ${p.z}`).join('L') + 'Z' : '';
}

function round(p: Point): Point {
  return { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
}

function round1(v: number): number {
  return Math.round(v * 100) / 100;
}
