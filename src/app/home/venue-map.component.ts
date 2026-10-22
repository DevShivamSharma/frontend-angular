import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnDestroy, OnInit, Output, ViewEncapsulation, computed, inject, signal, viewChild } from '@angular/core';
import { VenueDetail, venueAsset } from './venue.models';
import { parseMapGraph } from './venue-route-graph';
import { NAVIGATION_LOCATIONS, availableLocations } from './venue-route-locations';
import { Point, RouteGeometry, buildRouteGeometry, positionAtDistance, roundCorners } from './venue-route-geometry';
import { VenueDirectionsComponent } from './venue-directions.component';

/** A pin: a walkways-graph point (venue-walkways.json) in its picker group, with its spot on the map image. */
export interface MapPlace { id: string; label: string; group: string; x: number; y: number; z: number; u: number; v: number; }
interface MapImage { image: string; size: [number, number]; worldToImage: { u: number[]; v: number[] }; attribution: string; }

/** Pin height above the ground in metres, so labels sit on roofs in the 3D view. */
const PIN_HEIGHT: Record<string, number> = { halls: 26, conventionCentre: 50 };
const MAX_ZOOM = 6;
/** Chip order of the ITPO app's map; other groups follow. */
const CHIP_ORDER = ['halls', 'gates', 'conventionCentre', 'amphitheatres', 'parking'];
const LABEL_RANK: Record<string, number> = { halls: 1, conventionCentre: 1, gates: 2, amphitheatres: 3, parking: 3 };

/**
 * The venue map in the ITPO app's style: search, group chips, pins with labels, details on tap.
 * `image` mode is the 2D satellite map shown on phones instead of the 3D model; `overlay` mode only
 * renders the pins and filters, and the 3D viewer moves `pinLayer`'s pins over their world points.
 */
