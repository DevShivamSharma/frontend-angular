import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, computed, signal } from '@angular/core';
import { venueAsset } from './venue.models';
import { MapEdge, MapGraph, MapNode, VenueGate, createMapGraph, gateSuffix, parseMapGraph, parseVenueGates, resolveGateAccess, visitorGateOverrides } from './venue-route-graph';
import { buildAdjacency } from './venue-route-pathfinding';
import { LocationSelection, NAVIGATION_LOCATIONS, NavigationLocation, availableLocations, defaultSelection, findLocation, selectionForNode } from './venue-route-locations';
import { Journey, JourneyProblem, planJourney, problemMessage, walkingMeters, walkingMinutes } from './venue-route-journey';
import { Point, SatelliteFit, fenceTest, journeyPolyline, worldFromLatLon } from './venue-route-geometry';

const byTitle = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/** "Gate" for Gates: the group's title, singular. */
const pointNoun = (location: NavigationLocation) => location.title.replace(/s$/i, '');
/** The Source option for the visitor's own position, and the graph node it becomes. */
const MY_LOCATION = 'me|me';
/** A fix less sure than this, or this close to the fence, asks the visitor which side they are on. */
const SURE_FIX_METRES = 50, FENCE_DOUBT_METRES = 30;
/** Further than this from every walkway, a fix is not at the venue and is not routed from. */
const MAX_LINK_METRES = 1500;

type Locating = { state: 'finding' } | { state: 'ask'; at: Point } | { state: 'error'; message: string };

/**
 * Source / Destination route planner, re-created from the ITPO app's CampusNavigationScreen. One picker per
 * end: a group (Gates, Halls, ...) is an option group led by its closest point, so a phone needs one tap per end.
 * Show route draws the walk and folds the form into a one-line summary; changing either end hides the route.
 */
