import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { floorOutlines, planSize } from '../geometry/hall-plan';
import { ICON_SIZE } from '../geometry/plan-annotations';
import type { Point } from '../geometry/placement-rules';
import { iconUrlFor } from '../geometry/selfcare-layout';
import type { Hall } from '../models/hall.model';
import { IconComponent } from '../components/icon.component';
import { planFrame, type ExhibitorStall } from './exhibitor-view';

/** The visible part of the plan, in plan metres (x right, z down = SVG y). */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A label smaller than this on screen is not drawn: unreadable text is only noise. */
const MIN_LABEL_PX = 7;
/** Closest zoom: about this many metres across. */
const MIN_VIEW_M = 6;
/** A press that moves less than this is a tap, not a pan. */
const TAP_SLOP_PX = 6;

const ZONE_FILL: Record<string, string> = {
  PASSAGE: '#ef4444',
  NO_CONSTRUCTION: '#8b4513',
  EMERGENCY_EXIT_ACCESS: '#ef4444',
  ENTRY_EXIT_ACCESS: '#22c55e',
  FACILITY_ACCESS: '#f59e0b',
  FOYER: '#64748b',
  PARTITION: '#475569',
  SMOKE_CURTAIN: '#a855f7'
};

/**
 * The saved layout as a flat, read-only floor plan (SVG): what an exhibitor needs to choose a
 * stall. Drag or two-finger pan, wheel or pinch zoom; tapping a stall selects it.
 *
 * SVG rather than the editor's 3D scene: a top-down plan is how exhibitors read hall layouts, it
 * stays sharp at every zoom, and every stall is a real element (hover, title, selection) without
 * picking rays. Coordinates are the saved plan metres, so nothing is re-projected.
 */
