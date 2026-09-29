import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { extractErrorMessage } from '../core/http-error.util';
import { NotifyService } from '../core/notify.service';
import type { Point } from '../planner/geometry/placement-rules';
import type { Hall, HallLegend } from '../planner/models/hall.model';
import type { Hall as ItpoHall } from '../home/venue.models';
import { parseHallIdentity } from '../shared/hall-identity';
import { AMENITY_GROUPS, AMENITY_KINDS, amenityIcon, amenityInfo } from './amenity-kinds';
import { CanvasAmenity, PlanCanvasComponent } from './plan-canvas.component';
import { SetupApiService } from './setup-api.service';
import type { HallDraft, HallImportResult, ImportedAmenity } from './setup.models';

type Phase = 'pick' | 'uploading' | 'analysing' | 'review' | 'saving';

interface ReviewAmenity extends ImportedAmenity {
  included: boolean;
}

interface ReviewLegend extends HallLegend {
  included: boolean;
}

/** Everything the user changes about one hall, kept while they switch between a plan's halls. */
interface WorkState {
  name: string;
  amenities: ReviewAmenity[];
  legends: ReviewLegend[];
  includeOpenings: boolean;
  includeZones: boolean;
  includePillars: boolean;
  includeMarkers: boolean;
  realArea: number | null;
  areaSource: 'itpo' | 'user' | null;
}

const MAX_DXF_MB = 80;
const MAX_PDF_MB = 25;

/**
 * Step 1b: import a hall from its floor plan. Upload -> the server reads the plan -> the user
 * checks and corrects what was found -> the hall is saved as a new master hall.
 */
