import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, computed, signal } from '@angular/core';
import { venueAsset } from './venue.models';
import { MapEdge, MapGraph, MapNode, VenueGate, createMapGraph, gateSuffix, parseMapGraph, parseVenueGates, resolveGateAccess, visitorGateOverrides } from './venue-route-graph';
import { buildAdjacency } from './venue-route-pathfinding';
import { CLOSEST_POINT, LocationSelection, NAVIGATION_LOCATIONS, NavigationLocation, availableLocations, defaultSelection, findLocation, selectionForNode } from './venue-route-locations';
import { Journey, JourneyProblem, planJourney, problemMessage, walkingMeters, walkingMinutes } from './venue-route-journey';
import { Point, SatelliteFit, journeyPolyline, worldFromLatLon } from './venue-route-geometry';

const byTitle = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/** "Gate" for Gates: the group's title, singular. */
const pointNoun = (location: NavigationLocation) => location.title.replace(/s$/i, '');
/** The Source option for the visitor's own position, and the graph node it becomes. */
const MY_LOCATION = 'me|me';
/** Further than this from every walkway, a fix is not at the venue and is not routed from. */
const MAX_LINK_METRES = 1500;

type Side = 'inside' | 'outside';
type Locating = { state: 'finding' } | { state: 'error'; message: string };

/**
 * Source / Destination route planner, re-created from the ITPO app's CampusNavigationScreen. One picker per
 * end: a group (Gates, Halls, ...) is an option group led by its closest point, so a phone needs one tap per end.
 * The walk is drawn as soon as both ends are chosen, and the form folds into a trip card (time, the stops, Change /
 * Reverse / End); changing either end re-plans it at once.
 */
