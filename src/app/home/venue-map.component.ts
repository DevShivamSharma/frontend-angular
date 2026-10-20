import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewEncapsulation, computed, signal, viewChild } from '@angular/core';
import { VenueDetail, venueAsset } from './venue.models';
import { parseMapGraph } from './venue-route-graph';
import { NAVIGATION_LOCATIONS, availableLocations } from './venue-route-locations';

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
@Component({ selector: 'section[appVenueMap]', standalone: true, imports: [NgTemplateOutlet], templateUrl: './venue-map.component.html', styleUrl: './venue-map.css',
  encapsulation: ViewEncapsulation.ShadowDom, changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-label': 'Venue map', '[class.overlay]': "mode === 'overlay'" } })
export class VenueMapComponent implements OnInit {
  @Input() mode: 'image' | 'overlay' = 'image';
  @Output() readonly picked = new EventEmitter<string>();
  readonly pinLayer = viewChild<ElementRef<HTMLElement>>('pinLayer');
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  readonly map = signal<MapImage | null>(null);
  readonly places = signal<MapPlace[]>([]);
  readonly groups = signal<{ id: string; title: string }[]>([]);
  readonly details = signal<Record<string, VenueDetail>>({});
  readonly error = signal('');
  readonly group = signal('');
  readonly query = signal('');
  readonly labels = signal(true);
  readonly selected = signal<MapPlace | null>(null);
  readonly zoom = signal(1);
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

  ngOnInit(): void { void this.load(); }
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
    } catch { this.error.set('The venue map could not load. Check your connection and retry.'); }
  }

  select(place: MapPlace, focus = false): void {
    this.query.set('');
    if (this.group() && place.group !== this.group()) this.group.set('');
    if (this.mode === 'overlay') { this.picked.emit(place.id); return; }
    this.selected.set(place);
    if (focus) this.focus(place);
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
}
