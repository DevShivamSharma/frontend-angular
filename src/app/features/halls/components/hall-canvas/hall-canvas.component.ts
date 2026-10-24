import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Corner } from '../../domain/hall-shape.model';
import { extent, outlineArea } from '../../domain/outline-geometry';

/** The grid never covers less than this, so an empty custom hall still has room to click in. */
const MIN_WIDTH = 60;
const MIN_DEPTH = 40;
const MARGIN = 6;

/**
 * The hall's outline on a metre grid, drawn as SVG. It only draws what it is given; when
 * `editable`, a click on the grid says where (to the nearest metre) and the parent adds the corner.
 */
@Component({
  selector: 'app-hall-canvas',
  templateUrl: './hall-canvas.component.html',
  styleUrl: './hall-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallCanvasComponent {
  readonly ring = input<readonly Corner[] | null>(null);
  /** The corners being placed by hand (a custom hall), drawn as numbered markers. */
  readonly corners = input<readonly Corner[]>([]);
  readonly editable = input(false);

  readonly cornerAdded = output<Corner>();

  protected readonly box = computed(() => {
    const ring = this.ring();
    const placed = this.corners();
    const points = ring && ring.length ? ring : placed;
    const { width, depth } = points.length ? extent(points) : { width: 0, depth: 0 };
    const minX = points.length ? Math.min(...points.map((p) => p[0])) : 0;
    const minY = points.length ? Math.min(...points.map((p) => p[1])) : 0;
    const w = this.editable() ? Math.max(width, MIN_WIDTH) : Math.max(width, 1);
    const d = this.editable() ? Math.max(depth, MIN_DEPTH) : Math.max(depth, 1);
    return {
      x: Math.min(minX, 0) - MARGIN,
      y: Math.min(minY, 0) - MARGIN,
      w: w + 2 * MARGIN + Math.max(minX, 0),
      h: d + 2 * MARGIN + Math.max(minY, 0),
    };
  });

  protected readonly viewBox = computed(() => {
    const { x, y, w, h } = this.box();
    return `${x} ${y} ${w} ${h}`;
  });

  /** The metres between grid lines, chosen so there are never too many. */
  protected readonly gridStep = computed(() => {
    const longest = Math.max(this.box().w, this.box().h);
    return [1, 5, 10, 25, 50, 100, 250, 500].find((step) => longest / step <= 40) ?? 500;
  });

  protected readonly verticalLines = computed(() =>
    lines(this.box().x, this.box().w, this.gridStep()),
  );
  protected readonly horizontalLines = computed(() =>
    lines(this.box().y, this.box().h, this.gridStep()),
  );

  protected readonly points = computed(
    () =>
      this.ring()
        ?.map(([x, y]) => `${x},${y}`)
        .join(' ') ?? '',
  );

  protected readonly size = computed(() => {
    const ring = this.ring();
    return ring && ring.length >= 3
      ? { ...extent(ring), floor: Math.round(outlineArea(ring) * 100) / 100 }
      : null;
  });

  protected readonly label = computed(() => {
    const size = this.size();
    return size
      ? `Hall outline, ${size.width} by ${size.depth} metres, ${size.floor} square metres of floor`
      : this.editable()
        ? 'Hall grid: click to place the corners of the outline'
        : 'Hall outline preview';
  });

  protected readonly markerRadius = computed(() => Math.max(this.box().w, this.box().h) / 90);
  protected readonly fontSize = computed(() => Math.max(this.box().w, this.box().h) / 38);

  protected place(event: MouseEvent): void {
    if (!this.editable()) {
      return;
    }
    const svg = event.currentTarget as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const world = point.matrixTransform(matrix.inverse());
    this.cornerAdded.emit([Math.round(world.x), Math.round(world.y)]);
  }
}

/** The multiples of `step` inside [start, start + length]. */
function lines(start: number, length: number, step: number): number[] {
  const first = Math.ceil(start / step) * step;
  const out: number[] = [];
  for (let value = first; value <= start + length; value += step) {
    out.push(value);
  }
  return out;
}
