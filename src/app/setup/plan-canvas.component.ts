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
  viewChild
} from '@angular/core';

import type { Point } from '../planner/geometry/placement-rules';
import { amenityIcon } from './amenity-kinds';
import type { HallDraft } from './setup.models';

/** An amenity as the review shows it. */
export interface CanvasAmenity {
  id: string;
  kind: string;
  label: string;
  position: Point;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ICON_PX = 22;

/**
 * The review plan: the uploaded drawing's linework with what was found on top. Wheel or the
 * buttons zoom, dragging the background pans, dragging an icon moves it, and in "add" mode a
 * click places a new one. With the plan focused, arrow keys move the selected icon (Shift: 5 m).
 */
@Component({
  selector: 'app-plan-canvas',
  templateUrl: './plan-canvas.component.html',
  styleUrl: './plan-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.placing]': 'placing()' }
})
export class PlanCanvasComponent implements AfterViewInit {
  readonly draft = input.required<HallDraft>();
  readonly amenities = input.required<CanvasAmenity[]>();
  readonly showZones = input(true);
  readonly showPillars = input(true);
  readonly showOpenings = input(true);
  readonly showMarkers = input(true);
  readonly selectedId = input<string | null>(null);
  readonly highlightId = input<string | null>(null);
  /** Kind being added; null when not in add mode. */
  readonly placing = input<string | null>(null);

  readonly selectItem = output<string | null>();
  readonly moveItem = output<{ id: string; position: Point }>();
  readonly place = output<Point>();

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
  readonly outline = computed(() => pathOf(this.draft().boundary));
  readonly zones = computed(() => this.draft().zones.map(z => ({ id: z.id, d: pathOf(z.polygon), color: z.color ?? '#7e57c2' })));
  /** Doors as small arrows pointing into the hall. */
  readonly openings = computed(() =>
    this.draft().openings.map(o => {
      const [dx, dz] = { NORTH: [0, -1], SOUTH: [0, 1], EAST: [1, 0], WEST: [-1, 0] }[o.facing];
      return { id: o.id, x: o.position.x, z: o.position.z, dx, dz, label: o.label };
    })
  );
  readonly iconOf = amenityIcon;

  private drag: { id: string; pointer: number; moved: boolean } | null = null;
  private pan: { pointer: number; x: number; y: number; view: View; moved: boolean } | null = null;

  constructor() {
    // A different outline (another candidate) is a different plan: fit it again.
    effect(() => {
      this.draft();
      queueMicrotask(() => this.fit());
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
    const xs = d.boundary.map(p => p.x);
    const zs = d.boundary.map(p => p.z);
    if (!xs.length) return;
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

  // --- pointer ------------------------------------------------------------------------------

  onIconDown(event: PointerEvent, id: string): void {
    if (this.placing()) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.drag = { id, pointer: event.pointerId, moved: false };
    this.selectItem.emit(id);
  }

  onBackgroundDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.svg().nativeElement.setPointerCapture(event.pointerId);
    this.pan = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: this.view(), moved: false };
  }

  onPointerMove(event: PointerEvent): void {
    if (this.drag && event.pointerId === this.drag.pointer) {
      this.drag.moved = true;
      this.moveItem.emit({ id: this.drag.id, position: round(this.toPlan(event.clientX, event.clientY)) });
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointer) {
      const dx = event.clientX - this.pan.x;
      const dy = event.clientY - this.pan.y;
      if (Math.hypot(dx, dy) > 3) this.pan.moved = true;
      const u = this.pan.view.w / Math.max(this.pixelWidth(), 1);
      this.view.set({ ...this.pan.view, x: this.pan.view.x - dx * u, y: this.pan.view.y - dy * u });
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag && event.pointerId === this.drag.pointer) {
      this.drag = null;
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointer) {
      const click = !this.pan.moved;
      this.pan = null;
      if (!click) return;
      if (this.placing()) this.place.emit(round(this.toPlan(event.clientX, event.clientY)));
      else this.selectItem.emit(null);
    }
  }

  onKey(event: KeyboardEvent): void {
    const id = this.selectedId();
    const step = event.shiftKey ? 5 : 0.5;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    if (event.key === '+' || event.key === '=') return this.zoom(0.8);
    if (event.key === '-') return this.zoom(1.25);
    if (!id || !delta[event.key]) return;
    const item = this.amenities().find(a => a.id === id);
    if (!item) return;
    event.preventDefault();
    const [dx, dz] = delta[event.key];
    this.moveItem.emit({ id, position: round({ x: item.position.x + dx, z: item.position.z + dz }) });
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
