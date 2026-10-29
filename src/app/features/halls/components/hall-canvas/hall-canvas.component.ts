import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { HallNotes, NO_NOTES } from '../../domain/hall-notes';
import { Corner } from '../../domain/hall-shape.model';
import { extent, outlineArea } from '../../domain/outline-geometry';
import { LayoutNotesComponent, NoteMove, NoteRef } from '../layout-notes/layout-notes.component';

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
  imports: [LayoutNotesComponent],
  templateUrl: './hall-canvas.component.html',
  styleUrl: './hall-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallCanvasComponent {
  readonly ring = input<readonly Corner[] | null>(null);
  /** The corners being placed by hand (a custom hall), drawn as numbered markers. */
  readonly corners = input<readonly Corner[]>([]);
  readonly editable = input(false);

  /** The helpers and text labels to draw, where they stand in metres (they may lie outside the hall). */
  readonly notes = input<HallNotes>(NO_NOTES);
  /** The helper or label chosen to be placed or moved: drawn with a ring round it. */
  readonly chosenNote = input<NoteRef | null>(null);
  /** Helpers and labels can be pressed, dragged and moved with the arrow keys. */
  readonly notesEditable = input(false);
  /** The next click puts the chosen note there, anywhere in the picture. */
  readonly placing = input(false);

  readonly cornerAdded = output<Corner>();
  readonly pointClicked = output<{ x: number; y: number }>();
  readonly noteChosen = output<NoteRef>();
  readonly noteMoved = output<NoteMove>();

  protected readonly box = computed(() => {
    const ring = this.ring();
    const placed = this.corners();
    const points = ring && ring.length ? ring : placed;
    const { width, depth } = points.length ? extent(points) : { width: 0, depth: 0 };
    const minX = points.length ? Math.min(...points.map((p) => p[0])) : 0;
    const minY = points.length ? Math.min(...points.map((p) => p[1])) : 0;
    const w = this.editable() ? Math.max(width, MIN_WIDTH) : Math.max(width, 1);
    const d = this.editable() ? Math.max(depth, MIN_DEPTH) : Math.max(depth, 1);
    let left = Math.min(minX, 0) - MARGIN;
    let top = Math.min(minY, 0) - MARGIN;
    let right = left + w + 2 * MARGIN + Math.max(minX, 0);
    let bottom = top + d + 2 * MARGIN + Math.max(minY, 0);
    // The helpers and labels outside the hall (a sign beside a wall) are in the picture too.
    const { helpers, labels } = this.notes();
    const reach = this.noteSize() * 3;
    for (const { x, y } of [...helpers, ...labels]) {
      left = Math.min(left, x - MARGIN);
      top = Math.min(top, y - MARGIN);
      right = Math.max(right, x + reach);
      bottom = Math.max(bottom, y + reach);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
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

  /** A helper's icon, in metres: ITPO's own are 2 m, more on a very big hall so it stays readable. */
  protected readonly noteSize = computed(() => Math.max(2, Math.max(width(this.ring()), 0) / 24));

  protected readonly markerRadius = computed(() => Math.max(this.box().w, this.box().h) / 90);
  protected readonly fontSize = computed(() => Math.max(this.box().w, this.box().h) / 38);

  protected place(event: MouseEvent): void {
    // Putting a helper comes before adding a corner: they are never wanted on one canvas at once.
    if (!this.editable() && !this.placing()) {
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
    if (this.placing()) {
      this.pointClicked.emit({ x: world.x, y: world.y });
    } else {
      this.cornerAdded.emit([Math.round(world.x), Math.round(world.y)]);
    }
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

/** The width of an outline's box; 0 when there is none. */
function width(ring: readonly Corner[] | null): number {
  return ring && ring.length ? extent(ring).width : 0;
}
