import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  ElementRef,
  Component,
  inject,
  input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { OrgContextStore } from '../../../../core/org/org.stores';
import { FloorPlansApi, PlanPreview } from '../../../../core/venues/floor-plans-api.service';
import type {
  CommitResult,
  Grid,
  MultiPolygon,
  PlanCheck,
  PlanObject,
  PlanPage,
  PlanRegion,
  PlanReview,
  PlanView,
  Point,
} from '../../../../core/venues/floor-plan.models';
import { ThreePlanComponent, PlanLayer } from '../../../../shared/floor/three-plan.component';
import { ImportTourComponent } from '../../../../shared/import-tour/import-tour.component';
import { locateImportControl } from '../../../../shared/import-tour/locate-import-control';
@Component({
  selector: 'app-floor-plan-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ThreePlanComponent, ImportTourComponent],
  templateUrl: './floor-plan-page.component.html',
  styleUrl: './floor-plan-page.component.scss',
})
export class FloorPlanPageComponent implements OnInit, OnDestroy {
  readonly venueId = input.required<string>();
  private cd = inject(ChangeDetectorRef);
  private element = inject<ElementRef<HTMLElement>>(ElementRef);
  private api = inject(FloorPlansApi);
  private context = inject(OrgContextStore);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  @ViewChild(ThreePlanComponent) canvas?: ThreePlanComponent;
  step = 0;
  activeHallKey = '';
  correctionsOpen = false;
  viewMode: 'source' | 'floor' = 'source';
  gridCellMetres: number | null = null;
  designGridMetres: number | null = null;
  inspectionStamps: Record<string, string> = {};
  private currentDocumentId = '';
  freshReview = false;
  doc: PlanView | null = null;
  page: PlanPage | null = null;
  pageIndex = 0;
  selected = '';
  busy = false;
  error = '';
  notice = '';
  dirty = false;
  opacity = 0.8;
  mode = 'select';
  draft: Point[] = [];
  knownDistance = 1;
  preview: PlanPreview | null = null;
  previewKey = '';
  previewTarget = '';
  ack: Record<string, boolean> = {};
  inspected: Record<string, boolean> = {};
  chosen: Record<string, boolean> = {};
  names: Partial<Record<string, string>> = {};
  targets: Partial<Record<string, string>> = {};
  results: CommitResult[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  readonly kinds = [
    'wall',
    'column',
    'passage',
    'fire_curtain',
    'no_build',
    'utility',
    'entry',
    'unavailable',
    'void',
    'facility',
    'marking',
  ] as const;
  get guideReady() {
    return !this.currentDocumentId || !!this.doc || !!this.error;
  }
  get guideBlockers(): string[] {
    if (this.doc?.status === 'reading') return ['Wait for the document reader to finish.'];
    if (this.error) return [this.error];
    if (this.step === 1)
      return this.selectedHalls.length ? [] : ['Select an actual hall, or use Add a missing hall.'];
    if (this.step === 3)
      return this.selectedHalls
        .filter((h) => !this.ready(h))
        .map((h) => `${h.name}: finish its review before saving.`);
    if (this.step !== 2 || !this.activeHall) return [];
    const pending: string[] = [];
    if (!this.activeRegion?.confirmed)
      pending.push('Compare the source and tick Hall outline is correct.');
    if (this.linkedFoyers.some((z) => !z.confirmed))
      pending.push('Check and confirm each linked foyer boundary and its owning halls.');
    if (!this.sizeKnown)
      pending.push(
        'Establish the hall size in metres using a printed grid size or a known distance.',
      );
    if (!this.metricGrid) pending.push('Set grid spacing in metres.');
    if (!this.activeRegion?.restrictionsConfirmed)
      pending.push('Inspect and confirm Columns, exits and restricted areas are correct.');
    if (this.pendingObjects.length)
      pending.push('Choose meanings for uncertain areas and confirm their boundaries.');
    if (this.dirty)
      pending.push('Preview imported hall to apply corrections and refresh the checks.');
    else
      for (const check of this.activeHall.checks) {
        if (
          check.status !== 'pass' &&
          !new Set(['scale', 'boundary', 'restrictions', 'zones', 'objects', 'grid']).has(
            this.checkCode(check),
          ) &&
          (!check.overridable || !this.ack[check.id])
        )
          pending.push(
            `${check.label}: check the source, then correct or explicitly acknowledge it.`,
          );
      }
    if (
      !this.inspected[this.activeHall.key] ||
      this.inspectionStamps[this.activeHall.key] !== this.stampFor(this.activeHall)
    )
      pending.push('Open Imported hall and tick The imported hall looks correct after inspection.');
    return pending;
  }
  showGuideTopic(topic: string) {
    setTimeout(() => {
      if (!locateImportControl(this.element.nativeElement, topic))
        this.notice =
          'This control appears at its corresponding import step. Continue the current review first.';
      this.cd.markForCheck();
    });
  }
  setRegionRole(region: PlanRegion, role: PlanRegion['role']) {
    if (
      !this.page ||
      region.role === role ||
      this.doc?.committed[`${this.page.number}:${region.id}`]
    )
      return;
    region.role = role;
    region.confirmed = false;
    region.restrictionsConfirmed = false;
    region.hallIds = [];
    if (role !== 'hall') {
      this.page.dimensions = this.page.dimensions.filter((d) => d.regionId !== region.id);
      const owners = this.halls.filter((h) => h.id !== region.id);
      if (role !== 'exclude' && owners.length === 1) region.hallIds = [owners[0].id];
      for (const z of this.page.regions) {
        if (z.hallIds.includes(region.id)) {
          z.hallIds = z.hallIds.filter((id) => id !== region.id);
          z.confirmed = false;
        }
      }
      if (this.activeHall?.regionId === region.id)
        this.activeHallKey =
          this.doc?.halls.find((h) => owners.some((o) => o.id === h.regionId))?.key ?? '';
    }
    this.changed();
  }
  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('document');
    if (id) {
      this.currentDocumentId = id;
      void this.load(id);
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
  get detectionNotice() {
    return this.page?.warnings.some((w) =>
      /envelopes|Reading stopped|could not be rendered|detection (failed|incomplete)/i.test(w),
    )
      ? 'Automatic detection is incomplete on this page. Check each hall’s full boundary, foyers and restricted areas against the original before saving.'
      : '';
  }
  get halls() {
    return this.page?.regions.filter((r) => r.role === 'hall') ?? [];
  }
  get region() {
    return this.page?.regions.find((r) => r.id === this.selected) ?? null;
  }
  get object() {
    return this.page?.objects.find((o) => o.id === this.selected) ?? null;
  }
  get activeGrid() {
    return this.region?.grid ?? this.page?.grid ?? null;
  }
  get extra(): PlanLayer[] {
    const d = this.preview?.diff;
    return d
      ? [
          { id: 'added', geometry: d.added, color: '#00c878' },
          { id: 'removed', geometry: d.removed, color: '#ed4561' },
        ]
      : [];
  }
  get unlocked() {
    return !this.busy;
  }
  private async run(action: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    this.cd.markForCheck();
    try {
      await action();
    } catch (e: any) {
      this.error = e?.error?.message ?? e?.message ?? 'The operation failed.';
    } finally {
      this.busy = false;
      this.cd.markForCheck();
    }
  }
  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.uploadFile(file);
    input.value = '';
  }
  allowDrop(event: DragEvent) {
    event.preventDefault();
  }
  async drop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file && !this.busy) await this.uploadFile(file);
  }
  private async uploadFile(file: File) {
    if (this.dirty && !confirm('Open another file and discard unsaved corrections?')) return;
    clearTimeout(this.timer);
    await this.run(async () => {
      const { id } = await firstValueFrom(
        this.api.upload(this.context.slug(), this.venueId(), file, this.freshReview),
      );
      this.currentDocumentId = id;
      this.page = null;
      this.step = 0;
      this.dirty = false;
      this.results = [];
      this.notice = '';
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { document: id },
        replaceUrl: true,
      });
      await this.load(id);
    });
  }
  async load(id = this.doc?.id) {
    if (!id || this.destroyed) return;
    try {
      const doc = await firstValueFrom(this.api.get(this.context.slug(), this.venueId(), id));
      if (this.destroyed || id !== this.currentDocumentId) return;
      const newlyLoaded =
        this.step === 0 ||
        this.doc?.id !== doc.id ||
        this.doc.status !== 'ready' ||
        doc.halls.some(
          (h) => !h.savedHallId && this.doc?.halls.find((old) => old.key === h.key)?.savedHallId,
        );
      this.acceptDocument(doc);
      if (doc.status === 'ready') {
        const selected = this.selectedHalls;
        this.setPage(Math.min(this.pageIndex, doc.pages.length - 1));
        if (newlyLoaded) {
          this.step = selected.length === 1 ? 2 : 1;
          if (selected.length === 1) this.focusHallLocally(selected[0]);
          if (doc.halls.length && !selected.length) this.step = 3;
        } else if (this.activeHall) this.focusHallLocally(this.activeHall);
      }
      if (doc.status === 'reading') this.timer = setTimeout(() => void this.load(id), 1800);
      else if (doc.status === 'failed') this.error = doc.error ?? 'Could not read plan.';
    } catch (e: any) {
      this.error = e?.error?.message ?? e.message;
    } finally {
      this.cd.markForCheck();
    }
  }
  setPage(index: number) {
    if (index < 0) return;
    this.pageIndex = index;
    this.page = structuredClone(this.doc!.pages[index]);
    this.selected = '';
    this.viewMode = 'source';
    this.draft = [];
    this.mode = 'select';
    this.preview = null;
    this.dirty = false;
    setTimeout(() => this.canvas?.fit());
  }
  switchPage(index: number) {
    if (
      this.dirty &&
      !confirm('Discard unsaved edits on this page? Apply edits first to keep them.')
    )
      return;
    this.setPage(index);
  }
  changed() {
    if (this.page) this.page = { ...this.page };
    this.dirty = true;
    this.preview = null;
    this.viewMode = 'source';
  }
  select(id: string) {
    this.selected = id;
    this.mode = 'select';
    this.draft = [];
  }
  move(event: { id: string; geometry: MultiPolygon }) {
    const r =
      this.page?.regions.find((r) => r.id === event.id) ??
      this.page?.objects.find((o) => o.id === event.id);
    if (r) {
      r.geometry = event.geometry;
      r.confirmed = false;
      this.page = { ...this.page! };
      this.changed();
    }
  }
  setMode(mode: string) {
    this.mode = mode;
    this.draft = [];
  }
  addPoint(p: Point) {
    this.draft = [...this.draft, p];
    if ((this.mode === 'calibrate' || this.mode === 'dimension') && this.draft.length > 2)
      this.draft = [p];
  }
  finish() {
    if (!this.page) return;
    const id = crypto.randomUUID();
    if (this.mode === 'calibrate' || this.mode === 'dimension') {
      if (this.draft.length !== 2 || !(this.knownDistance > 0)) return;
      const [a, b] = this.draft,
        length = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (length < 1e-6) return;
      if (this.mode === 'calibrate') {
        this.page.calibration = {
          metresPerUnit: this.knownDistance / length,
          source: `User measured ${this.knownDistance} m between two source points`,
          confirmed: true,
        };
        this.page.regions.forEach((r) => (r.confirmed = false));
      } else
        this.page.dimensions.push({
          id,
          label: `Dimension ${this.knownDistance} m`,
          a,
          b,
          metres: this.knownDistance,
          regionId: this.region?.role === 'hall' ? this.region.id : null,
          confirmed: true,
        });
    } else {
      if (this.draft.length < 3) return;
      const geometry: MultiPolygon = [[[...this.draft, [...this.draft[0]]]]];
      if (this.mode === 'replace' && this.region) {
        this.region.geometry = geometry;
        this.region.confirmed = false;
      } else if (this.mode === 'hole' && this.region) {
        this.region.geometry[0].push(geometry[0][0]);
        this.region.confirmed = false;
      } else if (this.mode === 'object') {
        const o: PlanObject = {
          id,
          kind: 'unknown',
          label: 'Source area',
          geometry,
          color: '#d69032',
          confirmed: false,
          evidence: { source: 'user', detail: 'Boundary drawn in review' },
        };
        this.page.objects.push(o);
        this.selected = id;
      } else {
        const r: PlanRegion = {
          id,
          name: this.mode === 'hall' ? `Hall ${this.halls.length + 1}` : 'Foyer',
          role: this.mode === 'hall' ? 'hall' : 'foyer',
          geometry,
          hallIds: [],
          confirmed: false,
          grid: this.page.grid ? { ...this.page.grid } : null,
          printedArea: null,
        };
        this.page.regions.push(r);
        this.selected = id;
      }
    }
    this.page = { ...this.page };
    this.changed();
    this.mode = 'select';
    this.draft = [];
  }
  remove() {
    if (!this.page) return;
    const id = this.selected;
    this.page.regions = this.page.regions.filter((r) => r.id !== id);
    this.page.regions.forEach((r) => (r.hallIds = r.hallIds.filter((x) => x !== id)));
    this.page.objects = this.page.objects.filter((o) => o.id !== id);
    this.page.dimensions = this.page.dimensions.filter((d) => d.regionId !== id);
    this.page.annotations = this.page.annotations
      ?.map((a) => ({ ...a, regionIds: a.regionIds.filter((r) => r !== id) }))
      .filter((a) => a.regionIds.length);
    this.selected = '';
    this.page = { ...this.page };
    this.changed();
  }
  toggleOwner(region: PlanRegion, id: string, on: boolean) {
    region.hallIds = on
      ? [...new Set([...region.hallIds, id])]
      : region.hallIds.filter((x) => x !== id);
    region.confirmed = false;
    this.changed();
  }
  setGrid(field: keyof Grid, value: number) {
    if (!this.page) return;
    const owner = this.region ?? this.page;
    owner.grid = {
      ...(owner.grid ?? { x: 0, y: 0, width: 1, height: 1, rotation: 0 }),
      [field]: value,
    };
    this.page = { ...this.page };
    this.changed();
  }
  newGrid() {
    if (!this.page) return;
    const owner = this.region ?? this.page;
    const s = this.page.calibration.metresPerUnit ?? 1;
    owner.grid = { x: 0, y: 0, width: 1 / s, height: 1 / s, rotation: 0 };
    this.page = { ...this.page };
    this.changed();
  }
  private async persistPage() {
    if (!this.doc || !this.page || !this.dirty) return;
    const doc = await firstValueFrom(
      this.api.edit(this.context.slug(), this.venueId(), this.doc.id, this.doc.revision, this.page),
    );
    this.acceptDocument(doc);
    this.page = structuredClone(doc.pages[this.pageIndex]);
    this.dirty = false;
    this.notice = '';
  }
  async apply() {
    await this.run(async () => {
      await this.persistPage();
      if (!this.activeHall && this.selected) {
        const h = this.doc?.halls.find((h) => h.regionId === this.selected);
        if (h) this.activeHallKey = h.key;
      }
      if (!this.activeHall && this.selectedHalls.length)
        this.focusHallLocally(this.selectedHalls[0]);
      if (!this.doc?.halls.length) this.step = 1;
      this.correctionsOpen = false;
    });
  }
  async showPreview(h = this.activeHall) {
    if (!h || !this.doc) return;
    await this.run(async () => {
      await this.persistPage();
      const result = await firstValueFrom(
        this.api.preview(
          this.context.slug(),
          this.venueId(),
          this.doc!.id,
          h.key,
          this.targets[h.key] ?? '',
        ),
      );
      if (!result.floor) {
        this.error = 'Set the size of the plan before previewing this hall.';
        return;
      }
      this.preview = result;
      this.previewKey = h.key;
      this.previewTarget = this.targets[h.key] ?? '';
      this.viewMode = 'floor';
      this.correctionsOpen = false;
      setTimeout(() => this.canvas?.fit());
    });
  }
  ready(h: PlanReview) {
    return (
      !h.savedHallId &&
      this.inspected[h.key] &&
      this.inspectionStamps[h.key] === this.reviewStamp(h) &&
      h.checks.every((c) => c.status === 'pass' || (c.overridable && this.ack[c.id]))
    );
  }
  async save(only?: PlanReview) {
    if (!this.doc || this.dirty) return;
    const selected = only ? [only] : this.selectedHalls;
    if (!selected.length || selected.some((h) => !this.ready(h))) {
      this.error = 'Select halls, inspect their previews and resolve their checks before saving.';
      return;
    }
    await this.run(async () => {
      this.results = await firstValueFrom(
        this.api.commit(
          this.context.slug(),
          this.venueId(),
          this.doc!.id,
          this.doc!.revision,
          selected.map((h) => ({
            key: h.key,
            name: this.names[h.key] ?? h.name,
            targetHallId: this.targets[h.key] || null,
            expectedVersion: h.existing.find((e) => e.id === this.targets[h.key])?.version ?? null,
            acknowledgements: h.checks.filter((c) => this.ack[c.id]).map((c) => c.id),
          })),
        ),
      );
      await this.load();
    });
  }
  download() {
    if (!this.preview?.config) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.preview.config, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reviewed-hall.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  discardPreview() {
    this.viewMode = 'source';
    setTimeout(() => this.canvas?.fit());
  }
  get allChosen() {
    const available = this.doc?.halls.filter((h) => !h.savedHallId) ?? [];
    return available.length > 0 && available.every((h) => this.chosen[h.key]);
  }
  chooseAll(on: boolean) {
    for (const h of this.doc?.halls ?? []) if (!h.savedHallId) this.chosen[h.key] = on;
  }
  async viewCandidate(h: PlanReview) {
    await this.selectPage(this.doc!.pages.findIndex((p) => p.number === h.page));
    this.selected = h.regionId;
  }
  get drawingInstruction() {
    return (
      (
        {
          hall: 'Click around the hall boundary.',
          foyer: 'Click around the foyer boundary.',
          object: 'Click around this area.',
          replace: 'Click around the corrected boundary.',
          hole: 'Click around the opening in the floor.',
          calibrate: 'Click the two ends of a known distance.',
          dimension: 'Click the two ends of a dimension shown on the plan.',
        } as Record<string, string>
      )[this.mode] ?? 'Click on the plan.'
    );
  }
  get canFinishDrawing() {
    return this.mode === 'calibrate' || this.mode === 'dimension'
      ? this.draft.length === 2 && this.knownDistance > 0
      : this.draft.length >= 3;
  }
  confirmObjectKind(o: PlanObject) {
    o.confirmed = o.kind !== 'unknown';
    o.evidence = { source: 'user', detail: 'Meaning chosen after source review' };
    this.changed();
  }
  confirmRestrictions(on: boolean) {
    if (!this.activeRegion || !this.page) return;
    this.activeRegion.restrictionsConfirmed = on;
    // The review checkbox confirms identified restrictions in this hall's footprint.
    // Unknown colour-only proposals still require an explicit kind choice.
    for (const o of this.hallObjects) if (o.kind !== 'unknown') o.confirmed = on;
    this.changed();
  }
  linkFoyer(z: PlanRegion) {
    const id = this.activeHall?.regionId;
    if (id) {
      this.toggleOwner(z, id, true);
      this.selected = z.id;
    }
  }
  /** A foyer of a saved hall is part of that hall's saved floor: only a new review changes it. */
  savedFoyer(z: PlanRegion) {
    return !!this.page && z.hallIds.some((id) => this.doc?.committed[`${this.page!.number}:${id}`]);
  }
  ownerNames(z: PlanRegion) {
    return this.halls
      .filter((h) => z.hallIds.includes(h.id))
      .map((h) => h.name)
      .join(', ');
  }
  stampFor(h: PlanReview) {
    return this.reviewStamp(h);
  }
  get selectedHalls() {
    return this.doc?.halls.filter((h) => this.chosen[h.key] && !h.savedHallId) ?? [];
  }
  get activeHall() {
    return this.doc?.halls.find((h) => h.key === this.activeHallKey) ?? null;
  }
  get activeRegion() {
    return this.page?.regions.find((r) => r.id === this.activeHall?.regionId) ?? null;
  }
  get linkedFoyers() {
    return (
      this.page?.regions.filter(
        (r) =>
          (r.role === 'foyer' || r.role === 'circulation') &&
          r.hallIds.includes(this.activeHall?.regionId ?? ''),
      ) ?? []
    );
  }
  get otherFoyers() {
    return (
      this.page?.regions.filter(
        (r) =>
          (r.role === 'foyer' || r.role === 'circulation') &&
          !r.hallIds.includes(this.activeHall?.regionId ?? ''),
      ) ?? []
    );
  }
  get activeIndex() {
    return this.selectedHalls.findIndex((h) => h.key === this.activeHallKey);
  }
  get canSaveAll() {
    return (
      this.selectedHalls.length > 0 && !this.dirty && this.selectedHalls.every((h) => this.ready(h))
    );
  }
  get metricGrid() {
    return this.activeRegion?.grid ?? this.page?.grid ?? null;
  }
  get sizeKnown() {
    return !!this.page?.calibration.confirmed && (this.page.calibration.metresPerUnit ?? 0) > 0;
  }
  get pendingObjects() {
    return this.hallObjects.filter((o) => !o.confirmed || o.kind === 'unknown');
  }
  get helperAnnotations() {
    const ids = new Set([this.activeHall?.regionId, ...this.linkedFoyers.map((z) => z.id)]);
    return this.page?.annotations?.filter((a) => a.regionIds.some((id) => ids.has(id))) ?? [];
  }
  get hallObjects() {
    const hall = this.activeRegion;
    if (!hall || !this.page) return [];
    const b = this.geometryBounds(
      [hall.geometry, ...this.linkedFoyers.map((z) => z.geometry)].flat(),
    );
    return this.page.objects.filter((o) => {
      const q = this.geometryBounds(o.geometry);
      return (
        q.x <= b.x + b.width &&
        q.x + q.width >= b.x &&
        q.y <= b.y + b.height &&
        q.y + q.height >= b.y
      );
    });
  }
  private acceptDocument(doc: PlanView) {
    if (this.doc?.id !== doc.id) {
      this.inspected = {};
      this.inspectionStamps = {};
      this.ack = {};
      this.names = {};
      this.targets = {};
      this.chosen = Object.fromEntries(
        doc.halls.filter((h) => !h.savedHallId).map((h) => [h.key, true]),
      );
      this.activeHallKey = '';
    } else {
      const oldChecks = new Map(
        this.doc.halls.flatMap((h) => h.checks.map((c) => [c.id, JSON.stringify(c)] as const)),
      );
      for (const h of doc.halls)
        for (const c of h.checks)
          if (oldChecks.get(c.id) !== JSON.stringify(c)) delete this.ack[c.id];
      for (const h of doc.halls) {
        const wasSaved = this.doc.halls.find((old) => old.key === h.key)?.savedHallId;
        if (wasSaved && !h.savedHallId) {
          this.chosen[h.key] = true;
          delete this.inspected[h.key];
          delete this.inspectionStamps[h.key];
          delete this.targets[h.key];
          this.results = this.results.filter((result) => result.key !== h.key);
        } else if (!(h.key in this.chosen)) this.chosen[h.key] = !h.savedHallId;
      }
    }
    this.doc = doc;
  }
  private focusHallLocally(h: PlanReview) {
    const index = this.doc!.pages.findIndex((p) => p.number === h.page);
    if (index !== this.pageIndex || !this.page || this.page.number !== h.page) this.setPage(index);
    this.activeHallKey = h.key;
    this.selected = h.regionId;
    this.preview = null;
    this.viewMode = 'source';
    this.correctionsOpen = false;
    this.mode = 'select';
    this.draft = [];
    setTimeout(() => this.canvas?.fit());
  }
  async focusHall(h: PlanReview) {
    await this.run(async () => {
      await this.persistPage();
      this.focusHallLocally(h);
    });
  }
  async startReview() {
    const h = this.selectedHalls[0];
    if (!h) return;
    await this.run(async () => {
      await this.persistPage();
      this.step = 2;
      this.focusHallLocally(h);
    });
  }
  async nextHall() {
    const h = this.activeHall;
    if (!h || !this.ready(h) || this.dirty) return;
    const next = this.selectedHalls[this.activeIndex + 1];
    if (next) await this.focusHall(next);
    else this.step = 3;
  }
  backToSelection() {
    if (this.dirty) {
      this.error = 'Finish your corrections before changing the selection.';
      return;
    }
    this.step = 1;
    this.preview = null;
    this.viewMode = 'source';
  }
  pickShape(id: string) {
    if (this.step === 1) {
      this.selected = id;
      return;
    }
    if (this.correctionsOpen) {
      this.select(id);
      return;
    }
    const h = this.selectedHalls.find((h) => h.regionId === id && h.page === this.page?.number);
    if (h && h.key !== this.activeHallKey) void this.focusHall(h);
  }
  editShape(id = this.activeHall?.regionId ?? '') {
    this.selected = id;
    this.correctionsOpen = true;
    this.viewMode = 'source';
    this.mode = 'select';
    this.draft = [];
  }
  addHall() {
    if (!this.page) return;
    this.step = 2;
    this.activeHallKey = '';
    this.correctionsOpen = true;
    this.viewMode = 'source';
    this.setMode('hall');
  }
  targetChanged(h: PlanReview) {
    delete this.inspected[h.key];
    delete this.inspectionStamps[h.key];
    this.preview = null;
    this.viewMode = 'source';
  }
  inspectHall(on: boolean) {
    const h = this.activeHall;
    if (!h) return;
    this.inspected[h.key] = on;
    if (on) this.inspectionStamps[h.key] = this.reviewStamp(h);
  }
  missingChecks(h: PlanReview) {
    return h.checks.filter(
      (c) =>
        c.status !== 'pass' &&
        ((this.checkCode(c) === 'area' && c.expected === undefined) ||
          this.checkCode(c) === 'dimensions'),
    );
  }
  missingAccepted(h: PlanReview) {
    return this.missingChecks(h).every((c) => this.ack[c.id]);
  }
  acceptMissing(h: PlanReview, on: boolean) {
    for (const c of this.missingChecks(h)) this.ack[c.id] = on;
  }
  issues(h: PlanReview) {
    const basic = new Set(['boundary', 'restrictions', 'zones', 'objects']);
    if (this.dirty || !this.sizeKnown) basic.add('scale');
    if (this.dirty || !this.metricGrid) basic.add('grid');
    const missing = new Set(this.missingChecks(h).map((c) => c.id));
    return h.checks.filter(
      (c) => c.status !== 'pass' && !basic.has(this.checkCode(c)) && !missing.has(c.id),
    );
  }
  passedCount(h: PlanReview) {
    return h.checks.filter((c) => c.status === 'pass').length;
  }
  checkCode(c: PlanCheck) {
    return c.id.slice(c.id.lastIndexOf(':') + 1);
  }
  checkLabel(c: PlanCheck) {
    const code = this.checkCode(c);
    return (
      (
        {
          area: 'Area differs from the printed plan',
          square: 'Grid cells are not square',
          'grid-note': 'Grid size differs from the plan',
          unassigned: 'A foyer has no linked hall',
          geometry: 'The hall boundary needs correction',
        } as Record<string, string>
      )[code] ?? c.label
    );
  }
  kindLabel(kind: string) {
    return (
      (
        {
          wall: 'Wall',
          column: 'Column',
          passage: 'Passage',
          fire_curtain: 'Fire curtain',
          no_build: 'No construction',
          utility: 'Utility point',
          entry: 'Entry / exit',
          unavailable: 'Unavailable area',
          void: 'Opening in the floor',
          facility: 'Facility / room',
          marking: 'Drawing only — no restriction',
          unknown: 'Choose what this area is',
        } as Record<string, string>
      )[kind] ?? kind
    );
  }
  setCellSize() {
    const g = this.metricGrid,
      value = this.gridCellMetres;
    if (!g || !this.page || !value || value <= 0) return;
    this.page.calibration = {
      metresPerUnit: value / g.width,
      source: `User confirmed one grid cell is ${value} m wide`,
      confirmed: true,
    };
    this.changed();
  }
  setDesignGrid() {
    const scale = this.page?.calibration.metresPerUnit,
      value = this.designGridMetres,
      r = this.activeRegion;
    if (!scale || !value || value <= 0 || !r) return;
    const b = this.geometryBounds(r.geometry);
    const old = r.grid ?? this.page?.grid;
    r.grid = {
      x: old?.x ?? b.x,
      y: old?.y ?? b.y,
      width: value / scale,
      height: value / scale,
      rotation: old?.rotation ?? 0,
    };
    this.changed();
  }
  async selectPage(index: number) {
    await this.run(async () => {
      await this.persistPage();
      this.setPage(index);
    });
  }
  private reviewStamp(h: PlanReview) {
    const p =
        this.page?.number === h.page ? this.page : this.doc?.pages.find((p) => p.number === h.page),
      r = p?.regions.find((r) => r.id === h.regionId);
    if (!p || !r) return '';
    const zones = p.regions.filter((z) => z.hallIds.includes(r.id));
    const b = this.geometryBounds([r.geometry, ...zones.map((z) => z.geometry)].flat());
    const objects = p.objects.filter((o) => {
      const q = this.geometryBounds(o.geometry);
      return (
        q.x <= b.x + b.width &&
        q.x + q.width >= b.x &&
        q.y <= b.y + b.height &&
        q.y + q.height >= b.y
      );
    });
    return JSON.stringify({
      r,
      zones,
      objects,
      calibration: p.calibration,
      grid: p.grid,
      dimensions: p.dimensions.filter((d) => d.regionId === r.id || d.regionId === null),
      annotations: p.annotations?.filter((a) =>
        a.regionIds.some((id) => id === r.id || zones.some((z) => z.id === id)),
      ),
      target: this.targets[h.key] ?? '',
    });
  }
  geometryBounds(g: MultiPolygon) {
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const p of g.flat(2)) {
      x = Math.min(x, p[0]);
      y = Math.min(y, p[1]);
      right = Math.max(right, p[0]);
      bottom = Math.max(bottom, p[1]);
    }
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }
  thumbnailBox(h: PlanReview) {
    const r = this.doc?.pages
      .find((p) => p.number === h.page)
      ?.regions.find((r) => r.id === h.regionId);
    if (!r) return '0 0 100 100';
    const b = this.geometryBounds(r.geometry),
      pad = Math.max(b.width, b.height) * 0.05;
    return `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`;
  }
  thumbnailPath(h: PlanReview) {
    const r = this.doc?.pages
      .find((p) => p.number === h.page)
      ?.regions.find((r) => r.id === h.regionId);
    return (
      r?.geometry
        .flat()
        .map((ring) => 'M ' + ring.map((p) => p.join(' ')).join(' L ') + ' Z')
        .join(' ') ?? ''
    );
  }
  resultName(key: string) {
    return this.doc?.halls.find((h) => h.key === key)?.name ?? 'Hall';
  }
  removeDimension(id: string) {
    if (this.page) {
      this.page.dimensions = this.page.dimensions.filter((d) => d.id !== id);
      this.changed();
    }
  }
  objectChanged() {
    if (this.object) {
      this.object.confirmed = false;
      this.object.evidence = { source: 'user', detail: 'Kind selected during source review' };
    }
    this.changed();
  }
}