@Component({ selector: 'section[appVenueMap]', standalone: true, imports: [NgTemplateOutlet, VenueDirectionsComponent], templateUrl: './venue-map.component.html', styleUrl: './venue-map.css',
  encapsulation: ViewEncapsulation.ShadowDom, changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-label': 'Venue map', '[class.overlay]': "mode === 'overlay'", '[class.routing]': 'directions()' } })
export class VenueMapComponent implements OnInit, OnDestroy {
  @Input() mode: 'image' | 'overlay' = 'image';
  /** Image mode on the web: open on this place, and draw this route, carried over from the 3D explorer. */
  @Input() initialPlace = '';
  @Input() initialRoute: Point[] | null = null;
  @Output() readonly picked = new EventEmitter<string>();
  readonly pinLayer = viewChild<ElementRef<HTMLElement>>('pinLayer');
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly head = viewChild<ElementRef<HTMLElement>>('head');
  private readonly walker = viewChild<ElementRef<SVGGElement>>('walker');
  private readonly zone = inject(NgZone);
  readonly map = signal<MapImage | null>(null);
  readonly places = signal<MapPlace[]>([]);
  readonly groups = signal<{ id: string; title: string }[]>([]);
  readonly details = signal<Record<string, VenueDetail>>({});
  readonly error = signal('');
  readonly group = signal('');
  readonly query = signal('');
  readonly labels = signal(true);
  readonly selected = signal<MapPlace | null>(null);
  /** The hint shows until the first touch on the map. */
  readonly touched = signal(false);
  readonly zoom = signal(1);
  /** The Directions sheet (image mode): `target` and `request` feed its destination, as the 3D explorer's "Directions here" does. */
  readonly directions = signal(false);
  readonly target = signal('');
  readonly request = signal(0);
  /** The walking route on the image, in image pixels. */
  readonly route = signal<{ u: number; v: number }[]>([]);
  readonly routeLine = computed(() => this.route().map(({ u, v }) => u + ',' + v).join(' '));
  readonly pan = signal<[number, number]>([0, 0]);
  readonly shown = computed(() => this.places().filter(place => !this.group() || place.group === this.group()));
  readonly results = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query ? this.places().filter(place => place.label.toLowerCase().includes(query)).slice(0, 6) : [];
  });
  readonly attribution = computed(() => this.map()?.attribution ?? '');
  readonly width = signal(innerWidth);
  /** Labels that fit without overlapping at the current zoom, halls and the CC first; the rest show when zoomed in. */
  readonly labelled = computed(() => {
    const map = this.map(), scale = this.width() / (map?.size[0] ?? 1) * this.zoom(), boxes: number[][] = [], ids = new Set<string>();
    const rank = (place: MapPlace) => place.id === this.selected()?.id ? 0 : (LABEL_RANK[place.group] ?? 9);
    for (const place of [...this.shown()].sort((a, b) => rank(a) - rank(b))) {
      // shortcut: label width is estimated from its length (6 px a character at 11 px bold); measure the DOM if labels clip.
      const w = place.label.length * 6 + 14, x = place.u * scale - w / 2, y = place.v * scale + 2;
      if (boxes.some(([bx, by, bw]) => x < bx + bw && bx < x + w && y < by + 18 && by < y + 18)) continue;
      boxes.push([x, y, w]); ids.add(place.id);
    }
    return ids;
  });
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private walk?: { route: RouteGeometry; speed: number; progress: number; last: number; frame: number };

  ngOnInit(): void { void this.load(); }
  ngOnDestroy(): void { this.stopWalk(); }
  @HostListener('window:resize') resized(): void { this.width.set(innerWidth); }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const get = async (path: string) => { const response = await fetch(venueAsset(path)); if (!response.ok) throw new Error(path); return response.json(); };
      const [graphData, map, details] = await Promise.all([get('venue-walkways.json'), get('geography/satellite/venue-map.json'),
        this.mode === 'image' ? get('venue-details.json?v=rooms-1') : Promise.resolve({})]);
      const graph = parseMapGraph(graphData), { u, v } = (map as MapImage).worldToImage;
      const locations = availableLocations(graph.nodeMap, NAVIGATION_LOCATIONS);
      this.places.set(locations.flatMap(location => location.nodeIds.map(id => {
        const { label, x, z } = graph.nodeMap[id];
        return { id, label, group: location.id, x, y: PIN_HEIGHT[location.id] ?? 6, z, u: u[0] * x + u[1] * z + u[2], v: v[0] * x + v[1] * z + v[2] };
      })));
      const order = (id: string) => (CHIP_ORDER.indexOf(id) + 1) || 99;
      this.groups.set(locations.map(({ id, title }) => ({ id, title })).sort((a, b) => order(a.id) - order(b.id)));
      this.details.set(details as Record<string, VenueDetail>);
      this.map.set(map as MapImage);
      // Open on the halls and the CC rather than the whole image, so a phone screen is filled and labels are readable.
      const start = this.places().find(place => place.id === this.initialPlace);
      if (this.mode === 'image' && start) { this.selected.set(start); this.focus(start); }
      else if (this.mode === 'image') this.fitTo(this.main());
      if (this.mode === 'image' && this.initialRoute) this.showRoute(this.initialRoute);
    } catch { this.error.set('The venue map could not load. Check your connection and retry.'); }
  }

  select(place: MapPlace, focus = false): void {
    this.query.set('');
    if (this.group() && place.group !== this.group()) this.group.set('');
    this.picked.emit(place.id);
    if (this.mode === 'overlay') return;
    this.selected.set(place);
    if (focus) this.focus(place); else this.reveal(place);
  }

  /** Keep a tapped pin clear of the place sheet at the bottom and the search at the top. */
  private reveal(place: MapPlace): void {
    const map = this.map(), box = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!map || !box) return;
    const [x, y] = this.pan(), top = box.height / 2 + y + (place.v / map.size[1] - .5) * box.width * map.size[1] / map.size[0] * this.zoom();
    const shift = Math.max(0, 140 - top) - Math.max(0, top - (box.height - 240));
    if (shift) this.setPan(x, y + shift);
  }

  /** Centre a place at a readable zoom. */
  private focus(place: MapPlace): void {
    const map = this.map(), box = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!map || !box) return;
    const scale = Math.max(this.zoom(), 2.5);
    this.zoom.set(scale);
    this.setPan(-(place.u / map.size[0] - .5) * box.width * scale, -(place.v / map.size[1] - .5) * box.width * map.size[1] / map.size[0] * scale);
  }

  /** Zoom by `factor` keeping viewport point (x, y), measured from the viewport centre, still. */
  zoomBy(factor: number, x = 0, y = 0): void {
    const next = Math.min(MAX_ZOOM, Math.max(1, this.zoom() * factor)), k = next / this.zoom(), [px, py] = this.pan();
    this.zoom.set(next);
    this.setPan(x - (x - px) * k, y - (y - py) * k);
  }

  fit(): void { this.zoom.set(1); this.pan.set([0, 0]); }

  /** A chip filters the pins and frames them; All frames the halls and the CC, as on opening. */
  showGroup(id: string): void {
    this.group.set(id);
    this.fitTo(id ? this.shown() : this.main());
  }

  /** Open the Directions sheet, routing to `place` when given. */
  openDirections(place?: MapPlace): void {
    if (place) { this.target.set(place.id); this.request.update(n => n + 1); }
    this.selected.set(null);
    this.touched.set(true);
    this.directions.set(true);
  }

  /** Closing the sheet ends the directions; the panel resets its form when no longer active. */
  closeDirections(): void { this.directions.set(false); this.showRoute(null); }

  /** Draw the panel's route (world metres) on the image and frame it once the sheet has folded to its summary. */
  showRoute(points: Point[] | null): void {
    const map = this.map();
    this.stopWalk();
    if (!points || !map) { this.route.set([]); return; }
    // Rounded as the 3D track rounds them (venue-route-track.ts), so the walker keeps to the drawn line.
    const route = buildRouteGeometry(roundCorners(points, 6));
    this.route.set(route.points.map(point => this.toImage(point)));
    requestAnimationFrame(() => this.fitTo(this.route()));
    if (!route.segments.length) return;
    // The 3D track's pace: a long route is walked in ~25 s, a short one at no less than 6 m/s.
    this.walk = { route, speed: Math.min(45, Math.max(6, route.totalLength / 25)), progress: 0, last: 0, frame: 0 };
    this.zone.runOutsideAngular(() => this.walk!.frame = requestAnimationFrame(now => this.step(now)));
  }

  private toImage({ x, z }: Point): { u: number; v: number } {
    const { u, v } = this.map()!.worldToImage;
    return { u: u[0] * x + u[1] * z + u[2], v: v[0] * x + v[1] * z + v[2] };
  }

  /** One frame of the visitor walking the route, start to end and round again; it stands at the start under reduced motion. */
  private step(now: number): void {
    const walk = this.walk, map = this.map(), walker = this.walker()?.nativeElement;
    if (!walk || !map) return;
    walk.frame = requestAnimationFrame(next => this.step(next));
    if (!walker) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, dt = walk.last ? Math.min(.1, (now - walk.last) / 1000) : 0;
    walk.last = now;
    if (!still) walk.progress = (walk.progress + dt * walk.speed) % walk.route.totalLength;
    const head = positionAtDistance(walk.route, walk.progress, { x: 0, z: 0, yaw: 0 })!, at = this.toImage(head);
    // The heading in image space: a metre ahead along the segment, mapped like the point itself.
    const ahead = this.toImage({ x: head.x + Math.sin(head.yaw), z: head.z + Math.cos(head.yaw) });
    const angle = Math.atan2(ahead.v - at.v, ahead.u - at.u) * 180 / Math.PI, scale = map.size[0] / (this.width() * this.zoom());
    walker.setAttribute('transform', `translate(${at.u} ${at.v}) rotate(${angle}) scale(${scale})`);
    // Feet swing about three steps a second.
    walker.style.setProperty('--stride', String(still ? 0 : Math.sin(now / 1000 * 6 * Math.PI)));
  }

  private stopWalk(): void { if (this.walk) cancelAnimationFrame(this.walk.frame); this.walk = undefined; }

  private main(): MapPlace[] { return this.places().filter(place => LABEL_RANK[place.group] === 1); }

  /**
   * Zoom and centre so the places fill the viewport below the floating search and chips, leaving room for the controls
   * (the viewport div is always rendered); at most a readable 3x.
   */
  private fitTo(places: { u: number; v: number }[]): void {
    const map = this.map(), box = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!map || !box || !places.length) return;
    const [w, h] = map.size, us = places.map(place => place.u), vs = places.map(place => place.v);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    // A hidden header (while routing) measures 0, so nothing is covered.
    const height = box.width * h / w, top = Math.max(0, (this.head()?.nativeElement.getBoundingClientRect().bottom ?? 0) - box.top);
    const scale = Math.min(3, Math.max(1, Math.min(.8 * w / (u1 - u0 || 1), .7 * (box.height - top) / height * h / (v1 - v0 || 1))));
    this.zoom.set(scale);
    this.setPan(-((u0 + u1) / 2 / w - .5) * box.width * scale, -((v0 + v1) / 2 / h - .5) * height * scale + top / 2);
  }

  private setPan(x: number, y: number): void {
    const box = this.viewport()?.nativeElement.getBoundingClientRect(), map = this.map();
    if (!box || !map) return;
    // The image may move until its edge reaches the viewport centre, never off screen.
    const w = box.width * this.zoom() / 2, h = box.width * map.size[1] / map.size[0] * this.zoom() / 2;
    this.pan.set([Math.max(-w, Math.min(w, x)), Math.max(-h, Math.min(h, y))]);
  }

  private local(event: { clientX: number; clientY: number }): [number, number] {
    const box = this.viewport()!.nativeElement.getBoundingClientRect();
    return [event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2];
  }

  pointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) this.dragged = false;
    this.touched.set(true);
  }

  pointerMove(event: PointerEvent): void {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()], other = a === last ? b : a;
      const before = Math.hypot(last.x - other.x, last.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 0) this.zoomBy(after / before, ...this.local({ clientX: (event.clientX + other.x) / 2, clientY: (event.clientY + other.y) / 2 }));
    } else {
      const dx = event.clientX - last.x, dy = event.clientY - last.y;
      // Capture only once it is a drag, so a tap still reaches the pin under it.
      if (!this.dragged && Math.hypot(dx, dy) < 4) return;
      if (!this.dragged) { this.dragged = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
      const [x, y] = this.pan();
      this.setPan(x + dx, y + dy);
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  pointerUp(event: PointerEvent): void { this.pointers.delete(event.pointerId); }

  wheel(event: WheelEvent): void { event.preventDefault(); this.zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2, ...this.local(event)); }

  groupTitle(id: string): string { return this.groups().find(item => item.id === id)?.title ?? ''; }

  /** A drag that ends on a pin is not a tap. */
  tap(place: MapPlace): void { if (!this.dragged) this.select(place); }

  /** A tap on the map itself, not on a pin, closes the details card. */
  mapClick(event: MouseEvent): void { if (!this.dragged && !(event.target as Element).closest('.map-pin')) this.selected.set(null); }
}
