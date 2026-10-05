import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base.token';

type RecordValues = Record<string, string | null>;
interface Rate {
  id: string; eventId: string; eventName: string; eventLabel: string; hallName: string;
  venueHallId: string | null; category: string; isTest: boolean; issues: string[];
  source: RecordValues; masterId?: number; masterName?: string;
}
interface RentalHall { id: string; name: string; active: boolean; categoryId: string; categoryName: string; scheduleIds: string[]; additionalChargesPercent: string | null; discountPercent: string | null; }
interface Schedule { id: string; categoryName: string; period: string; validFrom: string; validTo: string; active: boolean;
  mounting: string | null; exhibition: string | null; dismantling: string | null;
  fnbMounting: string | null; fnbExhibition: string | null; fnbDismantling: string | null;
  ticketedMounting: string | null; ticketedExhibition: string | null; ticketedDismantling: string | null; }
interface Library { sourceName: string; importedAt: string; stallRates: Rate[]; hallRentals: RentalHall[]; schedules: Schedule[]; }

@Component({ selector: 'app-pricing-library', imports: [FormsModule, RouterLink],
  templateUrl: './pricing-library.component.html', styleUrl: './pricing-library.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class PricingLibraryComponent {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  private readonly detail = viewChild<ElementRef<HTMLElement>>('detail');
  readonly data = signal<Library | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly view = signal<'stalls' | 'rentals'>('stalls');
  readonly event = signal('');
  readonly hall = signal('');
  readonly category = signal('');
  readonly status = signal('');
  readonly query = signal('');
  readonly selectedId = signal('');
  readonly page = signal(0);
  readonly pageSize = 12;
  readonly savedCount = computed(() => this.data()?.stallRates.filter(r => r.masterId).length ?? 0);
  readonly events = computed(() => [...new Map((this.data()?.stallRates ?? []).map(r => [r.eventId, { id: r.eventId, name: r.eventName }])).values()].sort((a,b) => a.name.localeCompare(b.name)));
  readonly halls = computed(() => [...new Set((this.data()?.stallRates ?? []).filter(r => !this.event() || r.eventId === this.event()).map(r => r.hallName))].sort());
  readonly filtered = computed(() => (this.data()?.stallRates ?? []).filter(r =>
    (!this.event() || r.eventId === this.event()) && (!this.hall() || r.hallName === this.hall()) &&
    (!this.category() || r.category === this.category()) && (!this.status() || (this.status() === 'saved' ? !!r.masterId : !r.masterId))
  ).sort((a,b) => a.eventLabel.localeCompare(b.eventLabel) || a.hallName.localeCompare(b.hallName) || a.category.localeCompare(b.category) || (a.source['start_date'] ?? '').localeCompare(b.source['start_date'] ?? '')));
  readonly selected = computed(() => this.filtered().find(r => r.id === this.selectedId()) ?? this.filtered()[0] ?? null);
  readonly visibleRates = computed(() => this.filtered().slice(this.page()*this.pageSize, (this.page()+1)*this.pageSize));
  readonly lastPage = computed(() => Math.max(0, Math.ceil(this.filtered().length/this.pageSize)-1));
  readonly rentalHalls = computed(() => (this.data()?.hallRentals ?? []).filter(r => `${r.name} ${r.categoryName}`.toLowerCase().includes(this.query().trim().toLowerCase())).sort((a,b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
  readonly rentalHall = computed(() => this.rentalHalls().find(r => r.id === this.selectedId()) ?? this.rentalHalls()[0] ?? null);
  readonly rentalSchedules = computed(() => (this.data()?.schedules ?? []).filter(s => this.rentalHall()?.scheduleIds.includes(s.id)));
  readonly premiums = [ ['two_side_open_rate_percent', '2 open sides'], ['three_side_open_rate_percent', '3 open sides'], ['four_side_open_rate_percent', '4+ open sides'] ];
  readonly overseas = [ ['overseas_bare_rate','Bare'], ['overseas_shell_rate','Shell'], ['overseas_catalog_entry_charge','Catalogue'] ];
  readonly overseasPremiums = [ ['overseas_two_side_open_rate_percent','2 sides'], ['overseas_three_side_open_rate_percent','3 sides'], ['overseas_four_side_open_rate_percent','4+ sides'] ];
  constructor() { void this.load(); }
  async load() {
    this.busy.set(true); this.error.set('');
    try { this.data.set(await firstValueFrom(this.http.get<Library | null>(this.base + '/price-masters/library'))); }
    catch { this.error.set('Hall pricing could not be loaded. Check the backend and try again.'); }
    finally { this.busy.set(false); }
  }
  filtersChanged() { this.page.set(0); this.selectedId.set(''); }
  changeEvent(value: string) { this.event.set(value); this.hall.set(''); this.filtersChanged(); }
  clear() { this.event.set(''); this.hall.set(''); this.category.set(''); this.status.set(''); this.query.set(''); this.filtersChanged(); }
  changeView(view: 'stalls' | 'rentals') {
    if (view === this.view()) return;
    const venueHallId = this.selected()?.venueHallId;
    this.view.set(view);
    if (view === 'rentals') this.query.set('');
    this.selectedId.set(view === 'rentals' ? venueHallId ?? '' : '');
  }
  selectRate(id: string) {
    this.selectedId.set(id);
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => {
      const detail = this.detail()?.nativeElement;
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView({ block: 'start' });
    });
  }
  reversedWindow(from: string, to: string): boolean { return !!from && !!to && from.slice(0, 19) > to.slice(0, 19); }
  amount(value: string | number | null | undefined, rupees = true): string {
    if (value === null || value === undefined || value === '') return 'Not specified';
    return (rupees ? '₹' : '') + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  percent(value: string | null | undefined): string { return value == null ? 'Not specified' : `${Number(value)}%`; }
  date(value: string | null | undefined): string { return value ? value.replace('T',' ').replace('+05:30',' IST') : 'Not specified'; }
}
