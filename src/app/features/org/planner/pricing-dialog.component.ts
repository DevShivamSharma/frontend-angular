import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';

import {
  forSale,
  PRICE_TYPES,
  PriceCard,
  PriceRates,
  PriceType,
  rupees,
} from '../../../core/plans/stall-price';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import type { PlannerStore } from './planner.store';

export interface PricingDialogData {
  store: PlannerStore;
  /** Opens on this tab. */
  tab?: Tab;
}

/** Closes with `select-unpriced` to have the planner pick the stalls without a price. */
export type PricingDialogResult = 'select-unpriced' | undefined;

type Tab = 'card' | 'stalls';

const TYPE_LABEL: Record<PriceType, string> = {
  general: 'General',
  premium: 'Premium',
  marquee: 'Marquee',
};

const RATE_ROWS: Array<{ key: keyof PriceRates; label: string; unit: '₹/m²' | '%' | '₹' }> = [
  { key: 'bareRate', label: 'Bare space rate', unit: '₹/m²' },
  { key: 'shellRate', label: 'Shell scheme rate', unit: '₹/m²' },
  { key: 'side2Percent', label: '2 sides open', unit: '%' },
  { key: 'side3Percent', label: '3 sides open', unit: '%' },
  { key: 'side4Percent', label: '4 sides open', unit: '%' },
  { key: 'catalogueCharge', label: 'Catalogue entry charge', unit: '₹' },
  { key: 'fnbPrice', label: 'Food & beverage stall', unit: '₹' },
];

const EMPTY_RATES = (): PriceRates => ({
  bareRate: 0,
  shellRate: 0,
  side2Percent: 0,
  side3Percent: 0,
  side4Percent: 0,
  catalogueCharge: 0,
  fnbPrice: null,
});

/** Stalls alike for pricing: size, scheme, open sides and what they are marked. */
interface StallGroup {
  key: string;
  label: string;
  ids: string[];
  /** The price the stalls have now: one value, a range, or none. */
  now: string;
  /** How many of them have a price set on the stall. */
  own: number;
}

/**
 * The hall's pricing, as ITPO keeps it: the rate card (General, and Premium and Marquee when
 * priced apart) and prices set on stalls, a group of alike stalls at a time. Saved at once,
 * apart from the plan; rupees before GST.
 */
