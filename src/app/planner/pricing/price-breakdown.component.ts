import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import type { StallQuote } from './pricing.model';
@Component({ selector:'app-price-breakdown', imports:[CurrencyPipe, DecimalPipe], changeDetection:ChangeDetectionStrategy.OnPush,
  template: `@if (quote(); as q) {
    <p class="source">{{ q.masterName }} · revision {{ q.revision }} · {{ q.stallType === 'bare' ? 'Bare space' : 'Shell scheme' }}</p>
    <dl aria-label="Price breakdown">
      <div><dt>{{ q.area | number:'1.0-2' }} m² × {{ q.rate | currency:'INR':'symbol':'1.2-2' }}</dt><dd>{{ q.rental | currency:'INR' }}</dd></div>
      <div><dt>Open-side premium</dt><dd>{{ q.openSideCharge | currency:'INR' }}</dd></div>
      <div><dt>Catalogue</dt><dd>{{ q.catalogueCharge | currency:'INR' }}</dd></div>
      <div><dt>Stall tax</dt><dd>{{ q.baseTax | currency:'INR' }}</dd></div>
      @if (q.emcCharge || q.emcTax) {
        <div><dt>{{ q.emcName || 'EMC' }} charge</dt><dd>{{ q.emcCharge | currency:'INR' }}</dd></div>
        <div><dt>EMC tax</dt><dd>{{ q.emcTax | currency:'INR' }}</dd></div>
      }
      <div class="total"><dt>Total</dt><dd>{{ q.total | currency:'INR' }}</dd></div>
    </dl>
  }`,
  styles:[`:host{display:block;font-size:13px;color:var(--text-primary)}.source{color:var(--text-secondary);margin:12px 0 8px;overflow-wrap:anywhere}dl{margin:0 0 12px}dl>div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0}dt{overflow-wrap:anywhere}dd{margin:0;white-space:nowrap;font-variant-numeric:tabular-nums}.total{border-top:1px solid var(--border-default);margin-top:6px;padding-top:10px;font-size:16px;font-weight:650}`] })
export class PriceBreakdownComponent { readonly quote = input<StallQuote | null>(null); }
