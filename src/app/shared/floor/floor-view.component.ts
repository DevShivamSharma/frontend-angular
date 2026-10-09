import { ThreePlanComponent } from './three-plan.component';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { FloorArea, FloorAreaKind, HallFloor } from '../../core/api/api.models';
import type { MultiPolygon, Point } from '../../core/venues/floor-plan.models';

/** How each kind of area looks when the venue gave it no colour: ITPO's own palette. */
export const AREA_COLORS: Record<FloorAreaKind, string> = {
  outside: 'var(--floor-outside)',
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

export const AREA_LABELS: Record<FloorAreaKind, string> = {
  outside: 'Outside the hall',
  wall: 'Wall',
  column: 'Column',
  passage: 'Passage',
  fire_curtain: 'Fire curtain',
  no_build: 'No construction',
  utility: 'Utility',
  entry: 'Entry / exit',
  unavailable: 'Not available',
  marking: 'Marking',
  void: 'Void / opening',
  facility: 'Facility',
};

/** Square metres of polygons: each outer ring less its holes (shoelace formula). */
export function geometryArea(g: MultiPolygon): number {
  const ring = (r: Point[]) =>
    Math.abs(
      r.reduce(
        (sum, p, i) => sum + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1],
        0,
      ),
    ) / 2;
  return g.reduce(
    (sum, [outer, ...holes]) => sum + ring(outer) - holes.reduce((h, r) => h + ring(r), 0),
    0,
  );
}

/** Extra room around the hall so labels placed just outside it stay in view (metres). */
const MARGIN = 4;

/**
 * A hall's empty floor, to scale. The 1 m grid shows only where stalls can go: every area is
 * painted over it, outside and walls in solid colour, the rest translucent.
 */
@Component({
  selector: 'app-floor-view',
  imports: [ThreePlanComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = floor();
    @if (f.geometry; as geometry) {
      <app-three-plan [floor]="geometry" [floorInfo]="showLabels() ? f : null" [editable]="false" />
    } @else {
      <svg
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        [attr.aria-label]="'Floor plan, ' + f.width + ' by ' + f.depth + ' metres'"
      >
        <defs>
          <pattern id="floor-grid-1m" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" class="grid-line" />
          </pattern>
          <pattern id="floor-grid-10m" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" class="grid-line-major" />
          </pattern>
        </defs>
        <rect [attr.width]="f.width" [attr.height]="f.depth" class="floor" />
        <rect [attr.width]="f.width" [attr.height]="f.depth" fill="url(#floor-grid-1m)" />
        <rect [attr.width]="f.width" [attr.height]="f.depth" fill="url(#floor-grid-10m)" />
        @for (area of shownAreas(); track $index) {
          <rect
            [attr.x]="area.x"
            [attr.y]="area.y"
            [attr.width]="area.width"
            [attr.height]="area.height"
            [attr.fill]="fill(area)"
            [attr.fill-opacity]="opacity(area)"
            [class.dashed]="area.hidden"
            class="area"
          >
            <title>{{ area.label || kindLabel(area.kind) }}</title>
          </rect>
        }
        <rect [attr.width]="f.width" [attr.height]="f.depth" class="outline" />
        @if (showLabels()) {
          @for (label of f.labels; track $index) {
            <text [attr.x]="label.x" [attr.y]="label.y" class="label">{{ label.text }}</text>
          }
          @for (group of f.iconGroups; track $index) {
            <g [attr.transform]="'translate(' + group.x + ' ' + group.y + ')'">
              <circle r="0.9" class="icon-dot" />
              <title>{{ iconTitle(group.icons) }}</title>
            </g>
          }
        }
      </svg>
    }
  `,
  styles: `
    :host {
      display: block;
      --floor-outside: var(--mat-sys-surface-container);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 75vh;
    }
    .floor {
      fill: var(--mat-sys-surface-container-lowest);
    }
    .grid-line {
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 0.04;
    }
    .grid-line-major {
      stroke: var(--mat-sys-outline);
      stroke-width: 0.08;
      opacity: 0.6;
    }
    .area {
      stroke: rgb(0 0 0 / 0.25);
      stroke-width: 0.05;
    }
    .area.dashed {
      stroke-dasharray: 0.4 0.3;
    }
    .outline {
      fill: none;
      stroke: var(--mat-sys-outline);
      stroke-width: 0.12;
    }
    .label {
      font-size: 1.4px;
      font-family: var(--mat-sys-label-medium-font, sans-serif);
      fill: var(--mat-sys-on-surface);
      dominant-baseline: hanging;
    }
    .icon-dot {
      fill: var(--mat-sys-tertiary);
    }
  `,
})
export class FloorViewComponent {
  readonly floor = input.required<HallFloor>();
  readonly showLabels = input(true);

  /** Outside first, so walls and the rest draw on top of it. */
  protected readonly shownAreas = computed(() =>
    [...this.floor().areas].sort((a, b) => order(a.kind) - order(b.kind)),
  );

  protected readonly viewBox = computed(() => {
    const f = this.floor();
    let minX = 0;
    let minY = 0;
    let maxX = f.width;
    let maxY = f.depth;
    for (const p of [...f.labels, ...f.iconGroups]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // Labels far outside the hall would shrink the plan to nothing: keep them near.
    minX = Math.max(minX, -MARGIN * 2) - MARGIN;
    minY = Math.max(minY, -MARGIN * 2) - MARGIN;
    maxX = Math.min(maxX, f.width + MARGIN * 2) + MARGIN;
    maxY = Math.min(maxY, f.depth + MARGIN * 2) + MARGIN;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  });

  protected fill(area: FloorArea): string {
    if (area.kind === 'outside') return AREA_COLORS.outside;
    return area.color ?? AREA_COLORS[area.kind];
  }

  protected opacity(area: FloorArea): number {
    if (area.kind === 'outside' || area.kind === 'wall') return 1;
    return area.hidden ? 0.25 : 0.55;
  }

  protected kindLabel(kind: FloorAreaKind): string {
    return AREA_LABELS[kind];
  }

  protected iconTitle(icons: { kind: string; label: string }[]): string {
    return icons.map((i) => i.label || i.kind).join(', ');
  }
}

function order(kind: FloorAreaKind): number {
  return kind === 'outside' ? 0 : kind === 'wall' ? 2 : 1;
}
