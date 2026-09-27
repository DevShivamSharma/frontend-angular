import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { RoomBrowserComponent } from './room-browser.component';
import { HallBrowserComponent } from './hall-browser.component';
import { LEVEL_NAMES, VenueDetail } from './venue.models';
@Component({ selector: 'aside[appVenueDetails]', standalone: true, imports: [RoomBrowserComponent, HallBrowserComponent], templateUrl: './venue-details.component.html', changeDetection: ChangeDetectionStrategy.OnPush, host: { id: 'detail-panel', class: 'detail-panel', 'aria-label': 'Venue details', '[class.rooms-mode]': 'galleryMode', '[hidden]': '!visible' } })
export class VenueDetailsComponent implements OnChanges {
  @Input() id = '';
  @Input() detail?: VenueDetail;
  @Input() visible = false;
  @Input() selection = 0;
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly levelChange = new EventEmitter<number>();
  @Output() readonly openPlan = new EventEmitter<VenueDetail>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly levelNames = LEVEL_NAMES;
  get level(): number { return Number(/^level([123])$/.exec(this.id)?.[1] || 0); }
  get hall(): string { return /^hall(\d+[A-Z]?)$/.exec(this.id)?.[1] || ''; }
  get galleryMode(): boolean { return !!(this.level || this.hall); }
  get title(): string { return this.hall ? 'Hall ' + this.hall : this.level ? 'Convention Centre' : this.detail?.title || ''; }
  get subtitle(): string { return this.hall ? 'Exhibition hall · Photos & details' : this.level ? 'Level ' + this.level + ' · ' + LEVEL_NAMES[this.level] : this.detail?.subtitle || ''; }
  ngOnChanges(): void { if (this.visible) this.element.nativeElement.scrollTop = 0; }
}
