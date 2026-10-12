import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { forSale, rupees } from '../../../core/plans/stall-price';
import { IconComponent } from '../../../shared/icon.component';
import { PlannerStore } from './planner.store';

/**
 * The price of the stalls selected on the plan: one stall's price and how it was worked out, or
 * the selection's total; and, for who prices the hall, a price to set on them all at once.
 */
@Component({
  selector: 'app-stall-price-card',
  imports: [FormsModule, ButtonModule, InputNumberModule, InputTextModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <section class="card" aria-label="Price">
        <h3 class="card-title">Price <small>excl. GST</small></h3>
        @if (one(); as p) {
          @if (p.price) {
            <p class="price nums">{{ money(p.price.price) }}</p>
            <p class="how">
              {{ p.price.reckoning }}
              @if (p.price.from === 'stall') {
                <span class="tag">set on the stall</span>
              }
            </p>
          } @else if (p.sale) {
            <p class="none"><app-icon name="warning" />No price yet</p>
            <p class="how">Set the rate card, or a price on this stall.</p>
          } @else {
            <p class="how">Not for sale: it needs no price.</p>
          }
        } @else {
          <p class="price nums">{{ money(many().total) }}</p>
          <p class="how">
            {{ many().count }} stalls selected
            @if (many().unpriced) {
              · <span class="bad">{{ many().unpriced }} without a price</span>
            }
          </p>
        }
        @if (canManage() && saleIds().length) {
          <div class="set">
            <p-inputnumber
              [ngModel]="price()"
              (ngModelChange)="price.set($event)"
              inputId="stall-price"
              ariaLabel="Price per stall"
              [min]="0"
              [max]="1000000000"
              [maxFractionDigits]="2"
              locale="en-IN"
              prefix="₹"
              placeholder="Price per stall"
            />
            <input
              pInputText
              [ngModel]="note()"
              (ngModelChange)="note.set($event)"
              maxlength="300"
              placeholder="Why (optional)"
              aria-label="Why this price"
            />
            <div class="buttons">
              <button
                pButton
                size="small"
                type="button"
                (click)="set()"
                [disabled]="price() === null || store.busy()"
              >
                Set on {{ saleIds().length === 1 ? 'the stall' : saleIds().length + ' stalls' }}
              </button>
              @if (ownIds().length && store.pricing()?.card) {
                <button
                  pButton
                  size="small"
                  [text]="true"
                  type="button"
                  (click)="clear()"
                  [disabled]="store.busy()"
                >
                  Use rate card
                </button>
              }
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .card-title small {
      font: var(--app-label-small);
      color: var(--app-on-surface-variant);
    }
    .price {
      margin: 0;
      font: var(--app-title-large);
    }
    .how {
      margin: 4px 0 0;
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
    }
    .tag {
      display: inline-block;
      margin-left: 4px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--app-surface-container);
      font: var(--app-label-small);
    }
    .none {
      display: flex;
      gap: 6px;
      align-items: center;
      margin: 0;
      color: var(--app-error);
      font: var(--app-label-large);
    }
    .bad {
      color: var(--app-error);
    }
    .set {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input,
    input[pInputText] {
      width: 100%;
    }
  `,
})
export class StallPriceCardComponent {
  protected readonly store = inject(PlannerStore);
  protected readonly price = signal<number | null>(null);
  protected readonly note = signal('');

  protected readonly selected = this.store.selectedStalls;
  protected readonly show = computed(() => !!this.store.pricing() && this.selected().length > 0);
  protected readonly canManage = computed(() => !!this.store.pricing()?.canManage);
  protected readonly saleIds = computed(() =>
    this.selected()
      .filter(forSale)
      .map((s) => s.id),
  );
  protected readonly ownIds = computed(() => {
    const own = new Set(this.store.pricing()?.prices.map((p) => p.stallId) ?? []);
    return this.selected()
      .map((s) => s.id)
      .filter((id) => own.has(id));
  });

  protected readonly one = computed(() => {
    const [s, more] = this.selected();
    if (!s || more) return null;
    return { price: this.store.prices().get(s.id) ?? null, sale: forSale(s) };
  });
  protected readonly many = computed(() => {
    const prices = this.store.prices();
    const stalls = this.selected();
    return {
      count: stalls.length,
      total: stalls.reduce((sum, s) => sum + (prices.get(s.id)?.price ?? 0), 0),
      unpriced: stalls.filter((s) => forSale(s) && !prices.get(s.id)).length,
    };
  });

  protected money(n: number): string {
    return rupees(n);
  }

  protected async set(): Promise<void> {
    const price = this.price();
    if (price === null) return;
    const note = this.note().trim() || null;
    const ok = await this.store.setStallPrices(
      this.saleIds().map((stallId) => ({ stallId, price, note })),
    );
    if (ok) {
      this.price.set(null);
      this.note.set('');
    }
  }

  protected async clear(): Promise<void> {
    await this.store.setStallPrices(this.ownIds().map((stallId) => ({ stallId, price: null })));
  }
}
