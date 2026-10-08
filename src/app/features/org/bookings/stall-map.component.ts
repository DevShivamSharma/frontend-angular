import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { FloorArea, HallFloor } from '../../../core/api/api.models';
import {
  StallLook,
  stallLabel,
  stallLook,
  StallMapViewer,
} from '../../../core/bookings/booking-rules';
import type { MapStallView } from '../../../core/bookings/bookings.models';
import type { StallSide } from '../../../core/rules/rules.models';
import type { MultiPolygon } from '../../../core/venues/floor-plan.models';
import { AREA_COLORS } from '../../../shared/floor/floor-view.component';

let nextId = 0;

const LEGEND: Record<StallMapViewer, { look: StallLook; label: string }[]> = {
  staff: [
    { look: 'free', label: 'Free' },
    { look: 'held', label: 'Held' },
    { look: 'booked', label: 'Booked' },
  ],
  exhibitor: [
    { look: 'free', label: 'Free' },
    { look: 'own', label: 'Yours' },
    { look: 'taken', label: 'Taken' },
  ],
};

/**
 * A published hall plan of an event: the floor the event booked, to scale, and its stalls
 * coloured by whether they are free. A stall is picked by click or keyboard; the page decides
 * what picking it offers.
 */
@Component({
  selector: 'app-stall-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = floor();
    <svg
      [attr.viewBox]="viewBox()"
      preserveAspectRatio="xMidYMid meet"
      role="group"
      [attr.aria-label]="label()"
    >
      <defs>
        <pattern [attr.id]="gridId" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" class="grid-line" />
        </pattern>
      </defs>
      <rect
        [attr.x]="-2"
        [attr.y]="-2"
        [attr.width]="f.width + 4"
        [attr.height]="f.depth + 4"
        class="ground"
      />
      @if (f.geometry; as g) {
        <path [attr.d]="path(g.boundary)" class="floor" fill-rule="evenodd" />
        <path [attr.d]="path(g.boundary)" [attr.fill]="gridFill" fill-rule="evenodd" />
        @for (z of g.zones; track z.id) {
          <path [attr.d]="path(z.geometry)" class="foyer" fill-rule="evenodd">
            <title>{{ z.name }}</title>
          </path>
        }
        @for (o of g.objects; track o.id) {
          <path
            [attr.d]="path(o.geometry)"
            [attr.fill]="o.color || areaColor(o.kind)"
            class="object"
            fill-rule="evenodd"
          >
            <title>{{ o.label || o.kind }}</title>
          </path>
        }
      } @else {
        <rect [attr.width]="f.width" [attr.height]="f.depth" class="floor" />
        <rect [attr.width]="f.width" [attr.height]="f.depth" [attr.fill]="gridFill" />
        @for (a of f.areas; track $index) {
          <rect
            [attr.x]="a.x"
            [attr.y]="a.y"
            [attr.width]="a.width"
            [attr.height]="a.height"
            [attr.fill]="areaFill(a)"
            [attr.fill-opacity]="a.kind === 'outside' || a.kind === 'wall' ? 1 : 0.55"
            class="object"
          >
            <title>{{ a.label || a.kind }}</title>
          </rect>
        }
      }
      @for (s of stalls(); track s.id) {
        <g
          class="stall"
          [class]="look(s)"
          [class.selected]="s.id === selectedId()"
          role="button"
          tabindex="0"
          [attr.aria-label]="stallName(s)"
          [attr.aria-pressed]="s.id === selectedId()"
          (click)="picked.emit(s)"
          (keydown.enter)="picked.emit(s)"
          (keydown.space)="$event.preventDefault(); picked.emit(s)"
        >
          <title>{{ stallName(s) }}</title>
          <rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.width" [attr.height]="s.depth" />
          @for (side of s.openSides; track side) {
            <line
              [attr.x1]="edge(s, side)[0]"
              [attr.y1]="edge(s, side)[1]"
              [attr.x2]="edge(s, side)[2]"
              [attr.y2]="edge(s, side)[3]"
              class="open"
            />
          }
          <text
            [attr.x]="s.x + s.width / 2"
            [attr.y]="s.y + s.depth / 2"
            [attr.font-size]="fontSize(s)"
          >
            {{ s.number }}
          </text>
        </g>
      }
    </svg>
    <p class="muted small key">
      @for (k of legend(); track k.look) {
        <span class="k" [class]="k.look"></span> {{ k.label }}
      }
      <span class="hint">Open sides are drawn white.</span>
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 72vh;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .ground {
      fill: var(--mat-sys-surface-container);
    }
    .floor {
      fill: var(--mat-sys-surface-container-lowest);
      stroke: var(--mat-sys-outline);
      stroke-width: 0.1;
    }
    .grid-line {
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 0.03;
    }
    .foyer {
      fill: var(--mat-sys-tertiary-container);
      fill-opacity: 0.6;
    }
    .object {
      fill-opacity: 0.6;
      stroke: rgb(0 0 0 / 0.25);
      stroke-width: 0.05;
    }
    .stall {
      cursor: pointer;
      outline: none;
    }
    .stall rect {
      fill-opacity: 0.85;
      stroke: rgb(0 0 0 / 0.45);
      stroke-width: 0.08;
    }
    .free rect,
    .k.free {
      fill: #2e7d32;
      background: #2e7d32;
    }
    .held rect,
    .k.held {
      fill: #f9a825;
      background: #f9a825;
    }
    .booked rect,
    .k.booked {
      fill: #c62828;
      background: #c62828;
    }
    .own rect,
    .k.own {
      fill: #1e63c4;
      background: #1e63c4;
    }
    .taken rect,
    .k.taken {
      fill: #757575;
      background: #757575;
    }
    .stall:hover rect,
    .stall:focus-visible rect {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 0.15;
    }
    /* Dark on every stall colour, held (amber) included. */
    .stall.selected rect {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 0.3;
    }
    .stall .open {
      stroke: #fff;
      stroke-width: 0.25;
      pointer-events: none;
    }
    .stall text {
      fill: #fff;
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .stall.held text {
      fill: #212121;
    }
    .key {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin: 8px 0 0;
    }
    .k {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-left: 8px;
    }
    .hint {
      margin-left: 12px;
    }
  `,
})
export class StallMapComponent {
  readonly floor = input.required<HallFloor>();
  readonly stalls = input.required<MapStallView[]>();
  readonly selectedId = input<string | null>(null);
  readonly viewer = input<StallMapViewer>('staff');
  /** The map's accessible name, e.g. "Stalls of Hall 1". */
  readonly label = input('Stall map');
  readonly picked = output<MapStallView>();

  /** Pattern ids are document-wide: each map has its own. */
  protected readonly gridId = `stall-map-grid-${++nextId}`;
  protected readonly gridFill = `url(#${this.gridId})`;

  protected readonly legend = computed(() => LEGEND[this.viewer()]);
  protected readonly viewBox = computed(() => {
    const f = this.floor();
    return `-2 -2 ${f.width + 4} ${f.depth + 4}`;
  });

  protected look(s: MapStallView): string {
    return stallLook(s, this.viewer());
  }

  protected stallName(s: MapStallView): string {
    return stallLabel(s, this.viewer());
  }

  /** The number fits the stall: about a third of its shorter side, within reason. */
  protected fontSize(s: MapStallView): number {
    return Math.min(1.2, Math.max(0.35, Math.min(s.width, s.depth) / 3));
  }

  protected path(g: MultiPolygon): string {
    return g
      .flatMap((poly) => poly.map((ring) => `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`))
      .join(' ');
  }

  protected areaColor(kind: string): string {
    return (AREA_COLORS as Record<string, string>)[kind] ?? '#9e9e9e';
  }

  protected areaFill(a: FloorArea): string {
    return a.kind === 'outside' ? AREA_COLORS.outside : (a.color ?? AREA_COLORS[a.kind]);
  }

  /** The line of an open side: x1, y1, x2, y2. */
  protected edge(s: MapStallView, side: StallSide): [number, number, number, number] {
    switch (side) {
      case 'top':
        return [s.x, s.y, s.x + s.width, s.y];
      case 'bottom':
        return [s.x, s.y + s.depth, s.x + s.width, s.y + s.depth];
      case 'left':
        return [s.x, s.y, s.x, s.y + s.depth];
      case 'right':
        return [s.x + s.width, s.y, s.x + s.width, s.y + s.depth];
    }
  }
}