@Component({
  selector: 'app-hall-import-page',
  imports: [RouterLink, PlanCanvasComponent],
  templateUrl: './hall-import-page.component.html',
  styleUrl: './hall-import-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HallImportPageComponent implements OnInit {
  private readonly api = inject(SetupApiService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  private upload?: Subscription;

  readonly phase = signal<Phase>('pick');
  readonly dragging = signal(false);
  readonly file = signal<File | null>(null);
  readonly percent = signal(0);
  readonly error = signal('');

  readonly result = signal<HallImportResult | null>(null);
  readonly candidate = signal(0);
  /** Halls of a multi-hall plan already saved: draft id -> saved hall id. */
  readonly savedIds = signal<Record<string, string | number>>({});
  private readonly work = new Map<string, WorkState>();
  readonly multi = computed(() => this.result()?.multiHall === true);
  readonly savedCount = computed(() => Object.keys(this.savedIds()).length);
  readonly currentSaved = computed(() => {
    const d = this.draft();
    return d ? this.savedIds()[d.id] !== undefined : false;
  });
  /** The next hall of the plan still to save, after the current one (wrapping round). */
  readonly nextUnsaved = computed(() => {
    const list = this.result()?.candidates ?? [];
    for (let k = 1; k <= list.length; k++) {
      const i = (this.candidate() + k) % list.length;
      if (i !== this.candidate() && this.savedIds()[list[i].id] === undefined) return i;
    }
    return -1;
  });
  readonly name = signal('');
  readonly amenities = signal<ReviewAmenity[]>([]);
  readonly legends = signal<ReviewLegend[]>([]);
  readonly includeOpenings = signal(true);
  readonly includeZones = signal(true);
  readonly includePillars = signal(true);
  readonly includeMarkers = signal(true);
  /**
   * The hall's real floor area when the PDF gives no scale. Filled in from ITPO's hall records
   * when the name matches one; the user only types it when it does not.
   */
  readonly realArea = signal<number | null>(null);
  readonly areaSource = signal<'itpo' | 'user' | null>(null);
  private readonly itpoHalls = signal<ItpoHall[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly highlightId = signal<string | null>(null);
  readonly placing = signal<string | null>(null);
  readonly addKind = signal(AMENITY_KINDS[0].kind);
  readonly submitted = signal(false);
  private manual = 0;
  /** Names of the halls already saved, to warn before a second hall of the same name is added. */
  private readonly existingNames = signal<Set<string>>(new Set());

  readonly kinds = AMENITY_KINDS;
  readonly iconOf = amenityIcon;
  readonly labelOf = (kind: string) => amenityInfo(kind).label;

  readonly draft = computed<HallDraft | null>(() => this.result()?.candidates[this.candidate()] ?? null);
  readonly needsScale = computed(() => this.result()?.scale.known === false);
  /** Metres per plan metre: 1, or the scale that gives the outline the hall's real area. */
  readonly factor = computed(() => {
    const d = this.draft();
    const area = this.realArea();
    return this.needsScale() && d && area && area > 0 && d.areaM2 > 0 ? Math.sqrt(area / d.areaM2) : 1;
  });
  readonly size = computed(() => {
    const d = this.draft();
    if (!d) return '';
    const k = this.factor();
    const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN');
    return `${fmt(d.width * k)} × ${fmt(d.length * k)} m · ${Math.round(d.areaM2 * k * k).toLocaleString('en-IN')} m²`;
  });
  readonly visibleAmenities = computed<CanvasAmenity[]>(() => this.amenities().filter(a => a.included));
  readonly groups = computed(() =>
    AMENITY_GROUPS.map(group => ({
      group,
      items: this.amenities().filter(a => amenityInfo(a.kind).group === group)
    })).filter(g => g.items.length)
  );
  readonly includedCount = computed(() => this.amenities().filter(a => a.included).length);
  readonly nameClash = computed(() => {
    const name = this.name().trim().toLowerCase();
    return !!name && this.existingNames().has(name);
  });
  readonly nameError = computed(() => (this.name().trim() ? '' : 'Give the hall a name.'));
  readonly areaError = computed(() => {
    if (!this.needsScale()) return '';
    const area = this.realArea();
    return area && area >= 50 && area <= 500_000 ? '' : 'Enter the hall’s floor area in m², e.g. 6950.';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.upload?.unsubscribe());
    // Keep the ITPO area in step with the hall name, unless the user typed an area themselves.
    effect(() => {
      if (!this.needsScale()) return;
      const area = itpoArea(this.itpoHalls(), this.name());
      untracked(() => {
        if (this.areaSource() === 'user') return;
        this.realArea.set(area);
        this.areaSource.set(area ? 'itpo' : null);
      });
    });
  }

  setArea(value: number | null): void {
    this.realArea.set(value);
    this.areaSource.set('user');
  }

  ngOnInit(): void {
    // Only for the duplicate-name warning: a failure here must not block the import.
    this.api.listHalls().then(
      halls => this.existingNames.set(new Set(halls.map(h => h.name.trim().toLowerCase()))),
      () => undefined
    );
    this.api.listItpoHalls().then(halls => this.itpoHalls.set(halls), () => undefined);
  }

  // --- pick & upload -----------------------------------------------------------------------

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.start(file);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.start(file);
  }

  start(file: File): void {
    this.error.set('');
    const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
    if (ext === 'dwg') {
      this.error.set('DWG files can’t be read yet. In AutoCAD choose Save As → DXF (ASCII), then upload the DXF.');
      return;
    }
    if (ext !== 'dxf' && ext !== 'pdf') {
      this.error.set('Choose a DXF or PDF floor plan.');
      return;
    }
    const limit = ext === 'pdf' ? MAX_PDF_MB : MAX_DXF_MB;
    if (file.size > limit * 1024 * 1024) {
      this.error.set(`This ${ext.toUpperCase()} is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${limit} MB. Export only this hall's floor and try again.`);
      return;
    }
    this.file.set(file);
    this.percent.set(0);
    this.phase.set('uploading');
    this.upload?.unsubscribe();
    this.upload = this.api.importPlan(file).subscribe({
      next: p => {
        if (p.stage === 'uploading') this.percent.set(p.percent);
        else if (p.stage === 'analysing') this.phase.set('analysing');
        else this.review(p.result);
      },
      error: (e: unknown) => {
        this.phase.set('pick');
        this.error.set(uploadError(e));
      }
    });
  }

  cancelUpload(): void {
    this.upload?.unsubscribe();
    this.phase.set('pick');
  }

  // --- review ------------------------------------------------------------------------------

  private review(result: HallImportResult): void {
    this.result.set(result);
    this.work.clear();
    this.savedIds.set({});
    this.candidate.set(-1);
    this.useCandidate(0);
    this.phase.set('review');
  }

  /**
   * Shows another hall of the plan (multi-hall) or another reading of the hall. A plan's halls
   * keep their edits while you switch between them.
   */
  useCandidate(index: number): void {
    const list = this.result()?.candidates ?? [];
    const d = list[index];
    if (!d) return;
    const current = list[this.candidate()];
    if (this.multi() && current) this.work.set(current.id, this.snapshot());
    this.candidate.set(index);
    const kept = this.multi() ? this.work.get(d.id) : undefined;
    if (kept) {
      this.name.set(kept.name);
      this.amenities.set(kept.amenities);
      this.legends.set(kept.legends);
      this.includeOpenings.set(kept.includeOpenings);
      this.includeZones.set(kept.includeZones);
      this.includePillars.set(kept.includePillars);
      this.includeMarkers.set(kept.includeMarkers);
      this.realArea.set(kept.realArea);
      this.areaSource.set(kept.areaSource);
    } else {
      this.name.set(d.name);
      this.amenities.set(d.amenities.map(a => ({ ...a, included: true })));
      this.legends.set(d.legends.map(l => ({ ...l, included: true })));
      this.includeOpenings.set(true);
      this.includeZones.set(true);
      this.includePillars.set(true);
      this.includeMarkers.set(true);
      if (this.multi() || this.areaSource() !== 'user') {
        this.realArea.set(null);
        this.areaSource.set(null);
      }
    }
    this.submitted.set(false);
    this.selectedId.set(null);
    this.placing.set(null);
  }

  /** The name shown on a hall's tab: the edited one for halls already visited. */
  tabName(index: number): string {
    const d = this.result()?.candidates[index];
    if (!d) return '';
    if (index === this.candidate()) return this.name() || d.name;
    return this.work.get(d.id)?.name ?? d.name;
  }

  private snapshot(): WorkState {
    return {
      name: this.name(),
      amenities: this.amenities(),
      legends: this.legends(),
      includeOpenings: this.includeOpenings(),
      includeZones: this.includeZones(),
      includePillars: this.includePillars(),
      includeMarkers: this.includeMarkers(),
      realArea: this.realArea(),
      areaSource: this.areaSource()
    };
  }

  toggleAmenity(id: string, included: boolean): void {
    this.amenities.update(list => list.map(a => (a.id === id ? { ...a, included } : a)));
  }

  renameAmenity(id: string, label: string): void {
    this.amenities.update(list => list.map(a => (a.id === id ? { ...a, label } : a)));
  }

  removeAmenity(id: string): void {
    this.amenities.update(list => list.filter(a => a.id !== id));
    if (this.selectedId() === id) this.selectedId.set(null);
  }

  moveAmenity(change: { id: string; position: Point }): void {
    this.amenities.update(list => list.map(a => (a.id === change.id ? { ...a, position: change.position } : a)));
  }

  select(id: string | null): void {
    this.selectedId.set(id);
    if (id) document.getElementById('row-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  startPlacing(): void {
    this.placing.set(this.addKind());
    this.selectedId.set(null);
  }

  place(position: Point): void {
    const kind = this.placing();
    if (!kind) return;
    const id = `m-${++this.manual}`;
    this.amenities.update(list => [...list, { id, kind, label: amenityInfo(kind).label, position, source: 'manual', included: true }]);
    this.placing.set(null);
    this.select(id);
  }

  toggleLegend(index: number, included: boolean): void {
    this.legends.update(list => list.map((l, i) => (i === index ? { ...l, included } : l)));
  }

  async chooseAnotherFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.result.set(null);
    this.work.clear();
    this.savedIds.set({});
    this.phase.set('pick');
  }

  async cancel(): Promise<void> {
    if (this.phase() === 'review' && !(await this.confirmDiscard())) return;
    void this.router.navigate(['/planner/halls']);
  }

  /** Multi-hall: stop here with the halls saved so far; the rest are not imported. */
  async finish(): Promise<void> {
    const pending = (this.result()?.candidates.length ?? 0) - this.savedCount();
    if (pending > 0) {
      const confirmed = await this.notify.confirm({
        title: `Finish with ${this.savedCount()} of ${this.result()!.candidates.length} halls?`,
        text: `${pending} hall${pending === 1 ? ' is' : 's are'} not saved yet and will not be imported.`,
        confirmText: 'Finish'
      });
      if (!confirmed) return;
    }
    this.goToHalls();
  }

  private goToHalls(): void {
    const ids = Object.values(this.savedIds());
    void this.router.navigate(['/planner/halls'], ids.length ? { queryParams: { selected: ids[ids.length - 1] } } : {});
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    const d = this.draft();
    if (!d || this.nameError() || this.areaError()) return;
    if (this.currentSaved()) return;
    this.phase.set('saving');
    try {
      const saved = await this.api.createHall(this.buildHall(d));
      if (!this.multi()) {
        this.notify.success(`${saved.name} imported`, 'It is now in your hall list and selected.');
        void this.router.navigate(['/planner/halls'], { queryParams: { selected: saved.id } });
        return;
      }
      this.savedIds.update(ids => ({ ...ids, [d.id]: saved.id }));
      const next = this.nextUnsaved();
      if (next < 0) {
        this.notify.success(`${this.savedCount()} halls imported`, 'They are now in your hall list.');
        this.goToHalls();
        return;
      }
      this.phase.set('review');
      this.notify.success(`${saved.name} saved`, `Now check ${this.tabName(next)}.`);
      this.useCandidate(next);
      // The next hall starts at its tabs, not where the previous one's save button was.
      document.querySelector('.su-hall-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      this.phase.set('review');
      this.notify.error('The hall could not be saved', extractErrorMessage(e));
    }
  }

  private buildHall(d: HallDraft): Hall {
    const k = this.factor();
    const s = (p: Point): Point => ({ x: round(p.x * k), z: round(p.z * k) });
    return {
      id: 'import',
      name: this.name().trim(),
      shape: 'SQUARE',
      width: round(d.width * k),
      length: round(d.length * k),
      radius: 0,
      boundary: d.boundary.map(s),
      amenities: this.amenities()
        .filter(a => a.included && a.label.trim())
        .map(a => ({ kind: a.kind, label: a.label.trim(), position: s(a.position) })),
      openings: this.includeOpenings() ? d.openings.map(o => ({ ...o, position: s(o.position) })) : [],
      zones: this.includeZones() ? d.zones.map(z => ({ ...z, polygon: z.polygon.map(s) })) : [],
      blockedAreas: this.includePillars()
        ? d.blockedAreas.map(b => ({ ...b, posX: round(b.posX * k), posZ: round(b.posZ * k), width: round(b.width * k), length: round(b.length * k) }))
        : [],
      markers: this.includeMarkers() ? d.markers.map(m => ({ ...m, position: s(m.position) })) : [],
      legends: this.legends()
        .filter(l => l.included)
        .map(({ included: _, ...l }) => l),
      compass: d.compass ? { ...d.compass, position: s(d.compass.position), size: d.compass.size * k } : null
    };
  }

  private confirmDiscard(): Promise<boolean> {
    const saved = this.savedCount();
    return this.notify.confirm({
      title: saved ? 'Leave this import?' : 'Discard this import?',
      text: saved
        ? `${saved} hall${saved === 1 ? ' is' : 's are'} already saved and stay in your list. The halls not saved yet are discarded.`
        : 'The hall has not been saved. Your changes to it will be lost.',
      confirmText: saved ? 'Leave' : 'Discard',
      danger: true
    });
  }
}

/** The floor area ITPO lists for this hall ("Hall 5 GF" -> Hall 5, ground floor), if exactly one matches. */
function itpoArea(records: ItpoHall[], name: string): number | null {
  const id = parseHallIdentity(name.trim());
  if (!id) return null;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(h => b.includes(h));
  const matches = records.filter(
    r => r.area !== null && same(r.halls, id.halls) && (!id.floor || r.floor === id.floor || r.floor === 'details')
  );
  return matches.length === 1 ? matches[0].area : null;
}

function uploadError(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'We couldn’t reach the server. Check your connection and try again.';
    if (e.status === 413) return 'The file is too large for the server. Export only this hall’s floor and try again.';
  }
  return extractErrorMessage(e);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