@Component({ selector: 'section[appVenueDirections]', standalone: true, imports: [NgTemplateOutlet], templateUrl: './venue-directions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'venue-interior-actions venue-directions', 'aria-label': 'Walking directions' } })
export class VenueDirectionsComponent implements OnInit, OnChanges {
  /** False once the explorer leaves route mode (another view, the globe, a visit); the form then reopens. */
  @Input() active = false;
  /** A place to route to, e.g. from a hall's "Directions here"; `request` changes on every ask. */
  @Input() destinationNode = '';
  @Input() request = 0;
  /** The 3D explorer can hand the route to the visitor ("Walk it as a visitor"); the phone map cannot. */
  @Input() canWalk = false;
  /** In visitor mode: where the visitor stands (world x, y, z). The route then starts there, with no Source picker. */
  @Input() visitorAt: number[] | null = null;
  @Output() readonly route = new EventEmitter<Point[] | null>();
  /** The walk for the visitor to follow, and the place it leads to. */
  @Output() readonly walk = new EventEmitter<{ points: Point[]; label: string }>();
  readonly graph = signal<MapGraph | null>(null);
  readonly error = signal('');
  readonly source = signal<LocationSelection | undefined>(undefined);
  readonly destination = signal<LocationSelection | undefined>(undefined);
  private readonly submitted = signal<{ source: LocationSelection; destination: LocationSelection } | null>(null);
  readonly folded = signal(false);
  /** venue-gates.json rows, and the satellite fit from venue-walkways.json for "Use my location". */
  private readonly gates = signal<VenueGate[]>([]);
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
  /** Where the visitor said they are, asked before anything else; null until answered. */
  readonly side = signal<Side | null>(null);
  /** Source offers only the places on the visitor's side; gates stand on the fence, so on both. */
  private readonly onSide = (id: string, side: Side) => { const node = this.graph()?.nodeMap[id]; return !!node && (node.category === 'gate' || !node.outside === (side === 'inside')); };
  readonly sourceLocations = computed(() => {
    const side = this.side();
    return side ? this.locations().map(location => ({ ...location, nodeIds: location.nodeIds.filter(id => this.onSide(id, side)) })).filter(location => location.nodeIds.length) : [];
  });
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
  /** The trip card's stops: start, the gate the walk crosses the fence at (from or to outside), destination; each with the metres to it. */
  readonly steps = computed(() => {
    const journey = this.journey(), g = this.routeGraph(), adjacency = this.adjacency();
    if (!journey || !g) return [];
    const crossing = journey.start.outside || journey.end.outside, path = journey.path;
    const steps: { kind: 'start' | 'gate' | 'end'; label: string; meters: number }[] = [{ kind: 'start', label: journey.start.label, meters: 0 }];
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      walked += adjacency[path[i - 1]]?.find(entry => entry.nodeId === path[i])?.distance ?? 0;
      const node = g.nodeMap[path[i]], last = i === path.length - 1;
      if (!last && !(crossing && node.category === 'gate')) continue;
      steps.push({ kind: last ? 'end' : 'gate', label: last ? node.label : `${journey.start.outside ? 'Enter at' : 'Leave by'} ${node.label}`, meters: walkingMeters(walked) });
      walked = 0;
    }
    return steps;
  });
  /** My location counts as chosen only once it is placed. */
  private readonly placed = (selection: LocationSelection | undefined) => !!selection && (this.selectionValue(selection) !== MY_LOCATION || !!this.me());
  readonly problemMessage = problemMessage;
  readonly myLocation = MY_LOCATION;

  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    this.error.set('');
    try {
      const get = async (path: string) => { const response = await fetch(venueAsset(path)); if (!response.ok) throw new Error(path); return response.json(); };
      const [walkways, gates] = await Promise.all([get('venue-walkways.json'), get('venue-gates.json')]);
      this.satellite = walkways.satellite;
      this.gates.set(parseVenueGates(gates));
      this.graph.set(parseMapGraph(walkways));
      this.applyDestinationRequest();
    } catch { this.error.set('Walking routes could not load. Check your connection and retry.'); }
  }
  ngOnChanges(changes: SimpleChanges): void {
    // Leaving route mode starts over: the next Directions asks again where the visitor is.
    if (changes['active'] && !this.active && this.submitted()) { this.submitted.set(null); this.folded.set(false); this.side.set(null); }
    if (changes['request'] && this.request) this.applyDestinationRequest();
    // In visitor mode the route always starts where the visitor stands (placed afresh on each plan, see replan).
    if (changes['visitorAt'] && this.visitorAt && this.selectionValue(this.source()) !== MY_LOCATION) this.source.set({ locationId: 'me', pointId: 'me' });
  }
  private applyDestinationRequest(): void {
    if (!this.destinationNode || !this.graph()) return;
    const selection = selectionForNode(this.destinationNode, this.locations());
    if (selection) { this.destination.set(selection); this.folded.set(false); this.replan(); }
  }

  locationOptions(other: LocationSelection | undefined, locations: NavigationLocation[]) {
    // A single-point location picked on the other side is not offered here; groups stay.
    const taken = findLocation(other?.locationId, this.locations());
    return locations.filter(item => !(item.id === taken?.id && item.nodeIds.length === 1))
      .map(item => ({ value: item.id, label: item.title })).sort((a, b) => byTitle(a.label, b.label));
  }
  pointOptions(selection: LocationSelection | undefined, other: LocationSelection | undefined, locations: NavigationLocation[]) {
    const location = findLocation(selection?.locationId, locations), g = this.graph();
    if (!location || !g || location.nodeIds.length < 2) return [];
    const takenByOther = other?.locationId === location.id ? other.pointId : undefined;
    return location.nodeIds.filter(id => id !== takenByOther)
      .map(id => ({ value: id, label: g.nodeMap[id].label + gateSuffix(this.gates().find(gate => gate.id === id)) }))
      .sort((a, b) => byTitle(a.label, b.label));
  }
  /** A picker option's value is "location|point". */
  pickerOptions(other: LocationSelection | undefined, locations: NavigationLocation[]) {
    return this.locationOptions(other, locations).map(({ value, label }) => {
      const location = findLocation(value, locations)!, first = defaultSelection(location);
      return { label, value: this.selectionValue(first), closest: `Closest ${pointNoun(location).toLowerCase()}`,
        points: this.pointOptions(first, other, locations).map(point => ({ value: `${value}|${point.value}`, label: point.label })) };
    });
  }
  selectionValue(selection: LocationSelection | undefined) { return selection ? `${selection.locationId}|${selection.pointId}` : ''; }
  setSelection(role: 'source' | 'destination', value: string): void {
    const [locationId, pointId] = value.split('|'), field = role === 'source' ? this.source : this.destination;
    if (value === this.selectionValue(field())) return;
    field.set({ locationId, pointId });
    if (role === 'source') { this.me.set(null); this.locating.set(null); if (value === MY_LOCATION) this.locate(); }
    this.replan();
  }
  /** A new answer keeps the Source only when it is on that side; My location is placed again. */
  setSide(side: Side): void {
    this.side.set(side);
    const source = this.source();
    if (source && (this.selectionValue(source) === MY_LOCATION || !this.fits(source, side))) { this.source.set(undefined); this.me.set(null); this.locating.set(null); }
    this.replan();
  }
  private fits(selection: LocationSelection, side: Side): boolean {
    if (this.selectionValue(selection) === MY_LOCATION) return true;
    const location = findLocation(selection.locationId, this.locations());
    return !!location && (selection.pointId === CLOSEST_POINT ? location.nodeIds.some(id => this.onSide(id, side)) : this.onSide(selection.pointId, side));
  }
  /** Swapping can put a place from the other side in Source; the answer then follows it. */
  swap(): void {
    const a = this.source(), side = this.side(); this.source.set(this.destination()); this.destination.set(a);
    const source = this.source();
    if (source && side && !this.fits(source, side)) this.side.set(side === 'inside' ? 'outside' : 'inside');
    this.replan();
  }
  clear(): void {
    this.source.set(this.visitorAt ? { locationId: 'me', pointId: 'me' } : undefined); this.destination.set(undefined);
    this.me.set(null); this.locating.set(null); this.folded.set(false); this.replan();
  }
  /**
   * Re-plans after any change: draws the walk and folds into the trip card once both ends are chosen, otherwise takes
   * the old walk off the map. A new route replaces the old one in a single emit, so the 3D camera does not leave and
   * re-enter route mode in between.
   */
  private replan(): void {
    if (this.visitorAt) this.positionMe({ x: this.visitorAt[0], z: this.visitorAt[2] }, undefined, 'Where you stand');
    const shown = !!this.submitted(), a = this.source(), b = this.destination(), g = this.routeGraph();
    this.submitted.set(null);
    if (!a || !b || !g || !this.placed(a) || !this.placed(b)) { if (shown) this.route.emit(null); return; }
    this.submitted.set({ source: a, destination: b });
    const journey = this.journey();
    if (journey) { this.route.emit(journeyPolyline(journey.path, this.adjacency(), g.nodeMap)); this.folded.set(true); }
    else { this.folded.set(false); if (shown) this.route.emit(null); }
  }
  change(): void { this.folded.set(false); }
  minutes(journey: Journey) { return walkingMinutes(journey.totalMeters); }
  meters(journey: Journey) { return walkingMeters(journey.totalMeters); }
  summary(journey: Journey) {
    // A walk from or to outside names the gate it goes through: "Metro → Gate 10 → Hall 14".
    const gates = journey.start.outside || journey.end.outside ? journey.via.filter(node => node.category === 'gate') : [];
    return `${[journey.start, ...gates, journey.end].map(node => node.label).join(' → ')} · ~${walkingMeters(journey.totalMeters)} m · ~${walkingMinutes(journey.totalMeters)} min walk`;
  }

  /**
   * Asked only when "Use my location" is picked; the position stays on this device and is never sent anywhere.
   * The visitor's own answer says which side of the fence it is on, so a vague fix by the fence cannot misplace it.
   */
  private locate(): void {
    const satellite = this.satellite;
    if (!navigator.geolocation || !satellite) { this.locating.set({ state: 'error', message: 'This browser cannot share your location. Pick a source instead.' }); return; }
    this.locating.set({ state: 'finding' });
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (this.selectionValue(this.source()) !== MY_LOCATION) return;
      this.placeMe(worldFromLatLon(coords.latitude, coords.longitude, satellite), this.side() !== 'outside');
    }, () => this.locating.set({ state: 'error', message: 'Your location is off or was not allowed. Pick a source instead.' }),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  /** My location joins the nearest walkway junction on the visitor's side of the fence. */
  private placeMe(at: Point, inside: boolean): void {
    if (!this.positionMe(at, inside, 'My location')) {
      this.locating.set({ state: 'error', message: 'You seem to be away from Bharat Mandapam. Pick a source instead.' }); return;
    }
    this.locating.set(null);
    this.replan();
  }
  /**
   * The `me` node at `at`, linked to the nearest walkway junction on the given side of the fence; with no side given
   * (the 3D visitor), the nearest junction says which side it is. False when no walkway is near.
   */
  private positionMe(at: Point, inside: boolean | undefined, label: string): boolean {
    const g = this.graph();
    if (!g) return false;
    const linked = new Set(g.edges.flatMap(edge => [edge.from, edge.to]));
    let nearest: MapNode | undefined, metres = Infinity;
    for (const node of g.nodes) {
      const d = Math.hypot(node.x - at.x, node.z - at.z);
      if (node.category === 'junction' && (inside === undefined || !node.outside === inside) && linked.has(node.id) && d < metres) { nearest = node; metres = d; }
    }
    if (!nearest || metres > MAX_LINK_METRES) return false;
    const node: MapNode = { id: 'me', label, category: 'junction', x: at.x, z: at.z, ...((inside ?? !nearest.outside) ? {} : { outside: true }) };
    this.me.set({ node, edge: { id: `me-${nearest.id}`, from: 'me', to: nearest.id, active: true, direction: 'two-way', kind: 'link', points: [[at.x, at.z], [nearest.x, nearest.z]] } });
    return true;
  }
  /** "Walk it as a visitor" / "Walk there": the drawn route, for the visitor to follow. A visitor's walk starts where they stand now. */
  walkRoute(): void {
    if (this.visitorAt) this.replan();
    const journey = this.journey(), g = this.routeGraph();
    if (journey && g) this.walk.emit({ points: journeyPolyline(journey.path, this.adjacency(), g.nodeMap), label: journey.end.label });
  }
}
