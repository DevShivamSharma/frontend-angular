import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { openSidesLabel } from './gate-sides';
import { IconComponent } from './icon.component';
import { PlannerStore } from '../planner-store.service';

/** List order. Number is the stored identity, so it is the default. */
export type ShopSort = 'number' | 'name' | 'size';

/**
 * "Shops in Hall" section with the snap toggle. App.js:592.
 *
 * The search box and the sort only change what is listed and in what order; neither touches
 * the store, so the 3D view always shows every stall.
 */
@Component({
  selector: 'app-shops-list',
  templateUrl: './shops-list.component.html',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShopsListComponent {
  private readonly store = inject(PlannerStore);

  readonly currentStalls = this.store.currentStalls;
  readonly selectedStallId = this.store.selectedStallId;
  readonly snap = this.store.snap;

  readonly openSidesLabel = openSidesLabel;

  readonly query = signal('');
  readonly sort = signal<ShopSort>('number');

  readonly visibleStalls = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sort = this.sort();
    const stalls = q
      ? this.currentStalls().filter(
          s => (s.stallNumber ?? 'new').toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
        )
      : this.currentStalls();

    if (sort === 'number') return stalls;

    // A copy: `currentStalls` is derived state and sorting in place would reorder the store's.
    return [...stalls].sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : b.width * b.length - a.width * a.length
    );
  });

  isSelected(id: string | number): boolean {
    return String(this.selectedStallId()) === String(id);
  }

  select(id: string | number): void {
    this.store.selectStall(id);
  }

  duplicate(id: string | number): void {
    this.store.duplicateStall(id);
  }

  rotate(id: string | number): void {
    this.store.rotateStall(id);
  }

  remove(id: string | number): void {
    this.store.cancelStall(id);
  }

  setSort(value: string): void {
    this.sort.set(value === 'name' || value === 'size' ? value : 'number');
  }

  onSnapChange(checked: boolean): void {
    this.store.setSnap(checked);
  }
}
