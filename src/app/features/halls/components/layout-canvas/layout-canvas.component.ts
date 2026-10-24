import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { isOutside, isPillar, LayoutArea } from '../../domain/hall-layout';

/** More cells than this and the metre grid is drawn every few metres, so it stays readable. */
const FINE_GRID_LIMIT = 6000;

/**
 * A hall's layout as SVG: its floor on a grid of metres, the walls and cut corners, and the
 * pillars. It only draws what it is given; when `editable`, a click says which cell was clicked and
 * the parent decides what that does.
 */
@Component({
  selector: 'app-layout-canvas',
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

  readonly cellClicked = output<{ x: number; y: number }>();

  protected readonly hover = signal<{ x: number; y: number } | null>(null);

  protected readonly viewBox = computed(() => `0 0 ${this.columns()} ${this.rows()}`);
  protected readonly ratio = computed(() => `${this.columns()} / ${this.rows()}`);
  /** Width over height, so the SVG can be no taller than the screen allows without being letterboxed. */
  protected readonly aspect = computed(() => this.columns() / this.rows());
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
    const cell = this.cellAt(event);
    if (this.editable() && cell) {
      this.cellClicked.emit(cell);
    }
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
