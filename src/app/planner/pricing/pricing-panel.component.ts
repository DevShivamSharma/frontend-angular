import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../planner-store.service';
import { LayoutApiService } from '../layout-api.service';
import { extractErrorMessage } from '../../core/http-error.util';
import { PricingApiService } from './pricing-api.service';
import { PriceBreakdownComponent } from './price-breakdown.component';
import { downloadPriceTemplate, emptyPriceMaster, readPrices } from './pricing-workbook';
import type { PriceMaster, PriceMasterInput, PricingSnapshot, StallQuote } from './pricing.model';

@Component({ selector:'app-pricing-panel', imports:[FormsModule,CurrencyPipe,PriceBreakdownComponent],
  templateUrl:'./pricing-panel.component.html', styleUrl:'./pricing-panel.component.css', changeDetection:ChangeDetectionStrategy.OnPush })
export class PricingPanelComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly retryLabel = signal('');
  retryError: () => void = () => {};
  readonly store = inject(PlannerStore);
  private readonly api = inject(PricingApiService);
  private readonly layouts = inject(LayoutApiService);
  readonly masters = signal<PriceMaster[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly snapshot = signal<PricingSnapshot | null>(null);
  readonly quote = signal<StallQuote | null>(null);
  readonly rows = signal<PriceMasterInput[]>([]);
  readonly stalls = signal<Array<{number:string;name:string}>>([]);
  readonly ready = signal(false);
  readonly editing = signal(false);
  selectedId = '';
  current?: PriceMaster;
  form = emptyPriceMaster();
  stallNumber = '';
  stallType: 'bare' | 'shell' = 'bare';
  private sequence = 0;
  readonly amountFields = [ {key:'bare_rate',label:'Bare rate / m²'}, {key:'shell_rate',label:'Shell rate / m²'}, {key:'catlog_entry_charge',label:'Catalogue / stall'} ] as const;
  readonly premiumFields = [ {key:'two_side_open_rate_percent',label:'2 open sides (%)'}, {key:'three_side_open_rate_percent',label:'3 open sides (%)'}, {key:'four_side_open_rate_percent',label:'4+ open sides (%)'} ] as const;
  readonly taxFields = [{key:'cgst_percent',label:'CGST (%)'},{key:'sgst_percent',label:'SGST (%)'},{key:'igst_percent',label:'IGST (%)'}] as const;
  constructor() {
    void this.reload();
    effect(() => {
      const id = this.store.selectedSavedId(), saving = this.store.busy();
      untracked(() => {
        if (saving) { ++this.sequence; this.ready.set(false); this.quote.set(null); }
        else void this.loadLayout(id);
      });
    });
  }
  async reload(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.masters.set(await this.api.list()); } catch(e) { this.reportError(e, 'Reload masters', () => void this.reload()); }
    finally { this.busy.set(false); }
  }
  private async loadLayout(id: string | number | null): Promise<void> {
    const seq = ++this.sequence;
    this.ready.set(false); this.snapshot.set(null); this.quote.set(null); this.stalls.set([]); this.stallNumber='';
    if (!id) return;
    try {
      const detail = await this.layouts.open(id);
      if (seq !== this.sequence) return;
      this.snapshot.set(detail.layout?.pricingPolicy ?? null);
      this.stalls.set((detail.stalls ?? []).filter(s => s.stallNumber && s.status !== 'CANCELLED' && !s.isSplitParent).map(s => ({number:String(s.stallNumber),name:String(s.name || s.stallNumber)})));
      this.ready.set(true);
    } catch(e) { if(seq===this.sequence) this.reportError(e, 'Reload saved layout', () => void this.loadLayout(this.store.selectedSavedId())); }
  }
  newMaster(): void { this.current=undefined; this.form=emptyPriceMaster(); this.editing.set(true); this.error.set(''); this.notice.set(''); }
  edit(): void {
    const current=this.masters().find(m=>String(m.id)===this.selectedId);
    if(!current) return;
    this.current=current; this.form={name:current.name,...current.policy}; this.editing.set(true); this.error.set(''); this.notice.set('');
  }
  async save(): Promise<void> {
    if(this.busy()) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const saved=await this.api.save(this.form,this.current);
      this.masters.update(list=>[...list.filter(m=>m.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name)));
      this.selectedId=String(saved.id); this.current=saved; this.editing.set(false);
      this.notice.set('Price master saved. Apply this revision to a layout when ready.');
    } catch(e) { this.reportError(e, 'Return to price form', () => this.focus('#price-name')); } finally { this.busy.set(false); }
  }
  async apply(): Promise<void> {
    const id=this.store.selectedSavedId(), master=this.masters().find(m=>String(m.id)===this.selectedId);
    if(!id || !master || !this.ready() || this.busy() || this.store.busy()) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const result=await this.api.assign(id,master);
      if(String(this.store.selectedSavedId())===String(id)) {
        this.snapshot.set(result.pricingPolicy); this.quote.set(null);
        this.store.publication.set({status:'DRAFT',publishedAt:null,publishOverrides:null});
        this.stallType=master.policy.bare_rate === null ? 'shell' : 'bare';
      }
      void this.store.loadList();
      this.notice.set('Rates applied to layout '+id+'. Review and publish it to open priced booking.');
    } catch(e) { this.reportError(e, 'Reload masters', () => void this.reload()); } finally { this.busy.set(false); }
  }
  async preview(): Promise<void> {
    const id=this.store.selectedSavedId(), number=this.stallNumber, type=this.stallType, seq=this.sequence;
    if(!id || !number || this.busy()) return;
    this.busy.set(true); this.error.set(''); this.quote.set(null);
    try { const quote=await this.api.quote(id,number,type); if(seq===this.sequence && number===this.stallNumber && type===this.stallType) this.quote.set(quote); }
    catch(e) { this.reportError(e, 'Retry price', () => void this.preview()); } finally { this.busy.set(false); }
  }
  private reportError(error: unknown, label: string, retry: () => void): void {
    this.error.set(extractErrorMessage(error)); this.retryLabel.set(label); this.retryError=retry;
    // Render the conditional alert before moving focus. Keep the user's entries intact.
    setTimeout(() => this.focus('[data-pricing-error]'));
  }
  private focus(selector: string): void {
    const target=this.element.nativeElement.querySelector<HTMLElement>(selector);
    if(!target?.isConnected) return;
    target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest'});
  }
  template(): void { downloadPriceTemplate(); }
  async file(event: Event): Promise<void> {
    const input=event.target as HTMLInputElement, file=input.files?.[0]; input.value=''; this.rows.set([]); this.error.set(''); this.notice.set('');
    if(!file) return;
    this.busy.set(true);
    try { if(file.size>2*1024*1024) throw new Error('Use a workbook smaller than 2 MB.'); this.rows.set(readPrices(await file.arrayBuffer())); }
    catch(e) { this.reportError(e, 'Choose another workbook', () => this.element.nativeElement.querySelector<HTMLInputElement>('#price-file')?.click()); } finally { this.busy.set(false); }
  }
  async importRows(): Promise<void> {
    if(this.busy() || !this.rows().length) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try { const saved=await this.api.import(this.rows()); this.masters.update(list=>[...list,...saved].sort((a,b)=>a.name.localeCompare(b.name))); this.rows.set([]); this.notice.set(saved.length+' price masters imported. Choose one to apply.'); }
    catch(e) { this.reportError(e, 'Review import', () => this.focus('.preview')); } finally { this.busy.set(false); }
  }
}
