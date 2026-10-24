import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { HallShapeDefinition } from '../../domain/hall-shape.model';
import { defaultParams, outlineOf } from '../../domain/hall-shapes';
import { extent } from '../../domain/outline-geometry';

interface ShapeThumbnail {
  id: string;
  label: string;
  example: string;
  /** The SVG points of the shape's default outline, scaled to the thumbnail; null for a custom shape. */
  points: string | null;
}

const THUMB_W = 56;
const THUMB_H = 40;
const THUMB_PAD = 4;

/** The kinds of hall as tiles, each drawn as its own outline; one can be chosen. */
@Component({
  selector: 'app-shape-picker',
  templateUrl: './shape-picker.component.html',
  styleUrl: './shape-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShapePickerComponent {
  readonly shapes = input.required<readonly HallShapeDefinition[]>();
  readonly selectedId = input.required<string>();
  readonly selected = output<string>();

  protected readonly thumbnails = computed<ShapeThumbnail[]>(() =>
    this.shapes().map((shape) => ({
      id: shape.id,
      label: shape.label,
      example: shape.example,
      points: shape.params.length === 0 ? null : thumbnailPoints(shape.id),
    })),
  );

  protected readonly thumbWidth = THUMB_W;
  protected readonly thumbHeight = THUMB_H;
}

/** A shape's default outline fitted into the thumbnail, keeping its proportions. */
function thumbnailPoints(id: string): string | null {
  const { ring } = outlineOf(id, defaultParams(id));
  if (!ring) return null;
  const { width, depth } = extent(ring);
  const scale = Math.min((THUMB_W - 2 * THUMB_PAD) / width, (THUMB_H - 2 * THUMB_PAD) / depth);
  const offsetX = (THUMB_W - width * scale) / 2;
  const offsetY = (THUMB_H - depth * scale) / 2;
  return ring
    .map(([x, y]) => `${(offsetX + x * scale).toFixed(1)},${(offsetY + y * scale).toFixed(1)}`)
    .join(' ');
}
