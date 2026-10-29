import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { isOutside, isPillar, LayoutArea } from '../../domain/hall-layout';
import { HallNotes, NO_NOTES } from '../../domain/hall-notes';
import { LayoutNotesComponent, NoteMove, NoteRef } from '../layout-notes/layout-notes.component';

/** More cells than this and the metre grid is drawn every few metres, so it stays readable. */
const FINE_GRID_LIMIT = 6000;

/**
 * A hall's layout as SVG: its floor on a grid of metres, the walls and cut corners, and the
 * pillars. It only draws what it is given; when `editable`, a click says which cell was clicked and
 * the parent decides what that does.
 */
@Component({
  selector: 'app-layout-canvas',
  imports: [LayoutNotesComponent],
  templateUrl: './layout-canvas.component.html',
  styleUrl: './layout-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutCanvasComponent {
  readonly columns = input.required<number>();
  readonly rows = input.required<number>();
  readonly areas = input.required<readonly LayoutArea[]>();
  readonly editable = input(false);
  /** The size of the pillar a click would place; shown under the pointer. */
  readonly pillarSize = input(1);
  /** The wall line chosen to be moved (its place in the list of areas); drawn highlighted. */
  readonly selected = input<number | null>(null);
  readonly label = input('Layout of the hall');
  /** The helpers and text labels to draw, where they stand (in metres; they may be outside the grid). */
  readonly notes = input<HallNotes>(NO_NOTES);
  /** The helper or label chosen to be placed or moved: drawn with a ring round it. */
  readonly chosenNote = input<NoteRef | null>(null);
  /** Helpers and labels can be pressed, dragged and moved with the arrow keys. */
  readonly notesEditable = input(false);
  /** The next click puts the chosen note there, anywhere in the picture, outside the grid too. */
  readonly placing = input(false);

  readonly cellClicked = output<{ x: number; y: number }>();
  readonly pointClicked = output<{ x: number; y: number }>();
  readonly noteChosen = output<NoteRef>();
  readonly noteMoved = output<NoteMove>();

  protected readonly hover = signal<{ x: number; y: number } | null>(null);

  /** The drawing's extent: the grid, grown to hold the helpers and labels outside it. */
  private readonly bounds = computed(() => {
    const { helpers, labels } = this.notes();
    const points = [...helpers, ...labels];
    const pad = this.noteSize() * 3;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const left = Math.min(0, ...xs.map((x) => x - pad / 3));
    const top = Math.min(0, ...ys.map((y) => y - pad / 3));
    const right = Math.max(this.columns(), ...xs.map((x) => x + pad));
    const bottom = Math.max(this.rows(), ...ys.map((y) => y + pad));
    return { left, top, width: right - left, height: bottom - top };
  });
  protected readonly viewBox = computed(() => {
    const b = this.bounds();
    return `${b.left} ${b.top} ${b.width} ${b.height}`;
  });
  protected readonly ratio = computed(() => `${this.bounds().width} / ${this.bounds().height}`);
  /** Width over height, so the SVG can be no taller than the screen allows without being letterboxed. */
  protected readonly aspect = computed(() => this.bounds().width / this.bounds().height);
  /** A helper's icon, in metres: ITPO's own are 2 m, more on a very big hall so it stays readable. */
  protected readonly noteSize = computed(() =>
    Math.max(2, Math.max(this.columns(), this.rows()) / 24),
  );
  protected readonly gridStep = computed(() =>
    this.columns() * this.rows() <= FINE_GRID_LIMIT
      ? 1
      : this.columns() * this.rows() <= 60000
        ? 5
        : 10,
  );
  /** Outside the floor; and the coloured wall lines ITPO draws along the walls. */
  protected readonly outside = computed(() => this.areas().filter(isOutside));
  protected readonly lines = computed(() =>
    this.areas()
      .map((area, index) => ({ area, index }))
      .filter(({ area }) => !isPillar(area) && !isOutside(area)),
  );
  protected readonly selectedLine = computed(() => {
    const index = this.selected();
    return index === null ? null : (this.areas()[index] ?? null);
  });
  protected readonly pillars = computed(() => this.areas().filter(isPillar));

  protected onMove(event: MouseEvent): void {
    this.hover.set(this.cellAt(event));
  }

  protected onClick(event: MouseEvent): void {
    if (this.placing()) {
      const point = this.pointAt(event);
      if (point) this.pointClicked.emit(point);
      return;
    }
    const cell = this.cellAt(event);
    if (this.editable() && cell) {
      this.cellClicked.emit(cell);
    }
  }

  /** The point under the pointer, in metres from the grid's top-left, inside the grid or out. */
  private pointAt(event: MouseEvent): { x: number; y: number } | null {
    const svg = event.currentTarget as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  /** The cell under the pointer, found in the grid's own coordinates so it holds however the SVG is scaled. */
  private cellAt(event: MouseEvent): { x: number; y: number } | null {
    if (!this.editable()) return null;
    const svg = event.currentTarget as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < this.columns() && y < this.rows() ? { x, y } : null;
  }
}
