import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewEncapsulation, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VenueDataService } from './venue-data.service';
import { VenueLoadingState } from './venue-loading.state';
import { VenueLoadingComponent } from './venue-loading.component';
import { VenueDetailsComponent } from './venue-details.component';
import { FloorPlanDialogComponent } from './floor-plan-dialog.component';
import { Destination, VenueDetail, VenueInformation } from './venue.models';
import { VenueViewer, createVenueViewer } from './venue-viewer';

@Component({
  selector: 'app-home-page', standalone: true,
  imports: [RouterLink, VenueLoadingComponent, VenueDetailsComponent, FloorPlanDialogComponent],
  providers: [VenueDataService],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css', './home-page.component-2.css', './venue-gallery.css', './venue-loading.css', './venue-loading-2.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly plan = viewChild.required(FloorPlanDialogComponent);
  private readonly zone = inject(NgZone);
  private readonly data = inject(VenueDataService);
  private viewer?: VenueViewer;
  private destroyed = false;
  readonly loading = new VenueLoadingState();
  readonly destinations = signal<Destination[]>([]);
  readonly details = signal<Record<string, VenueDetail>>({});
  readonly group = signal<'cc' | 'halls' | null>(null);
  readonly collapsed = signal(false);
  readonly activeView = signal('overview');
  readonly activeLevel = signal(0);
  readonly detailId = signal('');
  readonly detailsVisible = signal(false);
  readonly selection = signal(0);
  readonly status = signal('Bharat Mandapam');
  readonly daylight = signal(false);
  readonly globeActive = signal(false);
  readonly globeAvailable = signal(true);
  readonly geographyReady = signal(false);
  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      void this.loading.run('rooms', () => this.data.loadRooms());
      void this.loading.run('halls', () => this.data.loadHalls());
      void this.loading.run('venue', async () => {
        if (this.destroyed) throw new Error('Viewer destroyed');
        this.viewer = createVenueViewer(this.canvas().nativeElement, () => this.data.loadInformation(), {
          progress: value => this.zone.run(() => this.loading.progress('venue', value)),
          selected: (id, level) => this.zone.run(() => this.pick(id, level)),
          modeChanged: mode => this.zone.run(() => { this.globeActive.set(mode === 'globe'); if (mode === 'globe') this.closeDetails(); this.status.set(mode === 'globe' ? 'Earth · New Delhi' : 'Bharat Mandapam'); }),
          status: text => this.zone.run(() => this.status.set(text)),
          geographyReady: ready => this.zone.run(() => { this.geographyReady.set(ready); this.globeAvailable.set(ready); })
        });
        const info = await this.viewer.ready;
        if (!this.destroyed) this.zone.run(() => this.setInformation(info));
      });
    });
  }
  private setInformation(info: VenueInformation): void {
    this.destinations.set(info.destinations.filter(d => d.hall).sort((a, b) => parseInt(a.hall!) - parseInt(b.hall!) || a.hall!.localeCompare(b.hall!)));
    this.details.set(info.details);
  }
  showDetails(id: string): void { if (!/^level[123]$|^hall\d+[A-Z]?$/.test(id) && !this.details()[id]) return; this.detailId.set(id); this.detailsVisible.set(true); this.selection.update(n => n + 1); }
  closeDetails(): void { this.detailsVisible.set(false); }
  view(id: string, details = true): void {
    this.zone.runOutsideAngular(() => this.viewer?.view(id));
    this.activeLevel.set(0); this.activeView.set(id); this.collapsed.set(false);
    if (details && id !== 'overview') this.showDetails(id); else this.closeDetails();
    this.status.set(this.details()[id]?.title || 'Bharat Mandapam');
  }
  selectLevel(level: number): void {
    this.zone.runOutsideAngular(() => this.viewer?.selectLevel(level));
    this.collapsed.set(false); this.activeView.set(''); this.activeLevel.set(level);
    this.showDetails('level' + level); this.status.set('Convention Centre · Level ' + level);
  }
  toggleGroup(group: 'cc' | 'halls'): void {
    const open = this.group() !== group; this.group.set(open ? group : null);
    if (group === 'cc') { if (open) this.view('cc'); else this.closeDetails(); }
    else { this.closeDetails(); if (open && this.viewer?.isGlobe) this.view('overview', false); }
  }
  overview(): void { this.group.set(null); this.view('overview', false); }
  private pick(id: string, level: number): void {
    if (level && id === 'cc') { this.showDetails('level' + level); return; }
    if (id.startsWith('hall')) this.group.set('halls');
    if (id === 'cc') this.group.set('cc');
    this.view(id);
  }
  globe(): void { this.closeDetails(); this.activeLevel.set(0); this.zone.runOutsideAngular(() => this.viewer?.goGlobe()); }
  zoom(factor: number): void { this.zone.runOutsideAngular(() => this.viewer?.zoom(factor)); }
  toggleLight(): void { this.daylight.update(value => !value); this.zone.runOutsideAngular(() => this.viewer?.setDaylight(this.daylight())); }
  retry(): void { if (this.loading.stages().venue.state === 'error') location.reload(); else void this.loading.retry(); }
  @HostListener('window:keydown', ['$event']) keyDown(event: KeyboardEvent): void { if (event.key === 'Escape' && !this.plan().isOpen) this.closeDetails(); }
  ngOnDestroy(): void { this.destroyed = true; this.loading.destroy(); this.zone.runOutsideAngular(() => this.viewer?.dispose()); }
}
