import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { FloorArea, HallFloor } from '../../../core/api/api.models';
import { STALL_STATE_LABELS, stallTitle } from '../../../core/bookings/booking-rules';
import type { MapStallView, StallState } from '../../../core/bookings/bookings.models';
import type { StallSide } from '../../../core/plans/plans.models';
import type { MultiPolygon } from '../../../core/venues/floor-plan.models';
import { AREA_COLORS } from '../../../shared/floor/floor-view.component';

let nextId = 0;

const LEGEND: StallState[] = ['free', 'held', 'booked', 'not_for_sale'];

/**
 * A hall's published stalls on the floor the event is drawn on, to scale, coloured by whether
 * they are free. A stall is picked by click or keyboard; the page decides what picking offers.
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
          [class]="s.state"
          [class.selected]="s.id === selectedId()"
          role="button"
          tabindex="0"
          [attr.aria-label]="title(s)"
          [attr.aria-pressed]="s.id === selectedId()"
          (click)="picked.emit(s)"
          (keydown.enter)="picked.emit(s)"
          (keydown.space)="$event.preventDefault(); picked.emit(s)"
        >
          <title>{{ title(s) }}</title>
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
            {{ s.stallNumber }}
          </text>
        </g>
      }
    </svg>
    <p class="muted small key">
      @for (k of legend; track k) {
        <span class="item"><span class="k" [class]="k"></span>{{ stateLabels[k] }}</span>
      }
      <span class="item"><span class="k open-key"></span>Dashed edges are open sides</span>
    </p>
  `,
  styles: `
    /*
     * Stall looks from theme tokens only, so light, dark and organisation themes all work. Each
     * sets a fill, a text colour on that fill, and an edge; the legend swatches read the same.
     */
    :host {
      display: block;
      /* AREA_COLORS.outside reads this, as on the venue floor view. */
      --floor-outside: var(--app-surface-container);
    }
    .free {
      --stall-fill: var(--app-primary-container);
      --stall-ink: var(--app-on-primary-container);
      --stall-edge: var(--app-primary);
    }
    .held {
      --stall-fill: var(--app-tertiary-container);
      --stall-ink: var(--app-on-tertiary-container);
      --stall-edge: var(--app-tertiary);
    }
    .booked {
      --stall-fill: var(--app-error-container);
      --stall-ink: var(--app-on-error-container);
      --stall-edge: var(--app-error);
    }
    .not_for_sale {
      --stall-fill: var(--app-surface-container-highest);
      --stall-ink: var(--app-on-surface-variant);
      --stall-edge: var(--app-outline);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 72vh;
    }
    .small {
      font: var(--app-body-small);
    }
    .ground {
      fill: var(--app-surface-container);
    }
    .floor {
      fill: var(--app-surface-container-lowest);
      stroke: var(--app-outline);
      stroke-width: 0.1;
    }
    .grid-line {
      stroke: var(--app-outline-variant);
      stroke-width: 0.03;
    }
    .foyer {
      fill: var(--app-tertiary-container);
      fill-opacity: 0.6;
    }
    .object {
      fill-opacity: 0.6;
      stroke: var(--app-outline);
      stroke-opacity: 0.5;
      stroke-width: 0.05;
    }
    .stall {
      cursor: pointer;
      outline: none;
    }
    .stall rect {
      fill: var(--stall-fill);
      stroke: var(--stall-edge);
      stroke-width: 0.08;
    }
    .stall:hover rect,
    .stall:focus-visible rect {
      stroke: var(--app-on-surface);
      stroke-width: 0.2;
    }
    .stall.selected rect {
      stroke: var(--app-on-surface);
      stroke-width: 0.3;
    }
    .stall .open {
      stroke: var(--stall-ink);
      stroke-width: 0.2;
      stroke-dasharray: 0.4 0.25;
      pointer-events: none;
    }
    .stall text {
      fill: var(--stall-ink);
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .key {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      margin: 12px 0 0;
    }
    .item {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .k {
      display: inline-block;
      width: 12px;
      height: 12px;
      box-sizing: border-box;
      border-radius: 3px;
      border: 1px solid var(--stall-edge);
      background: var(--stall-fill);
    }
    .k.open-key {
      border: none;
      border-radius: 0;
      height: 0;
      border-top: 2px dashed var(--app-on-surface-variant);
    }
  `,
})
export class StallMapComponent {
  readonly floor = input.required<HallFloor>();
  readonly stalls = input.required<MapStallView[]>();
  readonly selectedId = input<string | null>(null);
  /** The map's accessible name, e.g. "Stalls of Hall 5". */
  readonly label = input('Stall map');
  readonly picked = output<MapStallView>();

  /** Pattern ids are document-wide: each map has its own. */
  protected readonly gridId = `stall-map-grid-${++nextId}`;
  protected readonly gridFill = `url(#${this.gridId})`;
  protected readonly legend = LEGEND;
  protected readonly stateLabels = STALL_STATE_LABELS;
  protected readonly viewBox = computed(() => {
    const f = this.floor();
    return `-2 -2 ${f.width + 4} ${f.depth + 4}`;
  });

  protected title(s: MapStallView): string {
    return stallTitle(s);
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
    return (AREA_COLORS as Record<string, string>)[kind] ?? 'var(--app-outline)';
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
