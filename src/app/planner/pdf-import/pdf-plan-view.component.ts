import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import type { Hall } from '../models/hall.model';
import { planBounds } from '../geometry/hall-plan';
import { placementContextFor } from '../geometry/hall-rules';
import type { Point, Rect } from '../geometry/placement-rules';
import type { PdfGroup, PdfImportResult, PdfStall } from './pdf-import.model';
import { bounds, CATEGORY_COLORS, placeOutline, type Alignment } from './pdf-import-plan';
import type { PageImage } from './pdf-underlay';

export type PlanViewMode = 'drawing' | 'hall';

interface Shape {
  key: string;
  points: string;
  /** Open (fascia) edges as line segments. */
  open: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  stroke: string;
  fill: string;
  included: boolean;
  selected: boolean;
  special: boolean;
  ruleIssue: boolean;
}

let nextId = 0;

const CONFIDENCE_STROKE: Record<PdfStall['confidence'], string> = {
  high: '#15803d',
  medium: '#d97706',
  low: '#dc2626',
};

/**
 * The review canvas: the plan as drawn (PDF page with the detected outlines over it), or the
 * planner hall with the drawing placed on it (floor, walls and zones, the PDF underlay moved with
 * each drawing hall, the stalls where they will go). Wheel zooms, drag pans, a click selects a
 * stall; the stall list next to it is the keyboard route to the same selection.
 */
@Component({
  selector: 'app-pdf-plan-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pdf-plan-view.component.css',
  template: `
    <div class="view-tools">
      <button type="button" class="btn-mini" (click)="zoom(0.7)" aria-label="Zoom in">+</button>
      <button type="button" class="btn-mini" (click)="zoom(1 / 0.7)" aria-label="Zoom out">−</button>
      <button type="button" class="btn-mini" (click)="fitContent()">Fit</button>
      @if (mode() === 'drawing') {
        <button type="button" class="btn-mini" (click)="fitPage()">Whole page</button>
      }
    </div>
    <span class="key" aria-hidden="true">
      <i style="background:#15803d"></i>sure <i style="background:#d97706"></i>check
      <i style="background:#dc2626"></i>conflict <i style="background:#16a34a;height:4px"></i>open side
      @if (mode() === 'hall') { <i style="background:#2563eb"></i>selected }
    </span>
    <svg
      #svg
      [attr.viewBox]="viewBox()"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      [attr.aria-label]="mode() === 'drawing' ? 'Plan drawing with the detected stalls' : 'Planner hall with the imported stalls'"
      (wheel)="onWheel($event)"
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="drag = null"
    >
      <defs>
        @for (c of clips(); track c.id) {
          <clipPath [attr.id]="c.id" clipPathUnits="userSpaceOnUse">
            <rect [attr.x]="c.rect.minX" [attr.y]="c.rect.minZ" [attr.width]="c.rect.maxX - c.rect.minX" [attr.height]="c.rect.maxZ - c.rect.minZ" />
          </clipPath>
        }
      </defs>

      @if (mode() === 'drawing') {
        @if (page(); as p) {
          <image [attr.href]="p.url" x="0" y="0" [attr.width]="p.width" [attr.height]="p.height" />
        }
        @for (e of excluded(); track $index) {
          <polygon class="excluded" [attr.points]="e" />
        }
      } @else {
        @for (f of floor().rings; track $index) {
          <polygon class="floor" [attr.points]="f" />
        }
        @for (o of floor().obstacles; track $index) {
          <polygon class="obstacle" [attr.points]="o" />
        }
        @for (z of floor().zones; track $index) {
          <polygon class="zone" [attr.points]="z" />
        }
        @if (page(); as p) {
          @for (u of underlays(); track u.group) {
            <g [attr.transform]="u.transform" class="underlay">
              <image [attr.href]="p.url" x="0" y="0" [attr.width]="p.width" [attr.height]="p.height" [attr.clip-path]="'url(#' + u.clip + ')'" />
            </g>
          }
        }
      }

      @for (s of shapes(); track s.key) {
        <polygon
          class="stall"
          [class.is-off]="!s.included"
          [class.is-selected]="s.selected"
          [class.is-special]="s.special"
          [class.is-rule]="s.ruleIssue"
          [attr.points]="s.points"
          [attr.stroke]="s.stroke"
          [attr.fill]="s.fill"
          [attr.data-key]="s.key"
        />
        @for (l of s.open; track $index) {
          <line class="open" [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" />
        }
      }

      @if (mode() === 'drawing') {
        @for (u of unresolvedMarks(); track $index) {
          <circle class="unresolved" [attr.cx]="u.x" [attr.cy]="u.y" [attr.r]="u.r" />
        }
      }
    </svg>
  `,
})
export class PdfPlanViewComponent {
  readonly mode = input.required<PlanViewMode>();
  readonly result = input.required<PdfImportResult>();
  readonly page = input<PageImage | null>(null);
  readonly hall = input<Hall | null>(null);
  readonly alignment = input<Alignment | null>(null);
  readonly groups = input<string[]>([]);
  readonly included = input<Record<string, boolean>>({});
  readonly selectedKey = input<string | null>(null);
  /** Stall keys with planner-rule violations (after a rule check). */
  readonly ruleIssues = input<ReadonlySet<string>>(new Set());
  readonly select = output<string>();

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly uid = `pdfv${nextId++}`;
  private readonly box = signal<Rect>({ minX: 0, maxX: 100, minZ: 0, maxZ: 100 });
  readonly viewBox = computed(() => {
    const b = this.box();
    return `${b.minX} ${b.minZ} ${b.maxX - b.minX} ${b.maxZ - b.minZ}`;
  });
  drag: { x: number; y: number; box: Rect; moved: boolean; unitsPerPx: number } | null = null;

