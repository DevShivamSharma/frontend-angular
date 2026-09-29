import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { extractErrorMessage } from '../core/http-error.util';
import { NotifyService } from '../core/notify.service';
import type { Point } from '../planner/geometry/placement-rules';
import type { Hall, HallLegend } from '../planner/models/hall.model';
import type { Hall as ItpoHall } from '../home/venue.models';
import { parseHallIdentity } from '../shared/hall-identity';
import { AMENITY_GROUPS, AMENITY_KINDS, amenityIcon, amenityInfo } from './amenity-kinds';
import { boundsOf, draftFromArea, openingsFor, outlineProblem, polygonArea } from './custom-hall';
import { CanvasAmenity, CanvasTool, PlanCanvasComponent } from './plan-canvas.component';
import { SetupApiService } from './setup-api.service';
import type { HallDraft, HallImportResult, ImportedAmenity, RoomOutline } from './setup.models';

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
const MAX_IMAGE_MB = 25;
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp'];
/** A picture has no scale: it starts this wide, until a measured length or the area sets it. */
const IMAGE_START_WIDTH_M = 100;

/**
 * Step 1b: import a hall from its floor plan. Upload -> the server reads the plan -> the user
 * checks and corrects what was found -> the hall is saved as a new master hall.
 */
@Component({
  selector: 'app-hall-import-page',
  imports: [RouterLink, DecimalPipe, PlanCanvasComponent],
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
  /** Halls made from an area the user picked or drew, after the server's suggestions. */
  readonly extraDrafts = signal<HallDraft[]>([]);
  readonly drafts = computed(() => [...(this.result()?.candidates ?? []), ...this.extraDrafts()]);
  readonly candidate = signal(0);
  /** Outlines the user edited, by draft id. */
  readonly outlineEdits = signal<Record<string, Point[]>>({});

  // --- tools on the plan ---------------------------------------------------------------------
  private readonly canvas = viewChild(PlanCanvasComponent);
  readonly tool = signal<CanvasTool>('none');
  /** The length marked with the measure tool, in plan metres, while its real length is asked. */
  readonly measuredLength = signal<number | null>(null);
  readonly realLength = signal<number | null>(null);
  /** Real metres per plan metre, from a measured length; null until the user sets one. */
  readonly calibration = signal<number | null>(null);
  private customs = 0;
  /** A picture of the plan (image upload), shown behind it in the overview's metres. */
  readonly picture = signal<{ href: string; width: number; height: number } | null>(null);
  /** The picture in the frame the canvas shows: the overview's, or the current hall's. */
  readonly underlay = computed(() => {
    const p = this.picture();
    const d = this.draft();
    if (!p || !d) return null;
    const o = this.onOverview() ? { x: 0, z: 0 } : d.origin;
    return { href: p.href, x: -p.width / 2 - o.x, z: -p.height / 2 - o.z, width: p.width, height: p.height };
  });
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
    const list = this.drafts();
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

  readonly draft = computed<HallDraft | null>(() => this.drafts()[this.candidate()] ?? null);
  /** The outline the hall will have: the user's edit, else the draft's own. */
  readonly boundary = computed<Point[]>(() => {
    const d = this.draft();
    return d ? (this.outlineEdits()[d.id] ?? d.boundary) : [];
  });
  readonly outlineEdited = computed(() => {
    const d = this.draft();
    return !!d && this.outlineEdits()[d.id] !== undefined;
  });
  readonly outlineError = computed(() => (this.boundary().length ? outlineProblem(this.boundary()) : null));
  /** Doors follow the outline and the facilities kept, so edits never leave a door off the wall. */
  readonly openings = computed(() => openingsFor(this.amenities().filter(a => a.included), this.boundary()));
  readonly needsScale = computed(() => this.result()?.scale.known === false);
  /** Real metres per plan metre: a measured length wins, else the hall's area (PDF without scale), else 1. */
  readonly factor = computed(() => {
    const measured = this.calibration();
    if (measured) return measured;
    const area = this.realArea();
    const planArea = polygonArea(this.boundary());
    return this.needsScale() && area && area > 0 && planArea > 0 ? Math.sqrt(area / planArea) : 1;
  });
  readonly size = computed(() => {
    const b = this.boundary();
    if (b.length < 3) return '';
    const box = boundsOf(b);
    const k = this.factor();
    const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN');
    return `${fmt((box.maxX - box.minX) * k)} × ${fmt((box.maxZ - box.minZ) * k)} m · ${Math.round(polygonArea(b) * k * k).toLocaleString('en-IN')} m²`;
  });
  /** What the plan canvas shows: the whole plan while picking or drawing an area, else the hall. */
  readonly onOverview = computed(() => this.tool() === 'pick' || this.tool() === 'draw');
  readonly canvasDraft = computed(() => (this.onOverview() ? this.result()?.overview : this.draft()) ?? null);
  readonly canvasAmenities = computed<CanvasAmenity[]>(() =>
    this.onOverview() ? (this.result()?.overview.amenities ?? []) : this.visibleAmenities()
  );
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
    if (!this.needsScale() || this.calibration()) return '';
    const area = this.realArea();
    return area && area >= 50 && area <= 500_000 ? '' : 'Enter the hall’s floor area in m², e.g. 6950.';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.upload?.unsubscribe();
      this.dropPicture();
    });
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
    if (ext && IMAGE_TYPES.includes(ext)) {
      void this.startPicture(file);
      return;
    }
    if (ext === 'dwg') {
      this.error.set('DWG files can’t be read yet. In AutoCAD choose Save As → DXF (ASCII), then upload the DXF.');
      return;
    }
    if (ext !== 'dxf' && ext !== 'pdf') {
      this.error.set('Choose a DXF, PDF or image (PNG, JPG) floor plan.');
      return;
    }
    this.dropPicture();
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

  /**
   * A picture of a plan (photo, scan, screenshot) has no lines to read: it is shown behind the
   * plan so the user can trace the hall, set the scale from a known length and place the
   * facilities. It never leaves the browser.
   */
  private async startPicture(file: File): Promise<void> {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      this.error.set(`This image is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_IMAGE_MB} MB.`);
      return;
    }
    const href = URL.createObjectURL(file);
    const image = new Image();
    image.src = href;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(href);
      this.error.set('This image could not be opened. Try a PNG or JPG.');
      return;
    }
    this.upload?.unsubscribe();
    this.dropPicture();
    this.file.set(file);
    const width = IMAGE_START_WIDTH_M;
    const height = round((width * image.naturalHeight) / image.naturalWidth);
    this.picture.set({ href, width, height });
    const whole: HallDraft = {
      id: 'picture',
      outlineLabel: 'The whole picture — trace the hall with Draw outline or Edit outline',
      name: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 60) || 'New hall',
      width,
      length: height,
      areaM2: Math.round(width * height),
      boundary: [
        { x: -width / 2, z: -height / 2 },
        { x: width / 2, z: -height / 2 },
        { x: width / 2, z: height / 2 },
        { x: -width / 2, z: height / 2 }
      ],
      amenities: [],
      markers: [],
      openings: [],
      zones: [],
      blockedAreas: [],
      legends: [],
      compass: null,
      linework: [],
      origin: { x: 0, z: 0 }
    };
    this.review({
      fileName: file.name,
      format: 'image',
      scale: { metresPerUnit: width / image.naturalWidth, known: false, source: 'A picture has no scale' },
      multiHall: false,
      candidates: [whole],
      overview: { ...whole, id: 'overview' },
      rooms: [],
      warnings: [
        'This is a picture, so nothing could be read from it automatically. Trace the hall with Draw outline, set the scale by measuring a length you know, and add toilets, lifts and gates with “Add on plan”.'
      ],
      stats: { layers: 0, shapes: 0, texts: 0, symbols: 0 }
    });
    // Tracing is the first thing to do with a picture.
    this.tool.set('draw');
  }

  private dropPicture(): void {
    const p = this.picture();
    if (p) URL.revokeObjectURL(p.href);
    this.picture.set(null);
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
    this.extraDrafts.set([]);
    this.outlineEdits.set({});
    this.calibration.set(null);
    this.tool.set('none');
    this.candidate.set(-1);
    this.useCandidate(0);
    this.phase.set('review');
  }

  /**
   * Shows another hall of the plan (multi-hall) or another reading of the hall. A plan's halls
   * keep their edits while you switch between them.
   */
  useCandidate(index: number): void {
    const list = this.drafts();
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
    this.tool.set('none');
  }

  /** The name shown on a hall's tab: the edited one for halls already visited. */
  tabName(index: number): string {
    const d = this.drafts()[index];
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

  // --- tools -------------------------------------------------------------------------------

  setTool(tool: CanvasTool): void {
    this.placing.set(null);
    this.measuredLength.set(null);
    this.realLength.set(null);
    this.tool.set(this.tool() === tool ? 'none' : tool);
  }

  changeOutline(points: Point[]): void {
    const d = this.draft();
    if (d) this.outlineEdits.update(edits => ({ ...edits, [d.id]: points }));
  }

  resetOutline(): void {
    const d = this.draft();
    if (!d) return;
    this.outlineEdits.update(({ [d.id]: _, ...rest }) => rest);
  }

  onMeasured(m: { distance: number }): void {
    this.measuredLength.set(m.distance > 0.01 ? m.distance : null);
    this.realLength.set(null);
  }

  applyMeasurement(): void {
    const plan = this.measuredLength();
    const real = this.realLength();
    if (!plan || !real || real <= 0) return;
    // Relative to the scale in use, so measuring again refines rather than restarts.
    this.calibration.set((real / plan) * (this.calibration() ?? 1));
    this.measuredLength.set(null);
    this.tool.set('none');
    this.notify.success('Scale set', `Everything is now sized so that line is ${real} m.`);
  }

  clearCalibration(): void {
    this.calibration.set(null);
  }

  pickRoom(room: RoomOutline): void {
    this.addCustom(room.polygon, `Area picked on the plan · ${room.areaM2.toLocaleString('en-IN')} m²`);
  }

  drawnOutline(points: Point[]): void {
    const problem = outlineProblem(points);
    if (problem) {
      this.notify.error('That outline cannot be used', problem);
      return;
    }
    this.addCustom(points, `Outline you drew · ${Math.round(polygonArea(points)).toLocaleString('en-IN')} m²`);
  }

  finishDrawing(): void {
    this.canvas()?.finishDrawing();
  }

  undoPoint(): void {
    this.canvas()?.undoPoint();
  }

  /** A hall from an area of the plan (overview frame), added after the suggestions and opened. */
  private addCustom(polygon: Point[], label: string): void {
    const overview = this.result()?.overview;
    if (!overview) return;
    const draft = draftFromArea(overview, polygon, `custom-${++this.customs}`, label);
    this.extraDrafts.update(list => [...list, draft]);
    this.tool.set('none');
    this.useCandidate(this.drafts().length - 1);
    this.notify.success('Hall outline set', `${draft.outlineLabel}. Check its facilities, then save.`);
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
    this.extraDrafts.set([]);
    this.phase.set('pick');
  }

  async cancel(): Promise<void> {
    if (this.phase() === 'review' && !(await this.confirmDiscard())) return;
    void this.router.navigate(['/planner/halls']);
  }

  /** Multi-hall: stop here with the halls saved so far; the rest are not imported. */
  async finish(): Promise<void> {
    const pending = this.drafts().length - this.savedCount();
    if (pending > 0) {
      const confirmed = await this.notify.confirm({
        title: `Finish with ${this.savedCount()} of ${this.drafts().length} halls?`,
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
    if (!d || this.nameError() || this.areaError() || this.outlineError()) return;
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

  /**
   * The hall as saved: the (possibly edited) outline, re-centred on its own middle so width and
   * length describe it, with everything else moved and scaled with it.
   */
  private buildHall(d: HallDraft): Hall {
    const k = this.factor();
    const outline = this.boundary();
    const box = boundsOf(outline);
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const s = (p: Point): Point => ({ x: round((p.x - cx) * k), z: round((p.z - cz) * k) });
    return {
      id: 'import',
      name: this.name().trim(),
      shape: 'SQUARE',
      width: round((box.maxX - box.minX) * k),
      length: round((box.maxZ - box.minZ) * k),
      radius: 0,
      boundary: outline.map(s),
      amenities: this.amenities()
        .filter(a => a.included && a.label.trim())
        .map(a => ({ kind: a.kind, label: a.label.trim(), position: s(a.position) })),
      openings: this.includeOpenings() ? this.openings().map(o => ({ ...o, position: s(o.position) })) : [],
      zones: this.includeZones() ? d.zones.map(z => ({ ...z, polygon: z.polygon.map(s) })) : [],
      blockedAreas: this.includePillars()
        ? d.blockedAreas.map(b => {
            const c = s({ x: b.posX, z: b.posZ });
            return { ...b, posX: c.x, posZ: c.z, width: round(b.width * k), length: round(b.length * k) };
          })
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
