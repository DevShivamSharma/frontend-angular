import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { openSidesLabel } from './gate-sides';
import { IconComponent } from './icon.component';
import { PlannerStore } from '../planner-store.service';

/**
 * "Shops in Hall" section with the snap toggle. App.js:592.
 *
 * The search box only filters what is listed (by stall number or name); it never changes the
 * store, so the 3D view always shows every stall.
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

  readonly visibleStalls = computed(() => {
    const q = this.query().trim().toLowerCase();
    const stalls = this.currentStalls();
    if (!q) return stalls;
    return stalls.filter(
      s => (s.stallNumber ?? 'new').toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  });

  isSelected(id: string | number): boolean {
    return String(this.selectedStallId()) === String(id);
  }

  select(id: string | number): void {
    this.store.selectStall(id);
  }

  onSnapChange(checked: boolean): void {
    this.store.setSnap(checked);
  }
}
