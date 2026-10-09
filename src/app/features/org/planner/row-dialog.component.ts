import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';

import type { Point } from '../../../core/venues/floor-plan.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import { Rect, snap } from './planner-geometry';

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
  template: `
    <h2 class="dialog-title head"><app-icon name="rows" /> Booths in a row</h2>
    <div class="dialog-content stack">
      <div class="pair">
        <label
          >Booths
          <p-inputnumber
            [ngModel]="count()"
            (ngModelChange)="count.set($event ?? 1)"
            [min]="1"
            [max]="200"
            [showButtons]="true"
          />
        </label>
        <label
          >Gap between booths (m)
          <p-inputnumber
            [ngModel]="gap()"
            (ngModelChange)="gap.set($event ?? 0)"
            [min]="0"
            [max]="20"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Booth width (m)
          <p-inputnumber
            [ngModel]="width()"
            (ngModelChange)="width.set($event ?? 3)"
            [min]="0.5"
            [max]="100"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Booth depth (m)
          <p-inputnumber
            [ngModel]="depth()"
            (ngModelChange)="depth.set($event ?? 3)"
            [min]="0.5"
            [max]="100"
            [maxFractionDigits]="2"
          />
        </label>
      </div>
      <p class="summary">
        <b>{{ count() | number }}</b> booths · {{ length() | number: '1.0-1' }} ×
        {{ depth() | number: '1.0-1' }} m <br /><span class="muted"
          >Placed in the middle of the view — drag it where it goes.</span
        >
      </p>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="add()">Add {{ count() | number }} booths</button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .stack {
      display: grid;
      gap: 14px;
      min-width: min(380px, 84vw);
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 12px;
    }
    label {
      display: grid;
      gap: 4px;
      font: var(--app-label-medium);
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input {
      width: 100%;
    }
    .summary {
      margin: 0;
      text-align: center;
      font-size: 13px;
    }
  `,
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
