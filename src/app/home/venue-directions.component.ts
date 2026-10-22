import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, computed, signal } from '@angular/core';
import { venueAsset } from './venue.models';
import { GATE_ACCESS_SUFFIX, MapGraph, parseMapGraph, resolveGateAccess } from './venue-route-graph';
import { buildAdjacency } from './venue-route-pathfinding';
import { LocationSelection, NAVIGATION_LOCATIONS, NavigationLocation, availableLocations, defaultSelection, findLocation, selectionForNode } from './venue-route-locations';
import { Journey, JourneyProblem, planJourney, problemMessage, walkingMeters, walkingMinutes } from './venue-route-journey';
import { Point, journeyPolyline } from './venue-route-geometry';

const byTitle = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/** "Gate" for Gates: the group's title, singular. */
const pointNoun = (location: NavigationLocation) => location.title.replace(/s$/i, '');

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
  readonly gateAccess = computed(() => { const g = this.graph(); return g ? resolveGateAccess(null, g.nodes) : {}; });
  readonly adjacency = computed(() => { const g = this.graph(); return g ? buildAdjacency(g.edges, this.gateAccess(), g.nodeMap) : {}; });
  readonly locations = computed(() => { const g = this.graph(); return g ? availableLocations(g.nodeMap, NAVIGATION_LOCATIONS) : []; });
  readonly isSubmitted = computed(() => {
    const s = this.submitted(), a = this.source(), b = this.destination();
    return !!s && !!a && !!b && s.source.locationId === a.locationId && s.source.pointId === a.pointId &&
      s.destination.locationId === b.locationId && s.destination.pointId === b.pointId;
  });
  readonly plan = computed(() => {
    const g = this.graph(), a = this.source(), b = this.destination();
    if (!g || !a || !b || !this.isSubmitted()) return null;
    return planJourney(a, b, { locations: this.locations(), adjacency: this.adjacency(), nodeMap: g.nodeMap, gateAccess: this.gateAccess() });
  });
  readonly journey = computed<Journey | null>(() => { const p = this.plan(); return p && 'journey' in p ? p.journey : null; });
  readonly problem = computed<JourneyProblem | null>(() => { const p = this.plan(); return p && 'problem' in p ? p.problem : null; });
  readonly canSubmit = computed(() => !!this.source() && !!this.destination() && !this.isSubmitted());
  readonly problemMessage = problemMessage;

  async ngOnInit(): Promise<void> {
    try {
      const response = await fetch(venueAsset('venue-walkways.json'));
      if (!response.ok) throw new Error(String(response.status));
      this.graph.set(parseMapGraph(await response.json()));
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
      .map(id => ({ value: id, label: g.nodeMap[id].label + GATE_ACCESS_SUFFIX[this.gateAccess()[id] ?? 'both'] }))
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
    if (value !== this.selectionValue(field())) { field.set({ locationId, pointId }); this.hideRoute(); }
  }
  swap(): void { const a = this.source(); this.source.set(this.destination()); this.destination.set(a); this.hideRoute(); }
  clear(): void { this.source.set(undefined); this.destination.set(undefined); this.hideRoute(); }
  submit(): void {
    const a = this.source(), b = this.destination(), g = this.graph();
    if (!a || !b || !g || !this.canSubmit()) return;
    this.submitted.set({ source: a, destination: b });
    const journey = this.journey();
    if (journey) { this.route.emit(journeyPolyline(journey.path, this.adjacency(), g.nodeMap)); this.folded.set(true); }
    else this.route.emit(null);
  }
  change(): void { this.folded.set(false); }
  private hideRoute(): void { if (this.submitted()) this.route.emit(null); this.submitted.set(null); }
  summary(journey: Journey) { return `${journey.start.label} → ${journey.end.label} · ~${walkingMeters(journey.totalMeters)} m · ~${walkingMinutes(journey.totalMeters)} min walk`; }
}
