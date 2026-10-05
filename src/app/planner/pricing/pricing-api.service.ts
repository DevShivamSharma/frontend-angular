import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base.token';
import type { PriceMaster, PriceMasterInput, PricingSnapshot, StallQuote } from './pricing.model';

@Injectable({ providedIn: 'root' })
export class PricingApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  list() { return firstValueFrom(this.http.get<PriceMaster[]>(this.base + '/price-masters')); }
  save(master: PriceMasterInput, current?: PriceMaster) {
    return firstValueFrom(current
      ? this.http.put<PriceMaster>(this.base + '/price-masters/' + current.id, { revision: current.revision, master })
      : this.http.post<PriceMaster>(this.base + '/price-masters', master));
  }
  import(rows: PriceMasterInput[]) { return firstValueFrom(this.http.post<PriceMaster[]>(this.base + '/price-masters/import', { rows })); }
  assign(layoutId: string | number, master: PriceMaster) {
    return firstValueFrom(this.http.put<{ pricingPolicy: PricingSnapshot; status: 'DRAFT' }>(this.base + '/layout/' + encodeURIComponent(layoutId) + '/pricing', { masterId: master.id, revision: master.revision }));
  }
  quote(layoutId: string | number, stallNumber: string, stallType: 'bare' | 'shell') {
    return firstValueFrom(this.http.get<StallQuote>(this.base + '/layout/' + encodeURIComponent(layoutId) + '/stalls/' + encodeURIComponent(stallNumber) + '/quote', { params: { stallType } }));
  }
}