  private readonly calibration = computed(() => new Map(this.result().groups.map(g => [g.group, g])));

  /** Stall outline in the current view's coordinates. */
  private readonly geometry = computed(() => {
    const align = this.alignment();
    const cal = this.calibration();
    const hallMode = this.mode() === 'hall';
    const groups = new Set(this.groups());
    return this.result()
      .stalls.filter(s => !hallMode || groups.has(s.group))
      .map(s => ({
        stall: s,
        points: hallMode && align ? placeOutline(s, align) : toPage(s.outline, cal.get(s.group)),
      }));
  });

  readonly shapes = computed<Shape[]>(() => {
    const included = this.included();
    const selected = this.selectedKey();
    const groups = new Set(this.groups());
    const rules = this.ruleIssues();
    const hallMode = this.mode() === 'hall';
    return this.geometry().map(({ stall, points }) => {
      const on = (included[stall.key] ?? stall.include) && groups.has(stall.group);
      return {
        key: stall.key,
        points: pts(points),
        open: stall.openEdges.map(i => {
          const a = points[i];
          const b = points[(i + 1) % points.length];
          return { x1: a.x, y1: a.z, x2: b.x, y2: b.z };
        }),
        stroke: CONFIDENCE_STROKE[stall.confidence],
        fill: hallMode ? CATEGORY_COLORS[stall.category] : 'transparent',
        included: on,
        selected: stall.key === selected,
        special: stall.shape !== 'rectangle',
        ruleIssue: hallMode && rules.has(stall.key),
      };
    });
  });

  readonly excluded = computed(() => this.result().excluded.map(e => pts(e.outlinePt)));

  readonly unresolvedMarks = computed(() => {
    const pitch = this.result().groups[0]?.pitchX ?? 5;
    return this.result().unresolved.map(u => ({ x: u.x, y: u.y, r: 2.2 * pitch }));
  });

  readonly floor = computed(() => {
    const hall = this.hall();
    if (!hall) return { rings: [], obstacles: [], zones: [] };
    const ctx = placementContextFor(hall, [], 'B2B');
    return {
      rings: [...(ctx.boundary ? [ctx.boundary] : []), ...(ctx.regions ?? [])].map(pts),
      obstacles: (ctx.obstacles ?? []).map(pts),
      zones: ctx.zones.filter(z => z.polygon?.length >= 3).map(z => pts(z.polygon)),
    };
  });

  /** Each drawing hall's piece of the page, moved the way its stalls are. */
  readonly underlays = computed(() => {
    const align = this.alignment();
    if (!align) return [];
    const cal = this.calibration();
    return this.groups().flatMap(g => {
      const c = cal.get(g);
      const o = align.offsets[g];
      if (!c || !o) return [];
      return [{
        group: g,
        clip: `${this.uid}-clip-${g}`,
        transform: `translate(${o.x} ${o.z}) rotate(${align.rotation}) scale(${1 / c.pitchX} ${1 / c.pitchY}) translate(${-c.originX} ${-c.originY})`,
      }];
    });
  });

