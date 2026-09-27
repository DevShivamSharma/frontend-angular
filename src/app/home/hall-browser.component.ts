import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, computed, inject, signal } from '@angular/core';
import { VenueDataService } from './venue-data.service';
import { PhotoGalleryComponent } from './photo-gallery.component';
import { FLOOR_NAMES, Hall, HallFloor } from './venue.models';
@Component({ selector: 'div[appHallBrowser]', standalone: true, imports: [PhotoGalleryComponent], templateUrl: './hall-browser.component.html', changeDetection: ChangeDetectionStrategy.OnPush, host: { '[attr.aria-busy]': 'pending()' } })
export class HallBrowserComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) hall = '';
  @Input() selection = 0;
  private readonly data = inject(VenueDataService);
  readonly records = signal<Hall[]>([]);
  readonly floor = signal<HallFloor>('details');
  readonly floors = computed(() => [...new Set(this.records().map(record => record.floor))]);
  readonly visibleRecords = computed(() => this.records().filter(record => record.floor === this.floor()));
  readonly floorNames = FLOOR_NAMES;
  readonly pending = signal(true);
  readonly error = signal(false);
  private generation = 0;
  ngOnChanges(): void { void this.load(); }
  async load(): Promise<void> {
    const ticket = ++this.generation;
    this.pending.set(true); this.error.set(false); this.records.set([]);
    try {
      const all = await this.data.loadHalls();
      if (ticket !== this.generation) return;
      const records = all.filter(record => record.halls.includes(this.hall.toUpperCase()));
      this.records.set(records); this.floor.set(records[0]?.floor || 'details');
    } catch { if (ticket === this.generation) this.error.set(true); }
    finally { if (ticket === this.generation) this.pending.set(false); }
  }
  title(record: Hall): string { return (record.halls.length > 1 ? 'Halls ' + record.halls.join('–') : 'Hall ' + this.hall) + (record.floor === 'details' ? '' : ' · ' + FLOOR_NAMES[record.floor]); }
  area(record: Hall): string { return record.area === null ? 'Not listed' : record.area.toLocaleString('en-IN') + ' m²'; }
  ngOnDestroy(): void { this.generation++; }
}
