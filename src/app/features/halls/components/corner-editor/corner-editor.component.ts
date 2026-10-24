import { ChangeDetectionStrategy, Component, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';

import { Corner } from '../../domain/hall-shape.model';
import { MAX_CORNERS, MAX_SIDE, parseCorners } from '../../domain/outline-geometry';

/** The corners of a custom outline as a list: change a corner, remove it, add one, or paste a list. */
@Component({
  selector: 'app-corner-editor',
  imports: [FormsModule, ButtonModule, InputNumberModule, TextareaModule],
  templateUrl: './corner-editor.component.html',
  styleUrl: './corner-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CornerEditorComponent {
  /** The corners; the parent and this editor share them. */
  readonly corners = model.required<Corner[]>();

  protected readonly pasting = signal(false);
  protected readonly pasteText = signal('');
  protected readonly pasteError = signal<string | null>(null);

  protected readonly limit = MAX_SIDE;
  protected readonly maxCorners = MAX_CORNERS;

  protected change(index: number, axis: 0 | 1, value: number | null): void {
    this.corners.update((corners) =>
      corners.map((corner, i): Corner =>
        i === index ? (axis === 0 ? [value ?? 0, corner[1]] : [corner[0], value ?? 0]) : corner,
      ),
    );
  }

  protected add(): void {
    this.corners.update((corners) => [
      ...corners,
      corners.length ? ([...corners[corners.length - 1]] as Corner) : [0, 0],
    ]);
  }

  protected remove(index: number): void {
    this.corners.update((corners) => corners.filter((_, i) => i !== index));
  }

  protected clear(): void {
    this.corners.set([]);
  }

  protected applyPaste(): void {
    const parsed = parseCorners(this.pasteText());
    if (!parsed) {
      this.pasteError.set(
        'Each corner is two numbers, like "40, 30". Separate corners with new lines or semicolons.',
      );
      return;
    }
    this.corners.set(parsed);
    this.pasteError.set(null);
    this.pasting.set(false);
  }
}
