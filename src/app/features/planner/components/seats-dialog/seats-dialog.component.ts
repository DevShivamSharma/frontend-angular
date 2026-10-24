import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';

import type { PlanSeat } from '../../domain/plan.models';
import type { Point } from '../../domain/floor-plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
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
} from '../../domain/planner-geometry';
import type { PlannerStore } from '../../state/planner.store';

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
  templateUrl: './seats-dialog.component.html',
  styleUrl: './seats-dialog.component.scss',
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