@Component({
  selector: 'app-exhibitor-plan',
  templateUrl: './exhibitor-plan.component.html',
  styleUrl: './exhibitor-plan.component.css',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExhibitorPlanComponent {
  readonly hall = input.required<Hall>();
  readonly stalls = input.required<readonly ExhibitorStall[]>();
  readonly selectedId = input<string | null>(null);
  /** Stalls matching the list's search and filters; the rest are dimmed. null: nothing filtered. */
  readonly matches = input<ReadonlySet<string> | null>(null);
  /** Bring a stall into view (e.g. picked from the list). `seq` repeats a request for the same stall. */
  readonly focus = input<{ id: string; seq: number } | null>(null);

  /** The tapped stall's id, or null for a tap on the empty plan. */
  readonly select = output<string | null>();

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  readonly frame = computed(() => planFrame(this.hall(), this.stalls()));
  readonly view = signal<View>({ x: 0, y: 0, w: 1, h: 1 });
  readonly viewBox = computed(() => {
    const v = this.view();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  });
  /** Container size in CSS pixels, from a ResizeObserver. */
  private readonly size = signal({ width: 1, height: 1 });
  /** Screen pixels per plan metre ("meet" scaling: the tighter axis wins). */
  readonly pxPerM = computed(() => {
    const v = this.view();
    const s = this.size();
    return Math.min(s.width / v.w, s.height / v.h);
  });

  readonly gridStep = computed(() => {
    const unit = Number(this.hall().rules?.gridUnit);
    return unit > 0 ? unit : 1;
  });
  /** The grid only where it reads as a grid, not as grey haze. */
  readonly showGrid = computed(() => this.gridStep() * this.pxPerM() >= 6);

  readonly floors = computed(() => {
    const hall = this.hall();
    const outlines = floorOutlines(hall);
    if (outlines.length) return { polygons: outlines.map(points), circle: null };
    const { width, length } = planSize(hall);
    if (hall.shape === 'CIRCLE') return { polygons: [], circle: { r: width / 2 } };
    return { polygons: [points([
      { x: -width / 2, z: -length / 2 }, { x: width / 2, z: -length / 2 },
      { x: width / 2, z: length / 2 }, { x: -width / 2, z: length / 2 }
    ])], circle: null };
  });

  readonly walls = computed(() => (this.hall().blockedAreas ?? [])
    .filter(a => a.kind === 'wall' && !a.hidden && validRect(a)));
  /** Coloured plan patches (pillars, painted passages). */
  readonly patches = computed(() => (this.hall().blockedAreas ?? [])
    .filter(a => a.kind === 'zone' && !a.hidden && validRect(a)));
  readonly zones = computed(() => (this.hall().zones ?? [])
    .filter(z => !z.hidden && z.polygon?.length >= 3)
    .map(z => ({ label: z.label, points: points(z.polygon), fill: z.color || ZONE_FILL[z.kind] || '#64748b' })));
  readonly openings = computed(() => (this.hall().openings ?? [])
    .filter(o => Number.isFinite(o.position?.x) && Number.isFinite(o.position?.z))
    .map(o => {
      const half = (o.width > 0 ? o.width : 2) / 2;
      const across = o.facing === 'NORTH' || o.facing === 'SOUTH';
      return {
        label: o.label || o.kind,
        emergency: o.kind === 'EMERGENCY',
        x1: o.position.x - (across ? half : 0), y1: o.position.z - (across ? 0 : half),
        x2: o.position.x + (across ? half : 0), y2: o.position.z + (across ? 0 : half),
        tx: o.position.x, ty: o.position.z
      };
    }));
  readonly markers = computed(() => (this.hall().markers ?? [])
    .filter(m => String(m.text ?? '').trim() && Number.isFinite(m.position?.x) && Number.isFinite(m.position?.z)));
  readonly amenities = computed(() => (this.hall().amenities ?? [])
    .filter(a => Number.isFinite(a.position?.x) && Number.isFinite(a.position?.z))
    .map(a => ({ label: a.label, x: a.position.x, y: a.position.z, href: iconUrlFor(a.kind) })));
  readonly compass = computed(() => {
    const c = this.hall().compass;
    if (!c || !Number.isFinite(c.position?.x) || !Number.isFinite(c.position?.z)) return null;
    return {
      size: c.size > 0 ? c.size : 5,
      transform: `translate(${c.position.x} ${c.position.z}) rotate(${c.rotation || 0})`,
      label: c.label || 'N',
      lx: c.position.x + (c.labelOffset?.x ?? 0),
      ly: c.position.z + (c.labelOffset?.z ?? 0)
    };
  });

  /** The key lists only what this plan draws: each zone label once, entrances when it has any. */
  readonly zoneKey = computed(() => {
    const seen = new Map<string, string>();
    for (const z of this.zones()) if (z.label && !seen.has(z.label)) seen.set(z.label, z.fill);
    return [...seen].map(([label, color]) => ({ label, color }));
  });

  readonly iconSize = ICON_SIZE;

  private fittedHall: unknown = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pressStart: { x: number; y: number } | null = null;
  private dragged = false;

  constructor() {
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) this.size.set({ width: box.width, height: box.height });
    });
    effect(() => observer.observe(this.svg().nativeElement));
    inject(DestroyRef).onDestroy(() => observer.disconnect());

    // Frame the hall once per hall. A booking changes the stalls, not the hall: the view stays.
    effect(() => {
      const hall = this.hall();
      const frame = this.frame();
      if (this.fittedHall === hall.id) return;
      this.fittedHall = hall.id;
      untracked(() => this.view.set({
        x: frame.minX, y: frame.minZ, w: frame.maxX - frame.minX, h: frame.maxZ - frame.minZ
      }));
    });

    effect(() => {
      const request = this.focus();
      if (!request) return;
      const stall = untracked(this.stalls).find(s => s.id === request.id);
      if (stall) untracked(() => this.bringIntoView(stall));
    });
  }

  /** The selected stall always keeps its name; others only when it would be legible. */
  labelVisible(stall: ExhibitorStall): boolean {
    return stall.id === this.selectedId() || stall.label.font * this.pxPerM() >= MIN_LABEL_PX;
  }

  /** Filtered out, so drawn faintly. The selected stall always stays clear. */
  dimmed(stall: ExhibitorStall): boolean {
    const matches = this.matches();
    return !!matches && !matches.has(stall.id) && stall.id !== this.selectedId();
  }

  edgePath(stall: ExhibitorStall, open: boolean): string {
    return stall.edges
      .filter(e => e.open === open)
      .map(e => `M${e.a.x} ${e.a.z}L${e.b.x} ${e.b.z}`)
      .join('');
  }

  points(stall: ExhibitorStall): string {
    return points(stall.outline);
  }

  ariaLabel(stall: ExhibitorStall): string {
    return `${stall.name}, ${stall.sizeText}, ${stall.available ? 'available' : 'booked'}`;
  }

  // --- view controls --------------------------------------------------------------------------

  fit(): void {
    const f = this.frame();
    this.view.set({ x: f.minX, y: f.minZ, w: f.maxX - f.minX, h: f.maxZ - f.minZ });
  }

  zoomBy(factor: number): void {
    const v = this.view();
    this.zoomAt({ x: v.x + v.w / 2, z: v.y + v.h / 2 }, factor);
  }

  onKey(event: KeyboardEvent): void {
    const v = this.view();
    const step = Math.min(v.w, v.h) * 0.15;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
    };
    if (moves[event.key]) this.panBy(...moves[event.key]);
    else if (event.key === '+' || event.key === '=') this.zoomBy(1 / 1.25);
    else if (event.key === '-') this.zoomBy(1.25);
    else if (event.key === '0') this.fit();
    else return;
    event.preventDefault();
  }

  // --- pointer gestures -----------------------------------------------------------------------

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoomAt(this.toPlan(event.clientX, event.clientY), Math.exp(event.deltaY * 0.0015));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.pressStart = { x: event.clientX, y: event.clientY };
      this.dragged = false;
    }
  }

  onPointerMove(event: PointerEvent): void {
    const before = this.pointers.get(event.pointerId);
    if (!before) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!this.dragged && this.pressStart && Math.hypot(now.x - this.pressStart.x, now.y - this.pressStart.y) > TAP_SLOP_PX) {
      this.dragged = true;
      // Captured only once it is a pan: a captured press would deliver its click to the <svg>,
      // not to the stall that was tapped.
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
    if (!this.dragged) return;

    if (this.pointers.size === 1) {
      const a = this.toPlan(before.x, before.y);
      const b = this.toPlan(now.x, now.y);
      this.panBy(a.x - b.x, a.z - b.z);
    } else if (this.pointers.size === 2) {
      // Pinch: zoom by the change in finger spread, about the point between the fingers.
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)![1];
      const spreadBefore = Math.hypot(before.x - other.x, before.y - other.y);
      const spreadNow = Math.hypot(now.x - other.x, now.y - other.y);
      if (spreadBefore > 0 && spreadNow > 0) {
        this.zoomAt(this.toPlan((now.x + other.x) / 2, (now.y + other.y) / 2), spreadBefore / spreadNow);
      }
    }
    this.pointers.set(event.pointerId, now);
  }

  onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.pressStart = null;
  }

  /** A tap (not the end of a pan) selects the stall under it, or clears the selection. */
  onClick(event: MouseEvent): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const target = (event.target as Element | null)?.closest('[data-stall-id]');
    this.select.emit(target?.getAttribute('data-stall-id') ?? null);
  }

  // --- view maths -----------------------------------------------------------------------------

  private toPlan(clientX: number, clientY: number): Point {
    const svg = this.svg().nativeElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, z: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x, z: p.y };
  }

  private panBy(dx: number, dy: number): void {
    this.view.update(v => this.clamp({ ...v, x: v.x + dx, y: v.y + dy }));
  }

  /** Zoom keeping `p` fixed on screen. factor < 1 zooms in. */
  private zoomAt(p: Point, factor: number): void {
    this.view.update(v => {
      const f = this.frame();
      const maxW = (f.maxX - f.minX) * 2;
      const w = Math.min(maxW, Math.max(MIN_VIEW_M, v.w * factor));
      const k = w / v.w;
      return this.clamp({ x: p.x - (p.x - v.x) * k, y: p.z - (p.z - v.y) * k, w, h: v.h * k });
    });
  }

  /** The view's centre stays over the plan, so it can never be lost off screen. */
  private clamp(v: View): View {
    const f = this.frame();
    const cx = Math.min(f.maxX, Math.max(f.minX, v.x + v.w / 2));
    const cy = Math.min(f.maxZ, Math.max(f.minZ, v.y + v.h / 2));
    return { ...v, x: cx - v.w / 2, y: cy - v.h / 2 };
  }

  /** Centre the stall; zoom in when it would be too small to tap comfortably. */
  private bringIntoView(stall: ExhibitorStall): void {
    const b = stall.bounds;
    const v = this.view();
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const k = Math.min(1, Math.max(span * 5, 16) / Math.min(v.w, v.h));
    const w = Math.max(MIN_VIEW_M, v.w * k);
    const h = v.h * (w / v.w);
    this.view.set(this.clamp({ x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minZ + b.maxZ) / 2 - h / 2, w, h }));
  }
}

function points(polygon: readonly Point[]): string {
  return polygon.map(p => `${p.x},${p.z}`).join(' ');
}

function validRect(a: { posX: number; posZ: number; width: number; length: number }): boolean {
  return [a.posX, a.posZ, a.width, a.length].every(Number.isFinite) && a.width > 0 && a.length > 0;
}
