import { PricingApiService } from '../pricing/pricing-api.service';
import type { PricingSnapshot, StallQuote } from '../pricing/pricing.model';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { extractErrorMessage } from '../../core/http-error.util';
import { NotifyService } from '../../core/notify.service';
import { IconComponent } from '../components/icon.component';
import { normalizeStall } from '../geometry/planner-geometry';
import { LayoutApiService } from '../layout-api.service';
import type { Hall } from '../models/hall.model';
import type { Stall } from '../models/stall.model';
import { ExhibitorPlanComponent } from './exhibitor-plan.component';
import { ExhibitorScene3dComponent } from './exhibitor-scene3d.component';
import { ExhibitorStallDetailsComponent } from './exhibitor-stall-details.component';
import {
  exhibitorStalls,
  kindLabel,
  matchesFilters,
  SIZE_BUCKETS,
  STALL_KINDS,
  type SizeBucket,
  type StallKind
} from './exhibitor-view';

type Filter = 'ALL' | 'AVAILABLE';

/**
 * The exhibitor-facing view of a saved layout (`/planner/view?layoutId=`): the floor plan, every
 * stall with its availability, size and open sides, and booking of an available stall.
 *
 * Read-only apart from booking. It talks to the API directly instead of `PlannerStore`: the store
 * is the editor's state (drafts, rules, undo), none of which an exhibitor has.
 */
