import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewEncapsulation, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { VenueDataService } from './venue-data.service';
import { VenueLoadingState } from './venue-loading.state';
import { VenueLoadingComponent } from './venue-loading.component';
import { VenueDetailsComponent } from './venue-details.component';
import { FloorPlanDialogComponent } from './floor-plan-dialog.component';
import { Destination, VenueDetail, VenueInformation } from './venue.models';
import { VenueViewer, createVenueViewer } from './venue-viewer';
import { VenueAppearance, VenueScenery } from './venue-appearance';
import { InteriorState } from './venue-interiors';

@Component({
  selector: 'app-home-page', standalone: true,
  imports: [RouterLink, NgTemplateOutlet, VenueLoadingComponent, VenueDetailsComponent, FloorPlanDialogComponent],
  providers: [VenueDataService],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css', './home-page.component-2.css', './venue-appearance.css', './venue-gallery.css', './venue-loading.css', './venue-loading-2.css', './venue-globe-marker.css', './venue-interiors.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
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
  readonly scenery = signal<VenueScenery>('satellite');
  readonly appearanceError = signal('');
  readonly globeActive = signal(false);
  readonly globeAvailable = signal(true);
  readonly geographyReady = signal(false);
  readonly satelliteReady = signal(false);
  readonly interiorHalls = signal<{id:string;label:string;rooms?:{id:string;label:string}[]}[]>([]);
  readonly interiorHall = signal('hall1');
  readonly menuInterior = signal('');
  readonly interiorRoom = signal('');
  readonly interior = signal<InteriorState>({hall:'',walking:false,touring:false,paused:false});
  readonly interiorError = signal('');
  readonly exportingHall = signal(false);
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
          satelliteReady: () => this.zone.run(() => this.satelliteReady.set(true)),
          interiorsReady:(halls,error)=>this.zone.run(()=>{this.interiorHalls.set(halls);this.interiorError.set(error??'');}),
          interiorState:state=>this.zone.run(()=>{
            const previous=this.interior();this.interior.set(state);
            if(!state.walking||state.hall!==previous.hall)this.interiorRoom.set('');
            if(state.hall){
              this.interiorHall.set(state.hall);this.menuInterior.set(state.hall);
              if(state.hall.startsWith('cc-level')){this.activeLevel.set(Number(state.hall.slice(-1)));this.activeView.set('');this.group.set('cc');}
              else{this.activeView.set(state.hall);this.activeLevel.set(0);this.group.set('halls');}
              if(previous.hall!==state.hall){this.collapsed.set(false);this.revealWalkthrough();}
              this.closeDetails();
            }
          })
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
    this.menuInterior.set(id.startsWith('hall')?id:'');if(id.startsWith('hall')){this.interiorHall.set(id);this.interiorRoom.set('');}
    if (details && id !== 'overview' && !id.startsWith('gate')) this.showDetails(id); else this.closeDetails();
    this.status.set(this.gates().find(d => d.id === id)?.label || this.details()[id]?.title || 'Bharat Mandapam');
  }
  selectLevel(level: number): void {
    this.zone.runOutsideAngular(() => this.viewer?.selectLevel(level));
    this.collapsed.set(false); this.activeView.set(''); this.activeLevel.set(level);
    this.group.set('cc');this.menuInterior.set('cc-level'+level);this.interiorHall.set('cc-level'+level);this.interiorRoom.set('');this.closeDetails();this.revealWalkthrough(); this.status.set('Convention Centre · Level ' + level);
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
  hasInterior(id:string):boolean{return this.interiorHalls().some(h=>h.id===id);}
  isWalking(id:string):boolean{return this.interior().walking&&this.interior().hall===id;}
  roomsFor(id:string){return this.interiorHalls().find(h=>h.id===id)?.rooms??[];}
  private revealWalkthrough():void{requestAnimationFrame(()=>{if(this.destroyed)return;this.menu()?.nativeElement.querySelector('.venue-interior-actions')?.scrollIntoView({block:'nearest'});});}
  selectHall(id:string):void{this.group.set('halls');this.view(id,false);this.revealWalkthrough();}
  startWalkthrough(id:string,guided=false):void{this.interiorHall.set(id);this.interiorRoom.set('');this.menuInterior.set(id);this.enterInterior(guided);this.revealWalkthrough();}
  visitRoom(id:string,room:string):void{this.interiorHall.set(id);this.visitCCRoom(room);}
  interiorOverview(id:string):void{if(id.startsWith('cc-level'))this.selectLevel(Number(id.slice(-1)));else this.selectHall(id);}
  openInteriorPlan(id:string):void{const key=id.startsWith('cc-level')?'level'+id.slice(-1):id;const detail=this.details()[key];if(detail)this.plan().open(detail);}
  showInteriorDetails(id:string):void{this.showDetails(id.startsWith('cc-level')?'level'+id.slice(-1):id);}
  enterInterior(guided=false):void {this.closeDetails();this.zone.runOutsideAngular(()=>this.viewer?.enterHall(this.interiorHall(),guided));}
  visitCCRoom(id:string):void{this.interiorRoom.set(id);if(id)this.zone.runOutsideAngular(()=>this.viewer?.visitRoom(this.interiorHall(),id));}
  pauseInterior():void {this.zone.runOutsideAngular(()=>this.viewer?.pauseTour());}
  leaveInterior():void {this.zone.runOutsideAngular(()=>this.viewer?.leaveInterior());this.collapsed.set(false);}
  walk(forward:number,turn=0):void {this.zone.runOutsideAngular(()=>this.viewer?.walk(forward,turn));}
  async exportInterior(id=this.interiorHall()):Promise<void> {
    if(!this.viewer||this.exportingHall())return;this.exportingHall.set(true);this.interiorError.set('');
    try{const bytes=await this.zone.runOutsideAngular(()=>this.viewer!.exportHall(id));if(this.destroyed)return;
      const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download=`bharat-mandapam-${id}.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{if(!this.destroyed)this.interiorError.set('The interior could not be exported. Please retry.');}finally{if(!this.destroyed)this.exportingHall.set(false);}
  }
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
  setScenery(scenery: VenueScenery): void { this.scenery.set(scenery); this.zone.runOutsideAngular(() => this.viewer?.setScenery(scenery)); }
  retry(): void { if (this.loading.stages().venue.state === 'error') location.reload(); else void this.loading.retry(); }
  @HostListener('window:keydown', ['$event']) keyDown(event: KeyboardEvent): void { if (event.key === 'Escape' && !this.plan().isOpen) this.closeDetails(); }
  ngOnDestroy(): void { this.destroyed = true; this.loading.destroy(); this.zone.runOutsideAngular(() => this.viewer?.dispose()); }
}