@Component({ selector: 'section[appVenueDirections]', standalone: true, imports: [NgTemplateOutlet], templateUrl: './venue-directions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'venue-interior-actions venue-directions', 'aria-label': 'Walking directions' } })
export class VenueDirectionsComponent implements OnInit, OnChanges {
  /** False once the explorer leaves route mode (another view, the globe, a visit); the form then reopens. */
  @Input() active = false;
  /** A place to route to, e.g. from a hall's "Directions here"; `request` changes on every ask. */
  @Input() destinationNode = '';
  @Input() request = 0;
  @Output() readonly route = new EventEmitter<Point[] | null>();
  readonly graph = signal<MapGraph | null>(null);
  readonly error = signal('');
  readonly source = signal<LocationSelection | undefined>(undefined);
  readonly destination = signal<LocationSelection | undefined>(undefined);
  private readonly submitted = signal<{ source: LocationSelection; destination: LocationSelection } | null>(null);
  readonly folded = signal(false);
  /** venue-gates.json rows, and the fence and satellite fit from venue-walkways.json for "Use my location". */
  private readonly gates = signal<VenueGate[]>([]);
  private fence: [number, number][] = [];
  private satellite?: SatelliteFit;
  /** The visitor's position as a graph node with its link onto the nearest walkway on their side of the fence. */
  private readonly me = signal<{ node: MapNode; edge: MapEdge } | null>(null);
  readonly locating = signal<Locating | null>(null);
  readonly routeGraph = computed(() => {
    const g = this.graph(), me = this.me();
    return g && me ? createMapGraph([...g.nodes, me.node], [...g.edges, me.edge]) : g;
  });
  readonly gateAccess = computed(() => { const g = this.graph(); return g ? resolveGateAccess(visitorGateOverrides(this.gates()), g.nodes) : {}; });
  readonly adjacency = computed(() => { const g = this.routeGraph(); return g ? buildAdjacency(g.edges, this.gateAccess(), g.nodeMap) : {}; });
  readonly insideAdjacency = computed(() => {
    const g = this.routeGraph();
    return g ? buildAdjacency(g.edges.filter(edge => !g.nodeMap[edge.from].outside && !g.nodeMap[edge.to].outside), this.gateAccess(), g.nodeMap) : {};
  });
  readonly locations = computed(() => { const g = this.graph(); return g ? availableLocations(g.nodeMap, NAVIGATION_LOCATIONS) : []; });
  readonly isSubmitted = computed(() => {
    const s = this.submitted(), a = this.source(), b = this.destination();
    return !!s && !!a && !!b && s.source.locationId === a.locationId && s.source.pointId === a.pointId &&
      s.destination.locationId === b.locationId && s.destination.pointId === b.pointId;
  });
  readonly plan = computed(() => {
    const g = this.routeGraph(), a = this.source(), b = this.destination();
    if (!g || !a || !b || !this.isSubmitted()) return null;
    return planJourney(a, b, { locations: this.locations(), adjacency: this.adjacency(), insideAdjacency: this.insideAdjacency(), nodeMap: g.nodeMap, gateAccess: this.gateAccess() });
  });
  readonly journey = computed<Journey | null>(() => { const p = this.plan(); return p && 'journey' in p ? p.journey : null; });
  readonly problem = computed<JourneyProblem | null>(() => { const p = this.plan(); return p && 'problem' in p ? p.problem : null; });
  /** My location counts as chosen only once it is placed. */
  private readonly placed = (selection: LocationSelection | undefined) => !!selection && (this.selectionValue(selection) !== MY_LOCATION || !!this.me());
  readonly canSubmit = computed(() => this.placed(this.source()) && this.placed(this.destination()) && !this.isSubmitted());
  readonly problemMessage = problemMessage;
  readonly myLocation = MY_LOCATION;

  async ngOnInit(): Promise<void> {
    try {
      const get = async (path: string) => { const response = await fetch(venueAsset(path)); if (!response.ok) throw new Error(path); return response.json(); };
      const [walkways, gates] = await Promise.all([get('venue-walkways.json'), get('venue-gates.json')]);
      this.fence = walkways.fence ?? [];
      this.satellite = walkways.satellite;
      this.gates.set(parseVenueGates(gates));
      this.graph.set(parseMapGraph(walkways));
      this.applyDestinationRequest();
    } catch { this.error.set('Walking routes could not load. Reload to retry.'); }
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['active'] && !this.active && this.submitted()) { this.submitted.set(null); this.folded.set(false); }
    if (changes['request'] && this.request) this.applyDestinationRequest();
  }
  private applyDestinationRequest(): void {
    if (!this.destinationNode || !this.graph()) return;
    const selection = selectionForNode(this.destinationNode, this.locations());
    if (selection) { this.destination.set(selection); this.folded.set(false); this.hideRoute(); }
  }

  locationOptions(other: LocationSelection | undefined) {
    // A single-point location picked on the other side is not offered here; groups stay.
    const taken = findLocation(other?.locationId, this.locations());
    return this.locations().filter(item => !(item.id === taken?.id && item.nodeIds.length === 1))
      .map(item => ({ value: item.id, label: item.title })).sort((a, b) => byTitle(a.label, b.label));
  }
  pointOptions(selection: LocationSelection | undefined, other: LocationSelection | undefined) {
    const location = findLocation(selection?.locationId, this.locations()), g = this.graph();
    if (!location || !g || location.nodeIds.length < 2) return [];
    const takenByOther = other?.locationId === location.id ? other.pointId : undefined;
    return location.nodeIds.filter(id => id !== takenByOther)
      .map(id => ({ value: id, label: g.nodeMap[id].label + gateSuffix(this.gates().find(gate => gate.id === id)) }))
      .sort((a, b) => byTitle(a.label, b.label));
  }
  /** A picker option's value is "location|point". */
  pickerOptions(other: LocationSelection | undefined) {
    return this.locationOptions(other).map(({ value, label }) => {
      const location = findLocation(value, this.locations())!, first = defaultSelection(location);
      return { label, value: this.selectionValue(first), closest: `Closest ${pointNoun(location).toLowerCase()}`,
        points: this.pointOptions(first, other).map(point => ({ value: `${value}|${point.value}`, label: point.label })) };
    });
  }
  selectionValue(selection: LocationSelection | undefined) { return selection ? `${selection.locationId}|${selection.pointId}` : ''; }
  setSelection(role: 'source' | 'destination', value: string): void {
    const [locationId, pointId] = value.split('|'), field = role === 'source' ? this.source : this.destination;
    if (value === this.selectionValue(field())) return;
    field.set({ locationId, pointId }); this.hideRoute();
    if (role === 'source') { this.me.set(null); this.locating.set(null); if (value === MY_LOCATION) this.locate(); }
  }
  swap(): void { const a = this.source(); this.source.set(this.destination()); this.destination.set(a); this.hideRoute(); }
  clear(): void { this.source.set(undefined); this.destination.set(undefined); this.me.set(null); this.locating.set(null); this.hideRoute(); }
  submit(): void {
    const a = this.source(), b = this.destination(), g = this.routeGraph();
    if (!a || !b || !g || !this.canSubmit()) return;
    this.submitted.set({ source: a, destination: b });
    const journey = this.journey();
    if (journey) { this.route.emit(journeyPolyline(journey.path, this.adjacency(), g.nodeMap)); this.folded.set(true); }
    else this.route.emit(null);
  }
  change(): void { this.folded.set(false); }
  private hideRoute(): void { if (this.submitted()) this.route.emit(null); this.submitted.set(null); }
  summary(journey: Journey) {
    // A walk from or to outside names the gate it goes through: "Metro → Gate 10 → Hall 14".
    const gates = journey.start.outside || journey.end.outside ? journey.via.filter(node => node.category === 'gate') : [];
    return `${[journey.start, ...gates, journey.end].map(node => node.label).join(' → ')} · ~${walkingMeters(journey.totalMeters)} m · ~${walkingMinutes(journey.totalMeters)} min walk`;
  }

  /** Asked only when "Use my location" is picked; the position stays on this device and is never sent anywhere. */
  private locate(): void {
    const satellite = this.satellite;
    if (!navigator.geolocation || !satellite || !this.fence.length) { this.locating.set({ state: 'error', message: 'This browser cannot share your location. Pick a source instead.' }); return; }
    this.locating.set({ state: 'finding' });
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (this.selectionValue(this.source()) !== MY_LOCATION) return;
      const at = worldFromLatLon(coords.latitude, coords.longitude, satellite), fence = fenceTest(at, this.fence);
      if (coords.accuracy > SURE_FIX_METRES || fence.metres < FENCE_DOUBT_METRES) this.locating.set({ state: 'ask', at });
      else this.placeMe(at, fence.inside);
    }, () => this.locating.set({ state: 'error', message: 'Your location is off or was not allowed. Pick a source instead.' }),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  /** The answer to "Are you inside the venue?". */
  answer(inside: boolean): void { const locating = this.locating(); if (locating?.state === 'ask') this.placeMe(locating.at, inside); }
  /** My location joins the nearest walkway junction on the visitor's side of the fence. */
  private placeMe(at: Point, inside: boolean): void {
    const g = this.graph();
    if (!g) return;
    const linked = new Set(g.edges.flatMap(edge => [edge.from, edge.to]));
    let nearest: MapNode | undefined, metres = Infinity;
    for (const node of g.nodes) {
      const d = Math.hypot(node.x - at.x, node.z - at.z);
      if (node.category === 'junction' && !node.outside === inside && linked.has(node.id) && d < metres) { nearest = node; metres = d; }
    }
    if (!nearest || metres > MAX_LINK_METRES) { this.locating.set({ state: 'error', message: 'You seem to be away from Bharat Mandapam. Pick a source instead.' }); return; }
    const node: MapNode = { id: 'me', label: 'My location', category: 'junction', x: at.x, z: at.z, ...(inside ? {} : { outside: true }) };
    this.me.set({ node, edge: { id: `me-${nearest.id}`, from: 'me', to: nearest.id, active: true, direction: 'two-way', kind: 'link', points: [[at.x, at.z], [nearest.x, nearest.z]] } });
    this.locating.set(null);
  }
}