@Component({
  selector: 'app-exhibitor-view-page',
  templateUrl: './exhibitor-view-page.component.html',
  styleUrl: './exhibitor-view-page.component.css',
  imports: [ExhibitorPlanComponent, ExhibitorScene3dComponent, ExhibitorStallDetailsComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'choose(null)' }
})
export class ExhibitorViewPageComponent {
  private readonly api = inject(LayoutApiService);
  private readonly prices = inject(PricingApiService);
  readonly pricing = signal<PricingSnapshot | null>(null);
  readonly published = signal(false);
  readonly quote = signal<StallQuote | null>(null);
  readonly quoteLoading = signal(false);
  readonly quoteError = signal('');
  readonly stallType = signal<'bare' | 'shell'>('bare');
  private quoteSequence = 0;
  private readonly notify = inject(NotifyService);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);

  readonly layoutId = computed(() => this.params()?.get('layoutId') ?? null);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly loadError = signal('');
  readonly layoutName = signal('');
  readonly hall = signal<Hall | null>(null);
  private readonly savedStalls = signal<Stall[]>([]);

  readonly stalls = computed(() => exhibitorStalls(this.savedStalls()));
  readonly availableCount = computed(() => this.stalls().filter(s => s.available).length);
  readonly bookedCount = computed(() => this.stalls().length - this.availableCount());

  readonly query = signal('');
  readonly filter = signal<Filter>('ALL');
  readonly sizes = signal<ReadonlySet<SizeBucket>>(new Set());
  readonly kinds = signal<ReadonlySet<StallKind>>(new Set());
  readonly listed = computed(() => {
    const filters = {
      query: this.query(),
      onlyAvailable: this.filter() === 'AVAILABLE',
      sizes: this.sizes(),
      kinds: this.kinds()
    };
    return this.stalls().filter(s => matchesFilters(s, filters));
  });
  readonly filtering = computed(() =>
    !!this.query().trim() || this.filter() === 'AVAILABLE' || this.sizes().size > 0 || this.kinds().size > 0);
  /** The stalls the list shows, for the plan to dim the rest; null when nothing is filtered. */
  readonly matchIds = computed(() => (this.filtering() ? new Set(this.listed().map(s => s.id)) : null));

  /** Filter chips: only the sizes and kinds this layout has, each with its stall count. */
  readonly sizeOptions = computed(() => SIZE_BUCKETS
    .map(b => ({ ...b, count: this.stalls().filter(s => s.size === b.bucket).length }))
    .filter(b => b.count > 0));
  readonly kindOptions = computed(() => STALL_KINDS
    .map(k => ({ ...k, count: this.stalls().filter(s => s.kind === k.kind).length }))
    .filter(k => k.count > 0));

  readonly viewMode = signal<'2d' | '3d'>('3d');
  readonly showLabels = signal(true);

  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.stalls().find(s => s.id === this.selectedId()) ?? null);
  /** Brings a stall picked from the list into view on the plan. */
  readonly focus = signal<{ id: string; seq: number } | null>(null);

  readonly booking = signal(false);
  /** The stall booked from this page, to confirm it in the details panel. */
  readonly bookedHere = signal<string | null>(null);

  constructor() {
    effect(() => {
      const number=this.selected()?.stall.stallNumber, pricing=this.pricing(), type=this.stallType(), id=this.layoutId();
      untracked(() => void this.loadQuote(id, number, pricing, type));
    });
    effect(() => {
      const id = this.layoutId();
      untracked(() => void this.load(id));
    });
  }

  async load(id = this.layoutId()): Promise<void> {
    if (!id) {
      this.status.set('error');
      this.loadError.set('No layout was chosen. Open this page from a saved layout’s View button.');
      return;
    }
    this.status.set('loading');
    try {
      const detail = await this.api.open(id);
      const hall = detail.hall;
      if (!hall) throw new Error('This layout has no hall plan to show.');
      this.pricing.set(detail.layout?.pricingPolicy ?? null);
      this.published.set(detail.layout?.status === 'PUBLISHED');
      this.stallType.set(detail.layout?.pricingPolicy?.policy.bare_rate === null ? 'shell' : 'bare');
      this.hall.set(hall);
      this.layoutName.set(detail.layout?.name || detail.name || hall.name);
      this.savedStalls.set((detail.stalls ?? []).map(s => normalizeStall(s, hall.id)));
      this.status.set('ready');
    } catch (e) {
      this.loadError.set(extractErrorMessage(e));
      this.status.set('error');
    }
  }

  choose(id: string | null, fromList = false): void {
    this.selectedId.set(id);
    if (id !== this.bookedHere()) this.bookedHere.set(null);
    if (id && fromList) this.focus.update(f => ({ id, seq: (f?.seq ?? 0) + 1 }));
  }

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  toggleSize(bucket: SizeBucket): void {
    this.sizes.update(set => toggled(set, bucket));
  }

  toggleKind(kind: StallKind): void {
    this.kinds.update(set => toggled(set, kind));
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('ALL');
    this.sizes.set(new Set());
    this.kinds.set(new Set());
  }

  kindLabel(kind: StallKind): string {
    return kindLabel(kind);
  }

  setViewMode(mode: '2d' | '3d'): void {
    this.viewMode.set(mode);
  }

  toggleLabels(): void {
    this.showLabels.update(v => !v);
  }

  async loadQuote(id: string | null, number: string | null | undefined, pricing: PricingSnapshot | null, type: 'bare' | 'shell'): Promise<void> {
    const seq=++this.quoteSequence;
    this.quote.set(null); this.quoteError.set(''); this.quoteLoading.set(false);
    if(!id || !number || !pricing) return;
    this.quoteLoading.set(true);
    try { const quote=await this.prices.quote(id,number,type); if(seq===this.quoteSequence) this.quote.set(quote); }
    catch(e) { if(seq===this.quoteSequence) this.quoteError.set(extractErrorMessage(e)); }
    finally { if(seq===this.quoteSequence) this.quoteLoading.set(false); }
  }

  retryQuote(): void { void this.loadQuote(this.layoutId(),this.selected()?.stall.stallNumber,this.pricing(),this.stallType()); }

  async book(): Promise<void> {
    const stall = this.selected();
    const layoutId = this.layoutId();
    if (!stall || !stall.available || !layoutId || this.booking()) return;
    const number = stall.stall.stallNumber;
    if (!number) {
      this.notify.error('This stall cannot be booked', 'It has no stall number yet. Ask the organiser to save the layout again.');
      return;
    }

    const quote = this.quote();
    if (this.pricing() && (!this.published() || this.quoteLoading() || this.quoteError() || !quote || quote.stallNumber !== number || quote.stallType !== this.stallType())) return;
    this.booking.set(true);
    try {
    const priceText = quote ? ' Total: ' + new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' }).format(quote.total) + '. Payment remains pending.' : '';
    const confirmed = await this.notify.confirm({
      title: `Book stall ${stall.name}?`,
      text: `${stall.sizeText} · ${stall.area} m² · ${stall.frontage}. Once booked, it is no longer offered to other exhibitors.${priceText}`,
      confirmText: 'Book stall',
      cancelText: 'Not now'
    });
    if (!confirmed) return;

      const result = await this.api.book(layoutId, number, quote ? { stall_type:quote.stallType, expectedQuote:quote.fingerprint } : {});
      const hallId = this.hall()!.id;
      const booked = normalizeStall(result.stall, hallId);
      this.savedStalls.update(list => list.map(s => (s.stallNumber === number ? booked : s)));
      this.selectedId.set(String(booked.id));
      this.bookedHere.set(String(booked.id));
      this.notify.success('Stall booked', `${stall.name} is now booked.`);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 409) {
        this.notify.error('Booking needs review', extractErrorMessage(e));
        await this.load(layoutId);
      } else {
        this.notify.error('Booking failed', extractErrorMessage(e));
      }
    } finally {
      this.booking.set(false);
    }
  }
}

/** A copy of the set with `value` added, or removed when it was there (a new set, so signals see it). */
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
