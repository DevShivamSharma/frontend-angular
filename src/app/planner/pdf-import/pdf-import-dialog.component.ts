import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { extractErrorMessage } from '../../core/http-error.util';
import { NotifyService } from '../../core/notify.service';
import { IconComponent } from '../components/icon.component';
import { LayoutApiService } from '../layout-api.service';
import type { Hall } from '../models/hall.model';
import type { Stall } from '../models/stall.model';
import { PlannerStore } from '../planner-store.service';
import type { PdfImportResult, PdfStall } from './pdf-import.model';
import {
  autoFit,
  centredAlignment,
  cellCentres,
  checkRules,
  defaultTarget,
  FloorMask,
  importHall,
  matchGroups,
  needsHalfMetres,
  placeOutline,
  toPlannerStall,
  type Alignment,
  type QuarterTurn,
  type RuleCheck,
} from './pdf-import-plan';
import { PdfImportPickComponent } from './pdf-import-pick.component';
import { PdfPlanViewComponent, type PlanViewMode } from './pdf-plan-view.component';
import { renderPdfPage, type PageImage } from './pdf-underlay';

const NEW_HALL = '__new__';
const MAX_BYTES = 25 * 1024 * 1024;

type Step = 'pick' | 'reading' | 'review';
type Filter = 'review' | 'all';

const RULE_LABELS: Record<string, string> = {
  INVALID_TOUCHING: 'touch a neighbour other than back-to-back',
  PERIPHERAL_CLEARANCE: 'are closer to a wall than the clearance',
  CORNER_PASSAGE: 'lack the corner passage',
  PATHWAY_WIDTH: 'have a passage narrower than required',
  OPEN_SIDE_BLOCKED: 'have an open side blocked',
  OPEN_SIDE_PASSAGE: 'lack room in front of an open side',
  OUTSIDE_HALL: 'are outside the hall floor',
  STALL_OVERLAP: 'overlap another stall',
  RESTRICTED_ZONE: 'are in a restricted zone',
  INVALID_DIMENSIONS: 'have a size off the hall size step',
  INVALID_OPEN_SIDES: 'have no open side',
  INVALID_BACK_TO_BACK: 'are back-to-back without opposite openings',
};

/**
 * Import a CAD hall plan (PDF): upload -> the server detects the stalls -> align them to a planner
 * hall (by default the one being worked on) -> review over the drawing -> confirm into the editor
 * as a new, unsaved layout on that hall.
 *
 * Nothing is guessed silently: every conflict and uncertain item from the drawing is listed, the
 * planner's own rules are checked and reported (never relaxed), and the user decides what goes in.
 */
