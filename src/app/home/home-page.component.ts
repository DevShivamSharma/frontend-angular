import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewEncapsulation, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VenueDataService } from './venue-data.service';
import { VenueLoadingState } from './venue-loading.state';
import { VenueLoadingComponent } from './venue-loading.component';
import { VenueDetailsComponent } from './venue-details.component';
import { FloorPlanDialogComponent } from './floor-plan-dialog.component';
import { Destination, VenueDetail, VenueInformation } from './venue.models';
import { VenueViewer, createVenueViewer } from './venue-viewer';
import { VenueAppearance } from './venue-appearance';

@Component({
  selector: 'app-home-page', standalone: true,
  imports: [RouterLink, VenueLoadingComponent, VenueDetailsComponent, FloorPlanDialogComponent],
  providers: [VenueDataService],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css', './home-page.component-2.css', './venue-appearance.css', './venue-gallery.css', './venue-loading.css', './venue-loading-2.css', './venue-globe-marker.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly plan = viewChild.required(FloorPlanDialogComponent);
  private readonly globeMarker = viewChild.required<ElementRef<HTMLButtonElement>>('globeMarker');
  private readonly homeButton = viewChild.required<ElementRef<HTMLButtonElement>>('homeButton');
  private markerPointer: { x: number; y: number } | null = null;
  private readonly zone = inject(NgZone);
  private readonly data = inject(VenueDataService);
  private viewer?: VenueViewer;
  private destroyed = false;
  readonly loading = new VenueLoadingState();
  readonly destinations = signal<Destination[]>([]);
  readonly details = signal<Record<string, VenueDetail>>({});
  readonly group = signal<'cc' | 'halls' | 'gates' | null>(null);
  readonly gates = signal<Destination[]>([]);
  readonly collapsed = signal(false);
  readonly activeView = signal('overview');
  readonly activeLevel = signal(0);
  readonly detailId = signal('');
  readonly detailsVisible = signal(false);
  readonly selection = signal(0);
  readonly status = signal('Bharat Mandapam');
  readonly daylight = signal(false);
  readonly appearance = signal<VenueAppearance>('natural');
  readonly appearanceBusy = signal(false);
  readonly appearanceError = signal('');
  readonly globeActive = signal(false);
  readonly globeAvailable = signal(true);
  readonly geographyReady = signal(false);
  readonly satelliteReady = signal(false);
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
          geographyReady: ready => this.zone.run(() => { this.geographyReady.set(ready); this.globeAvailable.set(ready); }),
          satelliteReady: () => this.zone.run(() => this.satelliteReady.set(true))
        }, this.globeMarker().nativeElement);
        const info = await this.viewer.ready;
        if (!this.destroyed) this.zone.run(() => this.setInformation(info));
      });
    });
  }
  private setInformation(info: VenueInformation): void {
    this.destinations.set(info.destinations.filter(d => d.hall).sort((a, b) => parseInt(a.hall!) - parseInt(b.hall!) || a.hall!.localeCompare(b.hall!)));
    this.gates.set(info.destinations.filter(d => d.gate).sort((a,b) => a.gate!.localeCompare(b.gate!, undefined, {numeric:true})));
    this.details.set(info.details);
  }
  showDetails(id: string): void { if (!/^level[123]$|^hall\d+[A-Z]?$/.test(id) && !this.details()[id]) return; this.detailId.set(id); this.detailsVisible.set(true); this.selection.update(n => n + 1); }
  closeDetails(): void { this.detailsVisible.set(false); }
  view(id: string, details = true): void {
    this.zone.runOutsideAngular(() => this.viewer?.view(id));
    this.activeLevel.set(0); this.activeView.set(id); this.collapsed.set(false);
    if (details && id !== 'overview' && !id.startsWith('gate')) this.showDetails(id); else this.closeDetails();
    this.status.set(this.gates().find(d => d.id === id)?.label || this.details()[id]?.title || 'Bharat Mandapam');
  }
  selectLevel(level: number): void {
    this.zone.runOutsideAngular(() => this.viewer?.selectLevel(level));
    this.collapsed.set(false); this.activeView.set(''); this.activeLevel.set(level);
    this.showDetails('level' + level); this.status.set('Convention Centre · Level ' + level);
  }
  toggleGroup(group: 'cc' | 'halls' | 'gates'): void {
    const open = this.group() !== group; this.group.set(open ? group : null);
    if (group === 'cc') { if (open) this.view('cc'); else this.closeDetails(); }
    else { this.closeDetails(); if (open && this.viewer?.isGlobe) this.view('overview', false); }
  }
  markerPointerDown(event: PointerEvent): void {
    this.markerPointer = { x: event.clientX, y: event.clientY };
  }
  enterVenueFromMarker(event: MouseEvent): void {
    const start = this.markerPointer;
    this.markerPointer = null;
    if (event.detail !== 0 && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    this.overview();
    this.homeButton().nativeElement.focus({ preventScroll: true });
  }
  overview(): void { this.group.set(null); this.view('overview', false); }
  private pick(id: string, level: number): void {
    if (level && id === 'cc') { this.showDetails('level' + level); return; }
    if (id.startsWith('gate')) this.group.set('gates');
    if (id.startsWith('hall')) this.group.set('halls');
    if (id === 'cc') this.group.set('cc');
    this.view(id);
  }
  globe(): void { this.closeDetails(); this.activeLevel.set(0); this.zone.runOutsideAngular(() => this.viewer?.goGlobe()); }
  zoom(factor: number): void { this.zone.runOutsideAngular(() => this.viewer?.zoom(factor)); }
  toggleLight(): void { this.daylight.update(value => !value); this.zone.runOutsideAngular(() => this.viewer?.setDaylight(this.daylight())); }
  async setAppearance(mode: VenueAppearance): Promise<void> {
    if (!this.viewer || this.appearanceBusy() || mode === this.appearance()) return;
    this.appearanceBusy.set(true); this.appearanceError.set('');
    try {
      await this.zone.runOutsideAngular(() => this.viewer!.setAppearance(mode));
      if (!this.destroyed) this.appearance.set(mode);
    } catch {
      if (!this.destroyed) this.appearanceError.set('Color materials could not load. Select Color to retry.');
    } finally { if (!this.destroyed) this.appearanceBusy.set(false); }
  }
  retry(): void { if (this.loading.stages().venue.state === 'error') location.reload(); else void this.loading.retry(); }
  @HostListener('window:keydown', ['$event']) keyDown(event: KeyboardEvent): void { if (event.key === 'Escape' && !this.plan().isOpen) this.closeDetails(); }
  ngOnDestroy(): void { this.destroyed = true; this.loading.destroy(); this.zone.runOutsideAngular(() => this.viewer?.dispose()); }
}
