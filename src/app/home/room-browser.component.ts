import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, Output, EventEmitter, inject, signal } from '@angular/core';
import { VenueDataService } from './venue-data.service';
import { PhotoGalleryComponent } from './photo-gallery.component';
import { Room } from './venue.models';
@Component({ selector: 'div[appRoomBrowser]', standalone: true, imports: [PhotoGalleryComponent], templateUrl: './room-browser.component.html', changeDetection: ChangeDetectionStrategy.OnPush, host: { '[attr.aria-busy]': 'pending()' } })
export class RoomBrowserComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) level = 1;
  @Input() selection = 0;
  @Output() readonly levelChange = new EventEmitter<number>();
  private readonly data = inject(VenueDataService);
  readonly rooms = signal<Room[]>([]);
  readonly pending = signal(true);
  readonly error = signal(false);
  private generation = 0;
  ngOnChanges(): void { void this.load(); }
  async load(): Promise<void> {
    const ticket = ++this.generation;
    this.pending.set(true); this.error.set(false); this.rooms.set([]);
    try { const rooms = await this.data.loadRooms(); if (ticket === this.generation) this.rooms.set(rooms.filter(room => room.level === this.level)); }
    catch { if (ticket === this.generation) this.error.set(true); }
    finally { if (ticket === this.generation) this.pending.set(false); }
  }
  format(value: number | null, suffix: string): string { return value === null ? 'Not listed' : value.toLocaleString('en-IN') + suffix; }
  ngOnDestroy(): void { this.generation++; }
}
