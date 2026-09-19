import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconComponent } from './icon.component';
import { PlannerStore } from '../planner-store.service';

/** "Shops in Hall" section with the snap toggle. App.js:592. */
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
