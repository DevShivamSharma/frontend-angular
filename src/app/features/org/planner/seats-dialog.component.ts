import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';

import type { PlanSeat } from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import {
  blockSize,
  centre,
  letters,
  newId,
  nextRow,
  SeatBlock,
  seatBlock,
  snap,
  zoneAt,
} from './planner-geometry';
import type { PlannerStore } from './planner.store';

export interface SeatsData {
  store: PlannerStore;
  /** Where the block's middle goes, floor metres. */
  at: Point;
  snapStep: number;
}

/** Rows offered as the first: A to Z, after the rows already used. */
export function rowOptions(from: number): Array<{ label: string; value: number }> {
  return Array.from({ length: 26 }, (_, i) => ({ label: letters(from + i), value: from + i }));
}

/** Adds a block of seats in rows. Closes with the seats; the page checks the rules. */
@Component({
  selector: 'app-seats-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, InputNumberModule, SelectModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title head"><app-icon name="event_seat" /> Add seats</h2>
    <div class="dialog-content stack">
      <div class="pair">
        <label
          >Rows
          <p-inputnumber
            [ngModel]="rows()"
            (ngModelChange)="rows.set($event ?? 1)"
            [min]="1"
            [max]="200"
            [showButtons]="true"
          />
        </label>
        <label
          >Seats in a row
          <p-inputnumber
            [ngModel]="perRow()"
            (ngModelChange)="perRow.set($event ?? 1)"
            [min]="1"
            [max]="500"
          />
        </label>
        <label
          >Seat width (m)
          <p-inputnumber
            [ngModel]="width()"
            (ngModelChange)="width.set($event ?? 0.5)"
            [min]="0.2"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Seat depth (m)
          <p-inputnumber
            [ngModel]="depth()"
            (ngModelChange)="depth.set($event ?? 0.5)"
            [min]="0.2"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Gap between seats (m)
          <p-inputnumber
            [ngModel]="gap()"
            (ngModelChange)="gap.set($event ?? 0)"
            [min]="0"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Gap between rows (m)
          <p-inputnumber
            [ngModel]="rowGap()"
            (ngModelChange)="rowGap.set($event ?? 0)"
            [min]="0"
            [max]="10"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >First row
          <p-select
            [options]="firstRows"
            optionLabel="label"
            optionValue="value"
            [ngModel]="firstRow()"
            (ngModelChange)="firstRow.set($event)"
            appendTo="body"
          />
        </label>
        <label
          >Category
          <p-select
            [options]="categories()"
            optionLabel="name"
            optionValue="id"
            [ngModel]="categoryId()"
            (ngModelChange)="categoryId.set($event)"
            [showClear]="true"
            placeholder="None"
            appendTo="body"
          />
        </label>
      </div>
      <div class="preview" aria-hidden="true">
        <div class="seats" [style.grid-template-columns]="'repeat(' + shownPerRow() + ', 14px)'">
          @for (i of shownCells(); track i) {
            <span></span>
          }
        </div>
      </div>
      <p class="summary">
        <b>{{ count() | number }}</b> seats, {{ firstLabel() }} to {{ lastLabel() }} ·
        {{ size().width | number: '1.0-1' }} × {{ size().depth | number: '1.0-1' }} m <br /><span
          class="muted"
          >Placed in the middle of the view — drag it where it goes.</span
        >
      </p>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" class="seat-btn" (click)="add()">
        Add {{ count() | number }} seats
      </button>
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
    :host ::ng-deep .p-inputnumber-input,
    :host ::ng-deep .p-select {
      width: 100%;
    }
    .preview {
      display: grid;
      place-items: center;
      padding: 12px;
      border-radius: 10px;
      background: var(--app-surface-container-low);
      max-height: 160px;
      overflow: hidden;
    }
    .seats {
      display: grid;
      gap: 3px;
    }
    .seats span {
      width: 14px;
      height: 14px;
      border-radius: 2px;
      background: #f3e8ff;
      border: 1px solid #c084fc;
    }
    .summary {
      margin: 0;
      text-align: center;
      font-size: 13px;
    }
    .seat-btn {
      --p-button-primary-background: #9333ea;
      --p-button-primary-border-color: #9333ea;
      --p-button-primary-hover-background: #7e22ce;
      --p-button-primary-hover-border-color: #7e22ce;
    }
  `,
})
export class SeatsDialogComponent {
  protected readonly data = dialogData<SeatsData>();
  protected readonly ref = inject(DialogRef);
  private readonly store = this.data.store;

  private readonly after = nextRow(this.store.plan().seats);
  protected readonly firstRows = rowOptions(this.after);
  protected readonly categories = computed(() =>
    this.store.categories().filter((c) => c.status === 'active'),
  );

  protected readonly rows = signal(3);
  protected readonly perRow = signal(10);
  protected readonly width = signal(0.5);
  protected readonly depth = signal(0.5);
  protected readonly gap = signal(0.1);
  protected readonly rowGap = signal(0.9);
  protected readonly firstRow = signal(this.after);
  protected readonly categoryId = signal<string | null>(null);

  private readonly block = computed<SeatBlock>(() => ({
    rows: this.rows(),
    perRow: this.perRow(),
    width: this.width(),
    depth: this.depth(),
    gap: this.gap(),
    rowGap: this.rowGap(),
  }));
  protected readonly size = computed(() => blockSize(this.block()));
  protected readonly count = computed(() => this.rows() * this.perRow());
  protected readonly firstLabel = computed(() => `${letters(this.firstRow())}-1`);
  protected readonly lastLabel = computed(
    () => `${letters(this.firstRow() + this.rows() - 1)}-${this.perRow()}`,
  );
  protected readonly shownPerRow = computed(() => Math.min(this.perRow(), 20));
  protected readonly shownCells = computed(() =>
    Array.from({ length: Math.min(this.rows(), 8) * this.shownPerRow() }, (_, i) => i),
  );

  protected add(): void {
    const size = this.size();
    const step = this.data.snapStep;
    const x = snap(this.data.at[0] - size.width / 2, step);
    const y = snap(this.data.at[1] - size.depth / 2, step);
    const zones = this.store.plan().zones;
    const seats: PlanSeat[] = seatBlock(this.block(), x, y).map((r) => ({
      id: newId(),
      zoneId: zoneAt(centre(r), zones)?.id ?? null,
      rowLabel: letters(this.firstRow() + r.row),
      seatNumber: r.seat,
      x: r.x,
      y: r.y,
      width: r.width,
      depth: r.height,
      categoryId: this.categoryId(),
    }));
    this.ref.close(seats);
  }
}