  readonly clips = computed(() => {
    const cal = this.calibration();
    return this.groups().flatMap(g => {
      const c = cal.get(g);
      const stalls = this.result().stalls.filter(s => s.group === g);
      if (!c || !stalls.length) return [];
      const b = bounds(stalls.flatMap(s => s.outlinePt));
      const m = 3 * c.pitchX;
      return [{ id: `${this.uid}-clip-${g}`, rect: { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m } }];
    });
  });

  constructor() {
    // Frame the content when what is shown changes (mode, hall, file), not on every nudge.
    effect(() => {
      this.mode();
      this.hall();
      this.result();
      untracked(() => this.fitContent());
    });
    // Bring the selected stall into view if it is outside.
    effect(() => {
      const key = this.selectedKey();
      if (!key) return;
      const shape = untracked(() => this.geometry().find(g => g.stall.key === key));
      if (!shape) return;
      const b = bounds(shape.points);
      const v = untracked(() => this.box());
      if (b.minX < v.minX || b.maxX > v.maxX || b.minZ < v.minZ || b.maxZ > v.maxZ) {
        const w = v.maxX - v.minX;
        const h = v.maxZ - v.minZ;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        this.box.set({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - h / 2, maxZ: cz + h / 2 });
      }
    });
  }

  fitContent(): void {
    const all = this.geometry().filter(g => this.mode() === 'hall' || this.groups().includes(g.stall.group)).flatMap(g => g.points);
    const hall = this.hall();
    const extra: Point[] = [];
    if (this.mode() === 'hall' && hall) {
      const b = planBounds(hall);
      extra.push({ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.maxZ });
    }
    const pts2 = [...all, ...extra];
    if (!pts2.length) return this.fitPage();
    this.setBox(bounds(pts2), 0.04);
  }

  fitPage(): void {
    const p = this.result().page;
    this.setBox({ minX: 0, maxX: p.width, minZ: 0, maxZ: p.height }, 0);
  }

  zoom(factor: number, about?: Point): void {
    const b = this.box();
    const c = about ?? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    this.box.set({
      minX: c.x - (c.x - b.minX) * factor,
      maxX: c.x + (b.maxX - c.x) * factor,
      minZ: c.z - (c.z - b.minZ) * factor,
      maxZ: c.z + (b.maxZ - c.z) * factor,
    });
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoom(Math.exp(Math.max(-60, Math.min(60, event.deltaY)) * 0.004), this.toSvg(event));
  }

  onDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const ctm = this.svg().nativeElement.getScreenCTM();
    this.drag = { x: event.clientX, y: event.clientY, box: this.box(), moved: false, unitsPerPx: ctm ? 1 / ctm.a : 1 };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  onMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const u = d.unitsPerPx;
    this.box.set({ minX: d.box.minX - dx * u, maxX: d.box.maxX - dx * u, minZ: d.box.minZ - dy * u, maxZ: d.box.maxZ - dy * u });
  }

  onUp(event: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    // A click: the stall under the pointer (pointer capture retargets the event, so hit-test).
    const hit = document.elementFromPoint(event.clientX, event.clientY) as Element | null;
    const key = hit?.getAttribute('data-key');
    if (key) this.select.emit(key);
  }

  private setBox(b: Rect, pad: number): void {
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxZ - b.minZ, 1);
    this.box.set({ minX: b.minX - w * pad, maxX: b.maxX + w * pad, minZ: b.minZ - h * pad, maxZ: b.maxZ + h * pad });
  }

  private toSvg(event: MouseEvent): Point | undefined {
    const svg = this.svg().nativeElement;
    const ctm = svg.getScreenCTM();
    if (!ctm) return undefined;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y };
  }
}

function toPage(outline: Point[], cal: PdfGroup | undefined): Point[] {
  if (!cal) return outline;
  return outline.map(p => ({ x: cal.originX + p.x * cal.pitchX, z: cal.originY + p.z * cal.pitchY }));
}

function pts(points: ReadonlyArray<Point>): string {
  return points.map(p => `${round(p.x)},${round(p.z)}`).join(' ');
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
