import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';

import type { Point } from '../../domain/floor-plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { Rect, snap } from '../../domain/planner-geometry';

export interface RowData {
  /** Where the row's middle goes, floor metres. */
  at: Point;
  snapStep: number;
}

/** Adds booths side by side in one row. Closes with their boxes; the page checks the rules. */
@Component({
  selector: 'app-row-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, InputNumberModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './row-dialog.component.html',
  styleUrl: './row-dialog.component.scss',
})
export class RowDialogComponent {
  protected readonly data = dialogData<RowData>();
  protected readonly ref = inject(DialogRef);

  protected readonly count = signal(5);
  protected readonly width = signal(3);
  protected readonly depth = signal(3);
  protected readonly gap = signal(0);

  protected readonly length = computed(
    () => this.count() * this.width() + Math.max(0, this.count() - 1) * this.gap(),
  );

  protected add(): void {
    const step = this.data.snapStep;
    const x = snap(this.data.at[0] - this.length() / 2, step);
    const y = snap(this.data.at[1] - this.depth() / 2, step);
    const boxes: Rect[] = Array.from({ length: this.count() }, (_, i) => ({
      x: x + i * (this.width() + this.gap()),
      y,
      width: this.width(),
      height: this.depth(),
    }));
    this.ref.close(boxes);
  }
}
