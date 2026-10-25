import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { stallLabel } from '../../domain/plan.models';
import { stallArea } from '../../domain/stall-cells';
import { forSale, rupees } from '../../domain/stall-price';
import type { PlannerStore } from '../../state/planner.store';

export interface StallPricesData {
  store: PlannerStore;
}

/** Every stall of the plan with the price the rate card gives it, and how it was worked out. */
@Component({
  selector: 'app-stall-prices-dialog',
  imports: [DecimalPipe, ButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stall-prices-dialog.component.html',
  styleUrl: './stall-prices-dialog.component.scss',
})
export class StallPricesDialogComponent {
  private readonly data = dialogData<StallPricesData>();
  protected readonly ref = inject(DialogRef);
  protected readonly rupees = rupees;

  protected readonly rows = computed(() => {
    const store = this.data.store;
    const prices = store.prices();
    return store
      .plan()
      .stalls.filter((s) => s.isActive)
      .map((s) => ({
        id: s.id,
        label: stallLabel(s),
        area: s.labelArea ?? stallArea(s),
        scheme: s.scheme === 'shell' ? 'Shell' : 'Bare',
        forSale: forSale(s),
        price: prices.get(s.id) ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  });
  protected readonly total = computed(() => this.data.store.planValue());
  protected readonly unpriced = computed(() => this.data.store.unpriced().length);
}