@Component({
  selector: 'app-pdf-import-dialog',
  imports: [IconComponent, PdfImportPickComponent, PdfPlanViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pdf-import-dialog.component.html',
  styleUrl: './pdf-import-dialog.component.css',
})
export class PdfImportDialogComponent {
  /** The dialog closed, imported or not (the drafting PDFPLOT command waits for it). */
  readonly closed = output<void>();
  readonly store = inject(PlannerStore);
  private readonly injector = inject(Injector);
  private readonly api = inject(LayoutApiService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');

  readonly step = signal<Step>('pick');
  readonly error = signal('');
  readonly fileName = signal('');
  readonly result = signal<PdfImportResult | null>(null);
  readonly page = signal<PageImage | null>(null);
  readonly pageError = signal('');
  readonly targetId = signal<string>(NEW_HALL);
  readonly groups = signal<string[]>([]);
  readonly alignment = signal<Alignment | null>(null);
  readonly include = signal<Record<string, boolean>>({});
  readonly names = signal<Record<string, string>>({});
  readonly selectedKey = signal<string | null>(null);
  readonly filter = signal<Filter>('review');
  readonly mode = signal<PlanViewMode>('drawing');
  readonly nudgeGroup = signal('');
  readonly check = signal<RuleCheck | null>(null);
  readonly checking = signal(false);
  private stamp = Date.now();
  private readToken = 0;
  private opener: HTMLElement | null = null;

  readonly NEW_HALL = NEW_HALL;
  readonly halls = this.store.halls;
  readonly targetHall = computed<Hall | null>(() => this.halls().find(h => String(h.id) === this.targetId()) ?? null);
  readonly workHall = computed<Hall | null>(() => {
    const r = this.result();
    return r && this.groups().length ? importHall(this.targetHall(), r, this.groups(), this.stamp) : null;
  });
  private readonly mask = computed(() => {
    const hall = this.workHall();
    return hall ? FloorMask.forHall(hall) : null;
  });

  readonly stalls = computed(() => {
    const groups = new Set(this.groups());
    return (this.result()?.stalls ?? []).filter(s => groups.has(s.group));
  });
  readonly includedStalls = computed(() => this.stalls().filter(s => this.isIncluded(s)));
  readonly needsReview = computed(() => this.stalls().filter(s => s.confidence !== 'high' || !s.include));
  readonly listed = computed(() => (this.filter() === 'review' ? this.needsReview() : this.stalls()));
  readonly selected = computed(() => this.result()?.stalls.find(s => s.key === this.selectedKey()) ?? null);

  readonly summary = computed(() => {
    const r = this.result();
    if (!r) return null;
    const count = (shape: PdfStall['shape']) => r.stalls.filter(s => s.shape === shape).length;
    return {
      total: r.stalls.length,
      rectangles: count('rectangle'),
      lShapes: count('L-shape'),
      polygons: count('polygon'),
      errors: r.stalls.filter(s => s.issues.some(i => i.severity === 'error')).length,
    };
  });

  readonly groupInfo = computed(() =>
    (this.result()?.groups ?? []).map(g => ({
      ...g,
      stalls: this.result()!.stalls.filter(s => s.group === g.group).length,
      label: g.group === '?' ? 'Unnumbered' : `Hall ${g.group}`,
    })),
  );

  /** Placed outlines of the included stalls, and how many are wholly on the hall's free floor. */
  readonly placement = computed(() => {
    const align = this.alignment();
    const mask = this.mask();
    const stalls = this.includedStalls();
    if (!align || !mask) return { onFloor: 0, total: stalls.length };
    const onFloor = stalls.filter(s => cellCentres(placeOutline(s, align)).every(p => mask.free(p))).length;
    return { onFloor, total: stalls.length };
  });

  readonly plannerStalls = computed<Stall[]>(() => {
    const align = this.alignment();
    const hall = this.workHall();
    if (!align || !hall) return [];
    const names = this.names();
    return this.includedStalls()
      .map(s => toPlannerStall(s, placeOutline(s, align), hall.id, (names[s.key] ?? s.name).trim() || s.name))
      .filter((s): s is Stall => s !== null);
  });

  readonly ruleIssueKeys = computed(() => {
    const c = this.check();
    const out = new Set<string>();
    if (!c) return out;
    for (const [id, v] of c.violations) if (v.length) out.add(keyOf(id));
    return out;
  });

  readonly ruleSummary = computed(() => {
    const c = this.check();
    if (!c) return [];
    return Object.entries(c.codes)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ code, n, text: RULE_LABELS[code] ?? code }));
  });

  readonly selectedRuleViolations = computed(() => {
    const c = this.check();
    const hall = this.workHall();
    const key = this.selectedKey();
    return c && hall && key ? c.violations.get(`${hall.id}:${key}`) ?? [] : [];
  });

  readonly halfMetres = computed(() => {
    const r = this.result();
    return !!r && needsHalfMetres(r, this.groups());
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.releasePage());
    // Every "Import PDF plan" (and a PDF picked with the Excel button) arrives as a request.
    // Opened after render, so the first request also works while this dialog is still loading.
    effect(() => {
      const request = this.store.pdfImport();
      if (!request) return;
      untracked(() => {
        this.store.pdfImport.set(null);
        afterNextRender(() => {
          this.open();
          if (request.file) {
            this.restart();
            void this.read(request.file);
          }
        }, { injector: this.injector });
      });
    });
  }

  // --- dialog ------------------------------------------------------------------------------------

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  onClosed(): void {
    this.opener?.focus?.();
    this.closed.emit();
  }

  restart(): void {
    this.readToken++;
    this.releasePage();
    this.result.set(null);
    this.check.set(null);
    this.error.set('');
    this.step.set('pick');
  }

  pick(): void {
    this.fileInput().nativeElement.click();
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.read(file);
  }

  async read(file: File): Promise<void> {
    this.error.set('');
    if (file.size > MAX_BYTES) {
      this.error.set('The PDF is larger than 25 MB.');
      return;
    }
    const bytes = await file.arrayBuffer();
    if (!new TextDecoder('latin1').decode(bytes.slice(0, 1024)).includes('%PDF-')) {
      this.error.set('This file is not a PDF.');
      return;
    }
    this.fileName.set(file.name);
    this.step.set('reading');
    this.releasePage();
    this.pageError.set('');
    const token = ++this.readToken;
    // The underlay can take longer than the extraction (a full plan is heavy to draw): the review
    // opens as soon as the stalls are in, and the drawing appears under them when ready.
    renderPdfPage(bytes).then(
      image => (token === this.readToken ? this.page.set(image) : URL.revokeObjectURL(image.url)),
      () => token === this.readToken && this.pageError.set('The drawing could not be shown here; the outlines are still reviewable.'),
    );
    try {
      const extracted = await this.api.importPdf(new Blob([bytes], { type: 'application/pdf' }), file.name);
      if (token === this.readToken) this.start(extracted);
    } catch (e) {
      if (token !== this.readToken) return;
      this.error.set(extractErrorMessage(e));
      this.step.set('pick');
    }
  }

  private start(r: PdfImportResult): void {
    this.stamp = Date.now();
    this.result.set(r);
    this.include.set(Object.fromEntries(r.stalls.map(s => [s.key, s.include])));
    this.names.set({});
    this.selectedKey.set(null);
    this.check.set(null);
    this.filter.set('review');
    this.mode.set('drawing');
    // Default target: the hall the drawing belongs to (by its hall numbers); the selected hall
    // when it matches as well as any other, or when no hall matches.
    const match = defaultTarget(this.halls(), this.store.currentHall() ?? null, r.groups);
    const matched = match ? matchGroups(match.name, r.groups) : [];
    const groups = matched.length ? matched : r.groups.slice(0, 1).map(g => g.group);
    this.targetId.set(match ? String(match.id) : NEW_HALL);
    this.groups.set(groups);
    this.nudgeGroup.set(groups[0] ?? '');
    this.fitAlignment();
    this.step.set('review');
  }

  // --- target and alignment ------------------------------------------------------------------------

  setTarget(id: string): void {
    this.targetId.set(id);
    const r = this.result();
    const hall = this.targetHall();
    if (r && hall) {
      const matched = matchGroups(hall.name, r.groups);
      if (matched.length) this.groups.set(matched);
    }
    this.nudgeGroup.set(this.groups()[0] ?? '');
    this.fitAlignment();
  }

  toggleGroup(group: string, on: boolean): void {
    const all = (this.result()?.groups ?? []).map(g => g.group);
    this.groups.update(list => all.filter(g => (g === group ? on : list.includes(g))));
    if (!this.groups().includes(this.nudgeGroup())) this.nudgeGroup.set(this.groups()[0] ?? '');
    this.fitAlignment();
  }

  /** Best placement on the target hall (a new hall is sized to the drawing: just centre it). */
  fitAlignment(): void {
    const r = this.result();
    const hall = this.workHall();
    this.check.set(null);
    if (!r || !hall || !this.groups().length) {
      this.alignment.set(null);
      return;
    }
    this.alignment.set(this.targetHall() ? autoFit(r, this.groups(), hall).alignment : centredAlignment(r, this.groups(), hall));
  }

  resetAlignment(): void {
    const r = this.result();
    const hall = this.workHall();
    if (!r || !hall) return;
    this.check.set(null);
    this.alignment.set(centredAlignment(r, this.groups(), hall, this.alignment()?.rotation ?? 0));
  }

  rotate(by: 90 | -90): void {
    const r = this.result();
    const hall = this.workHall();
    const current = this.alignment();
    if (!r || !hall || !current) return;
    const rotation = ((((current.rotation + by) % 360) + 360) % 360) as QuarterTurn;
    this.check.set(null);
    this.alignment.set(centredAlignment(r, this.groups(), hall, rotation));
  }

  nudge(dx: number, dz: number, all = false): void {
    const a = this.alignment();
    if (!a) return;
    const targets = all ? this.groups() : [this.nudgeGroup()];
    const offsets = { ...a.offsets };
    for (const g of targets) if (offsets[g]) offsets[g] = { x: offsets[g].x + dx, z: offsets[g].z + dz };
    this.check.set(null);
    this.alignment.set({ ...a, offsets });
  }

  // --- review ------------------------------------------------------------------------------------

  isIncluded(s: PdfStall): boolean {
    return this.include()[s.key] ?? s.include;
  }

  setIncluded(key: string, on: boolean): void {
    this.include.update(m => ({ ...m, [key]: on }));
    this.check.set(null);
  }

  setAll(on: boolean): void {
    this.include.update(m => ({ ...m, ...Object.fromEntries(this.stalls().map(s => [s.key, on])) }));
    this.check.set(null);
  }

  rename(key: string, name: string): void {
    this.names.update(m => ({ ...m, [key]: name }));
  }

  nameOf(s: PdfStall): string {
    return this.names()[s.key] ?? s.name;
  }

  selectStall(key: string): void {
    this.selectedKey.set(this.selectedKey() === key ? null : key);
  }

  worst(s: PdfStall): 'error' | 'warning' | 'info' | null {
    if (s.issues.some(i => i.severity === 'error')) return 'error';
    if (s.issues.some(i => i.severity === 'warning')) return 'warning';
    return s.issues.length ? 'info' : null;
  }

  // --- rules and confirm -----------------------------------------------------------------------------

  runCheck(): void {
    const hall = this.workHall();
    if (!hall) return;
    this.checking.set(true);
    // Let the spinner paint: checking a full hall takes about a second.
    setTimeout(() => {
      try {
        this.check.set(checkRules(hall, this.plannerStalls(), this.store.eventType()));
        this.mode.set('hall');
      } finally {
        this.checking.set(false);
      }
    }, 30);
  }

  confirm(which: 'all' | 'compliant'): void {
    const hall = this.workHall();
    const check = this.check();
    if (!hall || !check) return;
    const keep = new Set(check.compliant);
    const stalls = which === 'all' ? this.plannerStalls() : this.plannerStalls().filter(s => keep.has(String(s.id)));
    if (!stalls.length) return;
    const base = this.fileName().replace(/\.pdf$/i, '');
    this.store.applyPdfImport(hall, stalls, `${hall.name.replace(/ \(PDF import\)$/, '')} · ${base}`);
    const flagged = which === 'all' ? stalls.filter(s => (check.violations.get(String(s.id)) ?? []).length).length : 0;
    this.notify.success(
      `${stalls.length} stalls imported`,
      flagged
        ? `${flagged} break planner rules and are listed under Rules; saving is possible once they are resolved.`
        : 'Review them in the planner, then save the layout.',
    );
    this.close();
  }

  private releasePage(): void {
    const p = this.page();
    if (p) URL.revokeObjectURL(p.url);
    this.page.set(null);
  }
}

function keyOf(stallId: string): string {
  return stallId.slice(stallId.lastIndexOf(':') + 1);
}