@Component({
  selector: 'app-pricing-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    SelectButtonModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="dialog-title head">
      <span class="badge" aria-hidden="true"><app-icon name="sell" /></span>
      <span>
        Pricing
        <small class="muted"
          >{{ hallName() }} · ₹ before GST · saved at once, apart from the plan</small
        >
      </span>
    </header>
    <div class="dialog-content">
      @if (pricing()?.readOnlyReason; as why) {
        <p class="note"><app-icon name="visibility" />{{ why }}</p>
      }
      <p-selectbutton
        [options]="tabs"
        [ngModel]="tab()"
        (ngModelChange)="tab.set($event)"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        aria-label="Pricing"
      />

      <div class="summary nums" role="status">
        <span
          ><b>{{ summary().forSale | number }}</b> for sale</span
        >
        <span
          ><b>{{ summary().priced | number }}</b> priced</span
        >
        <span [class.bad]="summary().unpriced > 0"
          ><b>{{ summary().unpriced | number }}</b> without a price</span
        >
        <span
          ><b>{{ value() }}</b> in all</span
        >
        @if (summary().unpriced) {
          <button pButton [text]="true" size="small" type="button" (click)="selectUnpriced()">
            Show them on the plan
          </button>
        }
      </div>

      @if (tab() === 'card') {
        <p class="small muted">
          A stall's price is its area × the bare or shell rate, more for 2, 3 or 4 open sides, plus
          the catalogue charge. A food & beverage stall takes its own price when one is set. Premium
          and marquee stalls go by their own rates when they are priced apart.
        </p>
        <div class="table-wrap">
          <table class="rates">
            <thead>
              <tr>
                <th scope="col"></th>
                @for (type of types; track type) {
                  <th scope="col">
                    @if (type === 'general') {
                      General
                    } @else {
                      <label class="apart">
                        <p-checkbox
                          [binary]="true"
                          [ngModel]="apart()[type]"
                          (ngModelChange)="setApart(type, $event)"
                          [disabled]="!canManage()"
                          [inputId]="'apart-' + type"
                        />
                        {{ label[type] }} priced apart
                      </label>
                    }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows; track row.key) {
                <tr>
                  <th scope="row">
                    {{ row.label }} <span class="unit">{{ row.unit }}</span>
                  </th>
                  @for (type of types; track type) {
                    <td>
                      @if (type === 'general' || apart()[type]) {
                        <p-inputnumber
                          [ngModel]="draft()[type][row.key]"
                          (ngModelChange)="setRate(type, row.key, $event)"
                          [inputId]="type + '-' + row.key"
                          [ariaLabel]="label[type] + ' ' + row.label"
                          [min]="0"
                          [max]="row.unit === '%' ? 1000 : 1000000000"
                          [maxFractionDigits]="2"
                          locale="en-IN"
                          [placeholder]="row.key === 'fnbPrice' ? 'Area rate' : '0'"
                          [disabled]="!canManage()"
                        />
                      } @else {
                        <span class="muted small">As General</span>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="small muted">
          Stalls alike in size, scheme, open sides and marking are one row. A price set here is set
          on each stall of the row, before the rate card; clear it and the rate card prices them
          again. One stall at a time: select it on the plan.
        </p>
        @if (!groups().length) {
          <p class="small">No stalls for sale on the plan yet.</p>
        } @else {
          <div class="table-wrap">
            <table class="groups nums">
              <thead>
                <tr>
                  <th scope="col">Stalls alike</th>
                  <th scope="col">Stalls</th>
                  <th scope="col">Price now</th>
                  <th scope="col">Price per stall</th>
                  <th scope="col"><span class="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (g of groups(); track g.key) {
                  <tr>
                    <th scope="row">{{ g.label }}</th>
                    <td>{{ g.ids.length }}</td>
                    <td [class.bad]="g.now === '—'">
                      {{ g.now }}
                      @if (g.own) {
                        <small class="muted"
                          >·
                          {{
                            g.own === g.ids.length
                              ? 'set on the stalls'
                              : g.own + ' set on the stall'
                          }}</small
                        >
                      }
                    </td>
                    <td>
                      <p-inputnumber
                        [ngModel]="groupPrice()[g.key] ?? null"
                        (ngModelChange)="setGroupPrice(g.key, $event)"
                        [inputId]="'group-' + $index"
                        [ariaLabel]="'Price per stall of ' + g.label"
                        [min]="0"
                        [max]="1000000000"
                        [maxFractionDigits]="2"
                        locale="en-IN"
                        prefix="₹"
                        [disabled]="!canManage()"
                      />
                    </td>
                    <td class="row-actions">
                      <button
                        pButton
                        size="small"
                        type="button"
                        (click)="applyGroup(g)"
                        [disabled]="!canManage() || groupPrice()[g.key] == null || store.busy()"
                      >
                        Set
                      </button>
                      @if (g.own) {
                        <button
                          pButton
                          size="small"
                          [text]="true"
                          type="button"
                          (click)="clearGroup(g)"
                          [disabled]="!canManage() || !pricing()?.card || store.busy()"
                          [title]="
                            pricing()?.card
                              ? 'Let the rate card price these stalls again'
                              : 'Set the rate card first'
                          "
                        >
                          Use rate card
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Close</button>
      @if (tab() === 'card' && canManage()) {
        <button
          pButton
          type="button"
          (click)="saveCard()"
          [disabled]="store.busy() || !cardValid()"
        >
          Save rate card
        </button>
      }
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .head small {
      display: block;
      font: var(--app-body-small);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: light-dark(#fef3c7, #78350f);
      color: light-dark(#92400e, #fde68a);
    }
    .dialog-content {
      display: grid;
      gap: 12px;
    }
    .note {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: light-dark(#fef9c3, #422006);
      color: light-dark(#713f12, #fef9c3);
      font: var(--app-body-small);
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      align-items: center;
      font: var(--app-body-small);
    }
    .bad {
      color: var(--app-error);
    }
    .small {
      margin: 0;
      font: var(--app-body-small);
    }
    .muted {
      color: var(--app-on-surface-variant);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font: var(--app-body-small);
    }
    th,
    td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--app-outline-variant);
      text-align: left;
      vertical-align: middle;
    }
    thead th {
      font: var(--app-label-medium);
      color: var(--app-on-surface-variant);
    }
    tbody th {
      font-weight: 500;
    }
    .unit {
      color: var(--app-on-surface-variant);
      font-weight: 400;
    }
    .apart {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .rates td {
      min-width: 150px;
    }
    .groups td:nth-child(4) {
      min-width: 160px;
    }
    .row-actions {
      white-space: nowrap;
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input {
      width: 100%;
    }
  `,
})
export class PricingDialogComponent {
  protected readonly data = dialogData<PricingDialogData>();
  protected readonly ref = inject(DialogRef);
  protected readonly store = this.data.store;

  protected readonly tabs = [
    { label: 'Rate card', value: 'card' },
    { label: 'Stall prices', value: 'stalls' },
  ];
  protected readonly types = PRICE_TYPES;
  protected readonly label = TYPE_LABEL;
  protected readonly rows = RATE_ROWS;

  protected readonly tab = signal<Tab>(
    this.data.tab ?? (this.store.pricing()?.card ? 'stalls' : 'card'),
  );
  protected readonly pricing = this.store.pricing;
  protected readonly canManage = computed(() => !!this.pricing()?.canManage);
  protected readonly hallName = computed(() => this.store.view()?.hall.hall.name ?? 'Hall');

  /** The rate card being edited; it is saved with Save rate card. */
  protected readonly draft = signal<Record<PriceType, PriceRates>>(this.startDraft());
  protected readonly apart = signal<Record<'premium' | 'marquee', boolean>>({
    premium: !!this.store.pricing()?.card?.premium,
    marquee: !!this.store.pricing()?.card?.marquee,
  });
  protected readonly cardValid = computed(() => {
    const d = this.draft();
    const used: PriceType[] = [
      'general',
      ...(['premium', 'marquee'] as const).filter((t) => this.apart()[t]),
    ];
    return used.every((t) => d[t].bareRate > 0 || d[t].shellRate > 0);
  });

  protected readonly summary = computed(() => {
    const stalls = this.store.plan().stalls.filter(forSale);
    const unpriced = this.store.unpriced().length;
    return { forSale: stalls.length, priced: stalls.length - unpriced, unpriced };
  });
  protected readonly value = computed(() => rupees(this.store.planValue()));

  /** Prices typed per row of the Stall prices tab, before Set. */
  protected readonly groupPrice = signal<Record<string, number | null>>({});

  protected readonly groups = computed<StallGroup[]>(() => {
    const prices = this.store.prices();
    const own = new Set(this.pricing()?.prices.map((p) => p.stallId) ?? []);
    const groups = new Map<string, StallGroup & { values: number[] }>();
    for (const s of this.store.plan().stalls.filter(forSale)) {
      const sides = new Set(s.openSides).size;
      const marks = [
        s.isPremium && 'premium',
        s.isMarqueeAvailable && 'marquee',
        s.isFnb && 'food & beverage',
      ].filter(Boolean);
      const size = `${trim(s.width)} × ${trim(s.depth)} m`;
      const key = [size, s.scheme, sides, ...marks].join('|');
      const label = [
        size,
        s.scheme === 'shell' ? 'shell' : 'bare',
        `${sides} ${sides === 1 ? 'side' : 'sides'} open`,
        ...marks,
      ].join(' · ');
      const g = groups.get(key) ?? { key, label, ids: [], now: '', own: 0, values: [] };
      g.ids.push(s.id);
      if (own.has(s.id)) g.own++;
      const p = prices.get(s.id);
      if (p) g.values.push(p.price);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map(({ values, ...g }) => {
        const [lo, hi] = [Math.min(...values), Math.max(...values)];
        const now = !values.length
          ? '—'
          : lo === hi
            ? rupees(lo) + (values.length < g.ids.length ? ' (some none)' : '')
            : `${rupees(lo)} – ${rupees(hi)}`;
        return { ...g, now };
      })
      .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  });

  protected setApart(type: 'premium' | 'marquee', on: boolean): void {
    this.apart.update((a) => ({ ...a, [type]: on }));
  }

  protected setRate(type: PriceType, key: keyof PriceRates, value: number | null): void {
    this.draft.update((d) => ({
      ...d,
      [type]: { ...d[type], [key]: key === 'fnbPrice' ? value : (value ?? 0) },
    }));
  }

  protected async saveCard(): Promise<void> {
    const d = this.draft();
    const card: PriceCard = {
      general: d.general,
      premium: this.apart().premium ? d.premium : null,
      marquee: this.apart().marquee ? d.marquee : null,
    };
    await this.store.setPriceCard(card);
  }

  protected setGroupPrice(key: string, value: number | null): void {
    this.groupPrice.update((g) => ({ ...g, [key]: value }));
  }

  protected async applyGroup(g: StallGroup): Promise<void> {
    const price = this.groupPrice()[g.key];
    if (price == null) return;
    const ok = await this.store.setStallPrices(g.ids.map((stallId) => ({ stallId, price })));
    if (ok) this.setGroupPrice(g.key, null);
  }

  protected async clearGroup(g: StallGroup): Promise<void> {
    const own = new Set(this.pricing()?.prices.map((p) => p.stallId) ?? []);
    await this.store.setStallPrices(
      g.ids.filter((id) => own.has(id)).map((stallId) => ({ stallId, price: null })),
    );
  }

  protected selectUnpriced(): void {
    this.ref.close('select-unpriced' satisfies PricingDialogResult);
  }

  private startDraft(): Record<PriceType, PriceRates> {
    const card = this.store.pricing()?.card;
    const general = card?.general ?? EMPTY_RATES();
    return {
      general: { ...general },
      premium: { ...(card?.premium ?? general) },
      marquee: { ...(card?.marquee ?? general) },
    };
  }
}

function trim(n: number): string {
  return `${Math.round(n * 100) / 100}`;
}
