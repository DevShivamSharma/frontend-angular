import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, NgZone, OnDestroy, ViewEncapsulation, afterNextRender, inject, signal, viewChild } from '@angular/core';
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
import { delhiTime, isVenueDaylight, isValidVenueTime } from './venue-clock';
import { InteriorState } from './venue-interiors';
import { INITIAL_VISITOR_STATE, VisitorInput, VisitorState } from './venue-visitor';
import { VenueDirectionsComponent } from './venue-directions.component';
import { Point } from './venue-route-geometry';
import { VenueMapComponent } from './venue-map.component';

const VENUE_VIEW_KEY = 'venue-explorer-view';
function storedVenueView(): '3d' | 'image' {
  try { return localStorage.getItem(VENUE_VIEW_KEY) === 'image' ? 'image' : '3d'; } catch { return '3d'; }
}

@Component({
  selector: 'app-home-page', standalone: true,
  imports: [RouterLink, NgTemplateOutlet, VenueLoadingComponent, VenueDetailsComponent, FloorPlanDialogComponent, VenueDirectionsComponent, VenueMapComponent],
  providers: [VenueDataService],
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css', './home-page.component-2.css', './venue-appearance.css', './venue-time.css', './venue-gallery.css', './venue-loading.css', './venue-loading-2.css', './venue-globe-marker.css', './venue-interiors.css', './venue-visitor-controls.css', './venue-visitor.css', './venue-directions.css'],
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly plan = viewChild.required(FloorPlanDialogComponent);
  private readonly globeMarker = viewChild.required<ElementRef<HTMLButtonElement>>('globeMarker');
  private readonly homeButton = viewChild.required<ElementRef<HTMLButtonElement>>('homeButton');
  private readonly placesMap = viewChild.required(VenueMapComponent);
  private markerPointer: { x: number; y: number } | null = null;
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly data = inject(VenueDataService);
  private viewer?: VenueViewer;
  private destroyed = false;
  readonly loading = new VenueLoadingState();
  readonly destinations = signal<Destination[]>([]);
  readonly details = signal<Record<string, VenueDetail>>({});
  readonly group = signal<'cc' | 'halls' | 'gates' | 'directions' | null>(null);
  /** The explorer is showing a walking route (route mode). */
  readonly routeActive = signal(false);
  readonly directionsTarget = signal('');
  readonly directionsRequest = signal(0);
  readonly gates = signal<Destination[]>([]);
  readonly collapsed = signal(false);
  readonly activeView = signal('overview');
  readonly activeLevel = signal(0);
  readonly detailId = signal('');
  readonly detailsVisible = signal(false);
  readonly selection = signal(0);
  readonly status = signal('Bharat Mandapam');
  readonly venueTime = signal(delhiTime());
  readonly liveTime = signal(true);
  readonly timeControlsOpen = signal(false);
  readonly daylight = signal(isVenueDaylight(this.venueTime()));
  readonly raining = signal(false);
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
  readonly visitor = signal<VisitorState>({ ...INITIAL_VISITOR_STATE });
  readonly visitorReady = signal(false);
  readonly visitorRouteExpanded = signal(false);
  readonly visitorDestinations = signal<{id:string;label:string}[]>([]);
  /** 3D explorer or the 2D image map phones use; remembered per browser. */
  readonly venueView = signal<'3d' | 'image'>(storedVenueView());
  /** The place last picked in either view (walkways-graph ids, which halls and gates share), so the other view opens on it. */
  readonly place = signal('');
  /** The 3D walking route, drawn on the image map when switching to it. */
  readonly route = signal<Point[] | null>(null);
  private placeFromImage = false;
  private readonly visitButton = viewChild<ElementRef<HTMLButtonElement>>('visitButton');
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
          visitorReady:destinations=>this.zone.run(()=>{this.visitorDestinations.set(destinations);this.visitorReady.set(true);}),
          routeEnded:()=>this.zone.run(()=>this.routeActive.set(false)),
          visitorState:state=>this.zone.run(()=>{
            if(this.destroyed)return;
            const wasActive=this.visitor().active;
            if(this.visitor().nearbyEntrance?.id!==state.nearbyEntrance?.id)this.visitorRouteExpanded.set(false);
            this.visitor.set(state);
            if(wasActive&&!state.active){this.activeView.set('overview');this.activeLevel.set(0);this.group.set(null);afterNextRender(()=>this.visitButton()?.nativeElement.focus({preventScroll:true}),{injector:this.injector});}
          }),
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
        }, this.globeMarker().nativeElement, this.placesMap().pinLayer()?.nativeElement);
        if (this.venueView() === 'image') this.viewer.setPaused(true);
        const info = await this.viewer.ready;
        if (!this.destroyed) this.zone.run(() => { this.setInformation(info); this.followDelhiClock(); });
      });
    });
  }
  private clockTimer?: ReturnType<typeof setInterval>;
  private followDelhiClock(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.syncVenueClock(true);
    // Poll outside Angular; update the UI only when the displayed minute changes.
    this.zone.runOutsideAngular(() => {
      this.clockTimer = setInterval(() => this.syncVenueClock(), 1000);
    });
  }
  private syncVenueClock(force = false): void {
    if (this.destroyed) return;
    const time = this.liveTime() ? delhiTime() : this.venueTime();
    if (force || time !== this.venueTime()) this.zone.run(() => this.applyVenueTime(time, force));
  }
  private applyVenueTime(time: string, force = false): void {
    this.venueTime.set(time);
    const day = isVenueDaylight(time);
    if (force || day !== this.daylight()) {
      this.daylight.set(day);
      this.zone.runOutsideAngular(() => this.viewer?.setDaylight(day));
    }
  }
  setManualTime(time: string): void {
    if (!isValidVenueTime(time)) return;
    this.liveTime.set(false);
    this.applyVenueTime(time);
  }
  resumeLiveTime(): void {
    this.liveTime.set(true);
    this.syncVenueClock(true);
  }
  @HostListener('window:focus')
  @HostListener('window:pageshow')
  resumeVenueClock(): void { this.syncVenueClock(); }
  @HostListener('document:visibilitychange')
  visibilityChanged(): void { if (!document.hidden) this.syncVenueClock(); }
  private setInformation(info: VenueInformation): void {
    this.destinations.set(info.destinations.filter(d => d.hall).sort((a, b) => parseInt(a.hall!) - parseInt(b.hall!) || a.hall!.localeCompare(b.hall!)));
    this.gates.set(info.destinations.filter(d => d.gate).sort((a,b) => a.gate!.localeCompare(b.gate!, undefined, {numeric:true})));
    this.details.set(info.details);
  }
  showDetails(id: string): void { if (!/^level[123]$|^hall\d+[A-Z]?$/.test(id) && !this.details()[id]) return; this.detailId.set(id); this.detailsVisible.set(true); this.selection.update(n => n + 1); }
  closeDetails(): void { this.detailsVisible.set(false); }
  view(id: string, details = true): void {
    this.zone.runOutsideAngular(() => this.viewer?.view(id));
    this.place.set(id === 'overview' ? '' : id);
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
  /** Show a submitted walking route in route mode, or leave route mode when it is withdrawn. */
  showRoute(points: Point[] | null): void {
    this.route.set(points);
    if (points) {
      this.closeDetails(); this.activeView.set(''); this.activeLevel.set(0); this.routeActive.set(true); this.status.set('Walking route');
      this.zone.runOutsideAngular(() => this.viewer?.showRoute(points));
    } else if (this.routeActive()) this.zone.runOutsideAngular(() => this.viewer?.clearRoute());
  }
  /** "Directions here" from a hall's or the CC's options: open the planner with it as the destination. */
  directionsTo(id: string): void {
    this.group.set('directions'); this.collapsed.set(false);
    this.directionsTarget.set(id.startsWith('cc-level') ? 'cc' : id); this.directionsRequest.update(n => n + 1);
  }
  toggleGroup(group: 'cc' | 'halls' | 'gates' | 'directions'): void {
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
  /** A map pin: places the explorer has a view for fly there; the rest only name themselves. */
  pickPlace(id: string): void {
    if (this.details()[id] || this.gates().some(gate => gate.id === id)) this.pick(id, 0);
    else this.status.set(this.placesMap().places().find(place => place.id === id)?.label ?? 'Bharat Mandapam');
    this.place.set(id);
  }
  /** A place picked on the image map is shown in 3D when switching back. */
  imagePicked(id: string): void { this.place.set(id); this.placeFromImage = true; }
  setVenueView(view: '3d' | 'image'): void {
    if (view === this.venueView()) return;
    this.venueView.set(view);
    try { localStorage.setItem(VENUE_VIEW_KEY, view); } catch { /* storage blocked: the choice lasts this visit */ }
    this.zone.runOutsideAngular(() => this.viewer?.setPaused(view === 'image'));
    if (view === '3d' && this.placeFromImage && this.place()) this.pickPlace(this.place());
    this.placeFromImage = false;
  }
  globe(): void { this.closeDetails(); this.activeLevel.set(0); this.zone.runOutsideAngular(() => this.viewer?.goGlobe()); }
  zoom(factor: number): void { this.zone.runOutsideAngular(() => this.viewer?.zoom(factor)); }
  toggleRain(): void { this.raining.update(value => !value); this.zone.runOutsideAngular(() => this.viewer?.setRain(this.raining())); }
  toggleLight(): void { this.setManualTime(this.daylight() ? '21:00' : '12:00'); }
  startVisitor():void { this.closeDetails();this.group.set(null);this.zone.runOutsideAngular(()=>this.viewer?.startVisitor()); }
  stopVisitor():void { this.zone.runOutsideAngular(()=>this.viewer?.stopVisitor()); }
  visitorHold(input:VisitorInput,event:PointerEvent,down:boolean):void {
    event.preventDefault();
    if(down)(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.zone.runOutsideAngular(()=>this.viewer?.visitorInput(input,down));
  }
  visitorRelease(input:VisitorInput):void {this.zone.runOutsideAngular(()=>this.viewer?.visitorInput(input,false));}
  visitorClick(input:VisitorInput,event:MouseEvent):void {if(event.detail===0)this.zone.runOutsideAngular(()=>this.viewer?.visitorStep(input));}
  visitorDestination(id:string):void {this.zone.runOutsideAngular(()=>this.viewer?.visitorDestination(id));}
  visitorEnter():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorEnter());}
  visitorJump():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorJump());}
  visitorGo():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorGo());}
  visitorStopAutoWalk():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorStopAutoWalk());}
  visitorFaster():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorFaster());}
  visitorRestart():void {this.zone.runOutsideAngular(()=>this.viewer?.visitorRestart());}
  visitorFloor(level:number):void {this.zone.runOutsideAngular(()=>this.viewer?.visitorFloor(level));}
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
  ngOnDestroy(): void {
    this.destroyed = true; this.loading.destroy();
    if (this.clockTimer) clearInterval(this.clockTimer);
    const viewer = this.viewer; this.viewer = undefined;
    this.zone.runOutsideAngular(() => viewer?.dispose());
  }
}
