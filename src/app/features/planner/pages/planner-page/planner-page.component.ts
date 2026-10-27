import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import {
  PlanContent,
  PlanObject,
  PlanSeat,
  PlanStall,
  PlanZone,
  stallLabel,
  StallSide,
} from '../../domain/plan.models';
import type { Point } from '../../domain/floor-plan.models';
import { AppDialog } from '../../../../core/dialog/app-dialog.service';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import {
  AutoBoothsData,
  AutoBoothsDialogComponent,
  FillRegion,
} from '../../components/auto-booths-dialog/auto-booths-dialog.component';
import {
  PlanHallData,
  PlanHallDialogComponent,
  PlanHallResult,
} from '../../components/plan-hall-dialog/plan-hall-dialog.component';
import type { PlanBrief } from '../../domain/planner-plan';
import {
  PlannerRulesData,
  PlannerRulesDialogComponent,
} from '../../components/planner-rules-dialog/planner-rules-dialog.component';
import {
  AutoSeatsData,
  AutoSeatsDialogComponent,
} from '../../components/auto-seats-dialog/auto-seats-dialog.component';
import {
  CutCellEvent,
  DrawObjectEvent,
  MoveEvent,
  PickEvent,
  PlannerCanvasComponent,
  PlannerTool,
} from '../../components/planner-canvas/planner-canvas.component';
import {
  centre,
  DEFAULT_OPEN,
  newId,
  objectOutline,
  pointInRing,
  polygonArea,
  Rect,
  rectRing,
  ringBox,
  round,
  snap,
  stallNumbers,
  stallRect,
  ZONE_COLORS,
  zoneAt,
} from '../../domain/planner-geometry';
import {
  PlannerPropertiesComponent,
  StallPatch,
} from '../../components/planner-properties/planner-properties.component';
import { saveBlob } from '../../../../shared/files/save-blob';
import type { PlanAttachment } from '../../domain/plan.models';
import { priceBandsOf, SCHEME_COLORS } from '../../domain/price-bands';
import { rupees } from '../../domain/stall-price';
import { ApiError } from '../../../../core/http/api-error';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PlansApiService } from '../../data/plans-api.service';
import { RulesApiService } from '../../../rules/data/rules-api.service';
import type { RuleCatalogue } from '../../../rules/data/rules.models';
import { PlannerStore } from '../../state/planner.store';
import { PlanReviewComponent } from '../../components/plan-review/plan-review.component';
import { HasUnsavedChanges } from '../../../../shared/guards/unsaved-changes.guard';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  DrawingImportDialogComponent,
  type DrawingImportData,
  type DrawingImportOutcome,
} from '../../components/drawing-import-dialog/drawing-import-dialog.component';
import { PlannerSkeletonComponent } from '../../components/planner-skeleton/planner-skeleton.component';
import {
  RateCardData,
  RateCardDialogComponent,
} from '../../components/rate-card-dialog/rate-card-dialog.component';
import {
  StallPricesData,
  StallPricesDialogComponent,
} from '../../components/stall-prices-dialog/stall-prices-dialog.component';
import type { RateCardView } from '../../domain/rate-card.models';
import { LayoutService } from '../../../../core/layout/layout.service';
import { ShortcutsDialogComponent } from '../../components/shortcuts-dialog/shortcuts-dialog.component';
import { PlannerAssistantComponent } from '../../components/planner-assistant/planner-assistant.component';
import { type PlannerAgentCtx } from '../../domain/planner-agent';
import { type PlannerTourCtx, plannerTour } from '../../domain/planner-tour';
import { TourOverlayComponent } from '../../../../shared/tour/tour-overlay/tour-overlay.component';
import { TourService } from '../../../../shared/tour/tour.service';
import { RowData, RowDialogComponent } from '../../components/row-dialog/row-dialog.component';
import {
  ScaleData,
  ScaleDialogComponent,
} from '../../components/scale-dialog/scale-dialog.component';
import {
  SeatsData,
  SeatsDialogComponent,
} from '../../components/seats-dialog/seats-dialog.component';
import { cellCounts, cleanCutCells, stallArea } from '../../domain/stall-cells';

/** Colours of categories on the plan, in the order the hall lists them. */
const CATEGORY_COLORS = [
  '#86efac',
  '#fcd34d',
  '#93c5fd',
  '#f9a8d4',
  '#5eead4',
  '#fdba74',
  '#c4b5fd',
  '#bef264',
];

/** A side of a stall after the stall turns a quarter clockwise. */
const ROTATED: Record<StallSide, StallSide> = {
  top: 'right',
  right: 'bottom',
  bottom: 'left',
  left: 'top',
};
/** A side of a stall after it is mirrored left to right. */
const MIRRORED: Record<StallSide, StallSide> = {
  top: 'top',
  right: 'left',
  bottom: 'bottom',
  left: 'right',
};
/** A side of a stall after it is mirrored top to bottom. */
const FLIPPED: Record<StallSide, StallSide> = {
  top: 'bottom',
  right: 'right',
  bottom: 'top',
  left: 'left',
};
/** Rows the model tree shows; a search finds the rest. */
const TREE_LIMIT = 200;
/** Marks a plan file the planner writes (the assistant's export_plan). */
const PLAN_FILE_SCHEMA = 'stall-plan/1';
/** Drawings start in slate; Properties changes it. */
const OBJECT_COLOR = '#334155';

/**
 * The stall planner of one hall of an event: zones of any shape, booths one by one or filled
 * automatically, and seats. It opens on the floor version the event keeps, and every change is
 * checked against the rules of this event hall; a change that breaks one is not made.
 */
@Component({
  selector: 'app-planner-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    TooltipModule,
    IconComponent,
    PlannerCanvasComponent,
    PlannerPropertiesComponent,
    PlanReviewComponent,
    EmptyStateComponent,
    PlannerSkeletonComponent,
    PlannerAssistantComponent,
    TourOverlayComponent,
  ],
  providers: [PlannerStore, TourService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planner-page.component.html',
  styleUrl: './planner-page.component.scss',
})
export class PlannerPageComponent implements HasUnsavedChanges {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  protected readonly store = inject(PlannerStore);
  private readonly api = inject(PlansApiService);
  private readonly dialog = inject(AppDialog);
  private readonly rulesApi = inject(RulesApiService);
  /** Labels of the rules, loaded once; null when they could not be. */
  private rulesCatalogue: Promise<RuleCatalogue | null> | null = null;
  private readonly notifier = inject(NotifierService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly auth = inject(AuthService);
  private readonly canvas = viewChild<PlannerCanvasComponent>('canvas');

  protected readonly tool = signal<PlannerTool>('select');
  protected readonly canEdit = this.store.canEdit;
  /** The venue's team on an external event: they review the organiser's plan. */
  protected readonly reviewMode = computed(
    () => !!this.store.view()?.needsApproval && this.auth.isStaff(),
  );
  /** Back to the event the hall is in, under the list it belongs to. */
  protected readonly backLink = computed(() => [
    this.store.view()?.hall.event.kind === 'internal' ? '/events' : '/external-events',
    this.eventId(),
  ]);

  /** Where Back goes when the planner could not open: the event, under the list the URL came from. */
  private readonly router = inject(Router);
  protected readonly errorBack = computed(() => [
    this.router.url.startsWith('/external-events') ? '/external-events' : '/events',
    this.eventId(),
  ]);

  protected readonly showGrid = signal(true);
  protected readonly showLabels = signal(true);
  /** On a phone the panels start closed: the floor is what there is room for. */
  private readonly narrow =
    typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  protected readonly leftOpen = signal(remembered('planner.left', !this.narrow));
  protected readonly rightOpen = signal(remembered('planner.right', !this.narrow));
  /** The panels' widths, which the person may drag; kept between visits. */
  protected readonly leftWidth = signal(rememberedWidth('planner.leftWidth', 256));
  protected readonly rightWidth = signal(rememberedWidth('planner.rightWidth', 260));
  protected readonly zonesOpen = signal(true);
  protected readonly fullscreen = signal(false);
  protected readonly treeQuery = signal('');
  protected readonly splitView = signal(false);

  /** Line, Rect, Circle and Polyline, two to a column as the ribbon shows them. */
  protected readonly drawTools: Array<
    Array<{ id: PlannerTool; label: string; icon: string; tip: string }>
  > = [
    [
      { id: 'line', label: 'Line', icon: 'line', tip: 'Line (L)' },
      { id: 'rect', label: 'Rect', icon: 'crop_square', tip: 'Rectangle (R)' },
    ],
    [
      { id: 'circle', label: 'Circle', icon: 'circle', tip: 'Circle (C)' },
      { id: 'polyline', label: 'Polyline', icon: 'polyline', tip: 'Polyline' },
    ],
  ];

  /** A zone, or one drawn rectangle, can become a booth. */
  protected readonly canMakeBooth = computed(() => {
    const objects = this.store.selectedObjects();
    return !!this.store.selectedZone() || (objects.length === 1 && objects[0].kind === 'rect');
  });

  /** The 1 m grid profile asks for whole metres; else half-metre steps. */
  protected readonly snapStep = computed(() =>
    this.store.view()?.hall.rules.drawingProfile === 'grid' ? 1 : 0.5,
  );
  protected readonly rulesOn = computed(() => this.store.view()?.hall.hall.rulesOn ?? 0);
  protected readonly categoryColors = computed(
    () => new Map(this.store.categories().map((c, i) => [c.id, this.colorOf(i)] as const)),
  );
  /** Booths of the plan; reserved and booked come with bookings, not the plan. */
  protected readonly stats = computed(() => {
    const stalls = this.store.plan().stalls;
    const open = stalls.filter((s) => !s.isBlocked);
    return {
      total: stalls.length,
      blocked: stalls.length - open.length,
      available: open.filter((s) => s.isActive).length,
      saleable: open.reduce((sum, s) => sum + stallArea(s), 0),
    };
  });
  protected readonly treeCount = computed(
    () => this.store.plan().zones.length + this.store.plan().stalls.length,
  );
  /** Zones and stalls matching the search, the first {@link TREE_LIMIT} of them. */
  protected readonly tree = computed(() => {
    const q = this.treeQuery().trim().toLowerCase();
    const p = this.store.plan();
    const zones = p.zones
      .filter((z) => !q || z.name.toLowerCase().includes(q))
      .map((z) => ({ kind: 'zone' as const, id: z.id, label: z.name, color: z.color }));
    const stalls = p.stalls
      .filter((s) => !q || stallLabel(s).toLowerCase().includes(q))
      .map((s) => ({
        kind: 'stall' as const,
        id: s.id,
        label: `Stall ${stallLabel(s)}`,
        color: null,
      }));
    const all = [...zones, ...stalls];
    return { items: all.slice(0, TREE_LIMIT), more: all.length - TREE_LIMIT };
  });

  constructor() {
    // The first way to begin takes focus when the choice appears, so the keyboard starts there.
    effect(() => this.beginFirst()?.nativeElement.focus());
    // The planner takes the width: the navigation shrinks to icons while it is open.
    const layout = inject(LayoutService);
    layout.focus.set(true);
    inject(DestroyRef).onDestroy(() => layout.focus.set(false));
    effect(() => remember('planner.left', String(this.leftOpen())));
    effect(() => remember('planner.right', String(this.rightOpen())));
    // Leaving the planner closes what it opened: its dialogs, confirms and toasts.
    inject(DestroyRef).onDestroy(() => {
      this.dialog.closeAll();
    });
    effect(() => {
      const [eventId, hallId] = [this.eventId(), this.hallId()];
      untracked(() => void this.load(eventId, hallId));
    });
  }

  private async load(eventId: string, hallId: string): Promise<void> {
    this.loadError.set(null);
    try {
      const view = await firstValueFrom(this.api.get(eventId, hallId));
      this.store.load(eventId, hallId, view);
      void this.loadRateCard(eventId, hallId);
      if (view.plan.imported) {
        this.notifier.info(
          'Existing stalls loaded',
          `${view.plan.stalls.length} stalls ITPO already has for this hall are plotted. Save to plan from them.`,
        );
      }
      if (this.reviewMode()) return;
      // The hall's rules come first, before any drawing; the first-visit tour after them.
      // An event with no rules (ITPO's own) has nothing to show.
      if (this.rulesOn() > 0) await this.showRules();
      this.autoTour();
    } catch (error) {
      this.loadError.set(
        error instanceof ApiError ? error.message : 'The planner could not be opened.',
      );
    }
  }

  /** The rates the stalls are priced by; without them the planner shows no prices. */
  private async loadRateCard(eventId: string, hallId: string): Promise<void> {
    try {
      this.store.setRateCard(await firstValueFrom(this.api.rateCard(eventId, hallId)));
    } catch {
      // Prices are an extra: the planner works without them.
    }
  }

  /** The hall's rate card: who may change it edits it; others look. */
  protected async openRates(): Promise<void> {
    const view = this.store.view();
    if (!view) return;
    let card: RateCardView;
    try {
      card = await firstValueFrom(this.api.rateCard(this.eventId(), this.hallId()));
    } catch (error) {
      this.notifier.fromError(error, 'The rates could not be opened');
      return;
    }
    const saved = await firstValueFrom(
      this.dialog.open<RateCardView>(RateCardDialogComponent, {
        data: {
          eventId: this.eventId(),
          hallId: this.hallId(),
          hallName: view.hall.hall.name,
          view: card,
        } satisfies RateCardData,
        width: 'min(820px, 96vw)',
      }),
      { defaultValue: undefined },
    );
    if (saved) {
      this.store.setRateCard(saved);
      this.notifier.success('Rates saved', 'The stalls are priced by them now.');
    }
  }

  protected openPrices(): void {
    this.dialog
      .open(StallPricesDialogComponent, {
        data: { store: this.store } satisfies StallPricesData,
        width: 'min(860px, 96vw)',
      })
      .subscribe();
  }

  /** A proof file ITPO attached when it sent the plan back. */
  protected async downloadProof(file: PlanAttachment): Promise<void> {
    try {
      saveBlob(
        await firstValueFrom(this.api.attachment(this.eventId(), this.hallId(), file.id)),
        file.name,
      );
    } catch (error) {
      this.notifier.fromError(error, 'The file could not be downloaded');
    }
  }

  protected retry(): void {
    void this.load(this.eventId(), this.hallId());
  }

  /** The rules on for this hall, read only: shown when the planner opens, and from Rules. */
  protected async showRules(): Promise<void> {
    const view = this.store.view();
    if (!view) return;
    this.rulesCatalogue ??= firstValueFrom(this.rulesApi.catalogue()).catch(() => null);
    const catalogue = await this.rulesCatalogue;
    await firstValueFrom(
      this.dialog.open<void>(PlannerRulesDialogComponent, {
        data: { hall: view.hall, catalogue } satisfies PlannerRulesData,
        width: 'min(640px, 96vw)',
      }),
      { defaultValue: undefined },
    );
  }

  /** Leaving with unsaved changes asks first (the route's guard). */
  hasUnsavedChanges(): boolean {
    return this.store.dirty();
  }

  /** Leaving the planner always asks, even when everything is saved. */
  confirmLeave(): { header: string; message: string } | null {
    if (!this.store.view()) return null;
    return {
      header: 'Leave the planner?',
      message: 'Your saved plan stays as it is. You can open the planner again from the event.',
    };
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  @HostListener('document:fullscreenchange')
  protected fullscreenChanged(): void {
    this.fullscreen.set(document.fullscreenElement === this.host.nativeElement);
  }

  @HostListener('window:keydown', ['$event'])
  protected key(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable], .p-dialog')) return;
    if (e.key === '?') {
      this.showShortcuts();
      return;
    }
    if (!this.canEdit()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const canvas = this.canvas();
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      void this.copySelection();
    } else if (!ctrl && e.key === '3') {
      canvas?.enter3d();
    } else if (!ctrl && e.key === '2') {
      canvas?.leave3d();
    } else if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    } else if (e.key === 'Escape') {
      if (canvas?.drawing) canvas.cancel();
      else if (this.tool() !== 'select') this.tool.set('select');
      else this.store.select(null);
    } else if (e.key === 'Enter') {
      canvas?.finishPolygon();
    } else if (e.key === 'Backspace' && canvas?.undoCorner()) {
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelection();
    } else if (!ctrl && !e.altKey) {
      const tool = (
        {
          v: 'select',
          h: 'pan',
          z: 'zone-rect',
          p: 'zone-poly',
          b: 'booth',
          l: 'line',
          r: 'rect',
          c: 'circle',
          t: 'text',
        } as const
      )[e.key.toLowerCase() as 'v'];
      if (tool) this.setTool(tool);
    }
  }

  /** Drags the edge of a side panel: the panel follows the pointer, within reason. */
  protected resizeStart(side: 'left' | 'right', event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const body = handle.closest('.body') as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const box = body.getBoundingClientRect();
      this.setWidth(side, side === 'left' ? e.clientX - box.left : box.right - e.clientX);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  /** Arrow keys on a focused edge: the keyboard way to resize. */
  protected resizeKey(side: 'left' | 'right', event: KeyboardEvent): void {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    const now = side === 'left' ? this.leftWidth() : this.rightWidth();
    this.setWidth(side, now + (event.key === grow ? 16 : -16));
  }

  private setWidth(side: 'left' | 'right', width: number): void {
    const w = Math.round(Math.min(520, Math.max(200, width)));
    (side === 'left' ? this.leftWidth : this.rightWidth).set(w);
    remember(side === 'left' ? 'planner.leftWidth' : 'planner.rightWidth', String(w));
  }

  /** The phone's tools menu. */
  protected readonly toolsOpen = signal(false);

  /** A tool chosen in the menu closes it; a disabled one does not. */
  protected sheetClick(event: Event): void {
    const button = (event.target as HTMLElement).closest('button.sbtn');
    if (button && !(button as HTMLButtonElement).disabled) this.toolsOpen.set(false);
  }

  protected showShortcuts(): void {
    this.dialog.open(ShortcutsDialogComponent, { width: 'min(720px, 96vw)' }).subscribe();
  }

  protected setTool(tool: PlannerTool): void {
    this.tool.set(tool);
  }

  protected colorOf(i: number): string {
    return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
  }

  protected area(z: PlanZone): number {
    return polygonArea(z.polygon);
  }

  protected zoom(factor: number): void {
    this.canvas()?.zoomBy(factor);
  }

  protected toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.host.nativeElement.requestFullscreen();
  }

  // ---- import and export --------------------------------------------------------------------

  /** The plan as a file, to keep or to bring into another hall's planner. */
  protected exportPlan(): void {
    const v = this.store.view();
    if (!v) return;
    const file = {
      schema: PLAN_FILE_SCHEMA,
      hall: v.hall.hall.name,
      event: v.hall.event.name,
      exportedAt: new Date().toISOString(),
      plan: this.store.plan(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${v.hall.event.name} - ${v.hall.hall.name} plan.json`.replace(
      /[\\/:*?"<>|]/g,
      '',
    );
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- drawings -----------------------------------------------------------------------------

  /** A drawing from a drawing tool; text starts as “Text”, to write in Properties. */
  protected async addObject(e: DrawObjectEvent): Promise<void> {
    const plan = this.store.plan();
    const object: PlanObject = {
      id: newId(),
      kind: e.kind,
      points: e.points.map(([x, y]) => [round(x), round(y)] as Point),
      text: e.kind === 'text' ? 'Text' : null,
      color: OBJECT_COLOR,
    };
    const ok = await this.store.change(
      { ...plan, objects: [...plan.objects, object] },
      [object.id],
      { kind: 'object', ids: [object.id] },
    );
    if (ok && e.kind === 'text') this.tool.set('select');
  }

  protected async patchObjects(patch: Partial<Pick<PlanObject, 'text' | 'color'>>): Promise<void> {
    const ids = new Set(this.store.selectedObjects().map((o) => o.id));
    if (!ids.size) return;
    const plan = this.store.plan();
    await this.store.change(
      { ...plan, objects: plan.objects.map((o) => (ids.has(o.id) ? { ...o, ...patch } : o)) },
      [...ids],
    );
  }

  // ---- drawing ------------------------------------------------------------------------------

  protected drawn(r: { x: number; y: number; width: number; height: number }): void {
    if (this.tool() === 'booth') void this.addBooth(r);
    else void this.addZone(rectRing(r));
  }

  protected zoneFromPolygon(points: Point[]): void {
    if (polygonArea(points) < 0.5) {
      this.notifier.warn('A zone needs some area: draw at least three corners apart.');
      return;
    }
    void this.addZone(points);
  }

  protected placeBooth(at: Point): void {
    void this.addBooth({ x: at[0] - 1.5, y: at[1] - 1.5, width: 3, height: 3 });
  }

  private async addZone(polygon: Point[]): Promise<boolean> {
    const plan = this.store.plan();
    const zone: PlanZone = {
      id: newId(),
      name: `Zone ${plan.zones.length + 1}`,
      color: ZONE_COLORS[plan.zones.length % ZONE_COLORS.length],
      polygon: polygon.map(([x, y]) => [round(x), round(y)] as Point),
    };
    // Stalls and seats already inside join the zone.
    const inside = (i: PlanStall | PlanSeat) => pointInRing(centre(stallRect(i)), zone.polygon);
    const next = {
      ...plan,
      zones: [...plan.zones, zone],
      stalls: plan.stalls.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
      seats: plan.seats.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
    };
    if (await this.store.change(next, [zone.id], { kind: 'zone', ids: [zone.id] })) {
      this.tool.set('select');
      return true;
    }
    return false;
  }

  private async addBooth(r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<boolean> {
    const plan = this.store.plan();
    const [number] = stallNumbers(plan.stalls, null, 'numbers', 1, '');
    const stall = this.newStall(r, number);
    return this.store.change({ ...plan, stalls: [...plan.stalls, stall] }, [stall.id], {
      kind: 'stall',
      ids: [stall.id],
    });
  }

  private newStall(
    r: { x: number; y: number; width: number; height: number },
    number: string,
  ): PlanStall {
    const rect = { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
    return {
      id: newId(),
      zoneId: zoneAt(centre(rect), this.store.plan().zones)?.id ?? null,
      islandNumber: null,
      stallNumber: number,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      depth: rect.height,
      openSides: [...DEFAULT_OPEN],
      cutCells: [],
      scheme: 'shell',
      categoryIds: [],
      isPremium: false,
      isBlocked: false,
      isFnb: false,
      isBranding: false,
      isHorseshoe: false,
      isMarqueeAvailable: false,
      isRestrictedForOverseas: false,
      isActive: true,
      location: null,
      description: null,
    };
  }

  // ---- selection and moving -----------------------------------------------------------------

  protected picked(e: PickEvent | null): void {
    if (!e) {
      this.store.select(null);
      return;
    }
    const current = this.store.selection();
    if (e.additive && current?.kind === e.kind) {
      const ids = new Set(current.ids);
      for (const id of e.ids) if (!ids.delete(id)) ids.add(id);
      this.store.select({ kind: e.kind, ids: [...ids] });
    } else {
      this.store.select({ kind: e.kind, ids: e.ids });
    }
  }

  /** Cuts a cell out of a stall, or puts a cut cell back, from the canvas's cell menu. */
  protected async cutCell(e: CutCellEvent): Promise<void> {
    if (!this.canEdit()) return;
    const plan = this.store.plan();
    const [c, r] = e.cell;
    await this.store.change(
      {
        ...plan,
        stalls: plan.stalls.map((s) => {
          if (s.id !== e.stallId) return s;
          const rest = s.cutCells.filter(([cc, rr]) => cc !== c || rr !== r);
          return { ...s, cutCells: cleanCutCells(s, e.cut ? [...rest, e.cell] : rest) };
        }),
      },
      [e.stallId],
    );
  }

  /** Moves the selection by the properties' arrows, as a drag would. */
  protected nudgeSelection(dx: number, dy: number): Promise<void> {
    const sel = this.store.selection();
    return sel ? this.moved({ kind: sel.kind, ids: sel.ids, dx, dy }) : Promise.resolve();
  }

  protected async moved(e: MoveEvent): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(e.ids);
    const shift = <T extends { x: number; y: number }>(i: T): T => ({
      ...i,
      x: round(i.x + e.dx),
      y: round(i.y + e.dy),
    });
    let next = plan;
    if (e.kind === 'zone') {
      next = {
        ...plan,
        zones: plan.zones.map((z) =>
          ids.has(z.id)
            ? {
                ...z,
                polygon: z.polygon.map(([x, y]) => [round(x + e.dx), round(y + e.dy)] as Point),
              }
            : z,
        ),
      };
    } else if (e.kind === 'stall') {
      next = {
        ...plan,
        stalls: plan.stalls.map((s) => (ids.has(s.id) ? this.rezone(shift(s)) : s)),
      };
    } else if (e.kind === 'object') {
      next = {
        ...plan,
        objects: plan.objects.map((o) =>
          ids.has(o.id)
            ? {
                ...o,
                points: o.points.map(([x, y]) => [round(x + e.dx), round(y + e.dy)] as Point),
              }
            : o,
        ),
      };
    } else {
      next = { ...plan, seats: plan.seats.map((s) => (ids.has(s.id) ? this.rezone(shift(s)) : s)) };
    }
    await this.store.change(next, e.ids);
  }

  /** The zone an item is in after it moved. */
  private rezone<T extends PlanStall | PlanSeat>(i: T): T {
    return { ...i, zoneId: zoneAt(centre(stallRect(i)), this.store.plan().zones)?.id ?? null };
  }

  // ---- modify -------------------------------------------------------------------------------

  /** Copies of the selected booths, beside them to the right, with the next free numbers. */
  protected async copySelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const plan = this.store.plan();
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const dx = round(box.width + this.snapStep());
    const copies: PlanStall[] = [];
    for (const s of selected) {
      const [number] = stallNumbers([...plan.stalls, ...copies], s.islandNumber, 'numbers', 1, '');
      copies.push(this.rezone({ ...s, id: newId(), stallNumber: number, x: round(s.x + dx) }));
    }
    const ids = copies.map((c) => c.id);
    await this.store.change({ ...plan, stalls: [...plan.stalls, ...copies] }, ids, {
      kind: 'stall',
      ids,
    });
  }

  /** Turns each selected booth a quarter clockwise about its middle; open sides turn too. */
  protected async rotateSelection(): Promise<void> {
    const ids = new Set(this.store.selectedStalls().map((s) => s.id));
    if (!ids.size) return;
    const plan = this.store.plan();
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) => {
        if (!ids.has(s.id)) return s;
        const [cx, cy] = centre(stallRect(s));
        return this.rezone({
          ...s,
          x: round(cx - s.depth / 2),
          y: round(cy - s.width / 2),
          width: s.depth,
          depth: s.width,
          openSides: s.openSides.map((side) => ROTATED[side]),
          // A quarter clockwise: the last row becomes the first column.
          cutCells: s.cutCells.map(([c, r]) => [cellCounts(s).rows - 1 - r, c] as [number, number]),
        });
      }),
    };
    await this.store.change(next, [...ids]);
  }

  /**
   * Mirrors the selected booths within the box around them: left to right (x, Mirror X) or top
   * to bottom (y, Mirror).
   */
  protected async mirrorSelection(axis: 'x' | 'y'): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const ids = new Set(selected.map((s) => s.id));
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const plan = this.store.plan();
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) =>
        ids.has(s.id)
          ? this.rezone(
              this.mirrored(s, axis, axis === 'x' ? box.x * 2 + box.width : box.y * 2 + box.height),
            )
          : s,
      ),
    };
    await this.store.change(next, [...ids]);
  }

  /**
   * Copies of the selected booths mirrored across a drawn line. Booths stay square to the hall,
   * so the line counts as across or up and down, whichever it is closer to.
   */
  protected async mirrorAcross([a, b]: [Point, Point]): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const across = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const plan = this.store.plan();
    const copies: PlanStall[] = [];
    for (const s of selected) {
      const flipped = across
        ? this.mirrored(s, 'y', a[1] + b[1])
        : this.mirrored(s, 'x', a[0] + b[0]);
      const [number] = stallNumbers([...plan.stalls, ...copies], s.islandNumber, 'numbers', 1, '');
      copies.push(this.rezone({ ...flipped, id: newId(), stallNumber: number }));
    }
    const ids = copies.map((c) => c.id);
    if (
      await this.store.change({ ...plan, stalls: [...plan.stalls, ...copies] }, ids, {
        kind: 'stall',
        ids,
      })
    ) {
      this.tool.set('select');
    }
  }

  /** A booth mirrored across the line where x (or y) is `twice / 2`. */
  private mirrored(s: PlanStall, axis: 'x' | 'y', twice: number): PlanStall {
    return axis === 'x'
      ? {
          ...s,
          x: round(twice - s.x - s.width),
          openSides: s.openSides.map((side) => MIRRORED[side]),
        }
      : {
          ...s,
          y: round(twice - s.y - s.depth),
          openSides: s.openSides.map((side) => FLIPPED[side]),
        };
  }

  /** Splits the selected booth in two halves across its longer side; the new half is numbered next. */
  protected async splitSelection(): Promise<void> {
    const [s] = this.store.selectedStalls();
    if (!s || this.store.selectedStalls().length !== 1) return;
    const plan = this.store.plan();
    const wide = s.width >= s.depth;
    const half = round((wide ? s.width : s.depth) / 2);
    const first: PlanStall = wide ? { ...s, width: half } : { ...s, depth: half };
    first.cutCells = cleanCutCells(first, s.cutCells);
    const [number] = stallNumbers(plan.stalls, s.islandNumber, 'numbers', 1, '');
    const second: PlanStall = this.rezone(
      wide
        ? {
            ...s,
            id: newId(),
            stallNumber: number,
            x: round(s.x + half),
            width: round(s.width - half),
            cutCells: cleanCutCells(
              { width: round(s.width - half), depth: s.depth },
              s.cutCells.map(([c, r]) => [c - half, r]),
            ),
          }
        : {
            ...s,
            id: newId(),
            stallNumber: number,
            y: round(s.y + half),
            depth: round(s.depth - half),
            cutCells: cleanCutCells(
              { width: s.width, depth: round(s.depth - half) },
              s.cutCells.map(([c, r]) => [c, r - half]),
            ),
          },
    );
    await this.store.change(
      {
        ...plan,
        stalls: [...plan.stalls.map((x) => (x.id === s.id ? this.rezone(first) : x)), second],
      },
      [s.id, second.id],
      { kind: 'stall', ids: [s.id, second.id] },
    );
  }

  /**
   * Joins the selected booths into the first of them, when together they fill a rectangle
   * exactly; the others are removed.
   */
  protected async mergeSelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (selected.length < 2) return;
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const area = selected.reduce((sum, s) => sum + stallArea(s), 0);
    if (Math.abs(area - box.width * box.height) > 0.01) {
      this.notifier.warn('Not merged: the booths must fill a rectangle together, with no gaps.');
      return;
    }
    const [keep] = selected;
    const gone = new Set(selected.slice(1).map((s) => s.id));
    const merged = this.rezone({
      ...keep,
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      depth: round(box.height),
      cutCells: [],
    });
    const plan = this.store.plan();
    await this.store.change(
      {
        ...plan,
        stalls: plan.stalls
          .filter((s) => !gone.has(s.id))
          .map((s) => (s.id === keep.id ? merged : s)),
      },
      [keep.id],
      { kind: 'stall', ids: [keep.id] },
    );
  }

  /** Booths side by side in a row, in the middle of the view or of the selected zone. */
  protected rowOfBooths(): void {
    const zone = this.store.selectedZone();
    const at = zone ? centre(ringBox(zone.polygon)) : (this.canvas()?.viewCentre() ?? [0, 0]);
    this.dialog
      .open<Rect[]>(RowDialogComponent, {
        data: { at, snapStep: this.snapStep() } satisfies RowData,
        width: 'min(460px, 94vw)',
      })
      .subscribe(async (boxes) => {
        if (!boxes?.length) return;
        const plan = this.store.plan();
        const numbers = stallNumbers(plan.stalls, null, 'numbers', boxes.length, '');
        const stalls = boxes.map((b, i) => this.newStall(b, numbers[i]));
        const ids = stalls.map((s) => s.id);
        await this.store.change({ ...plan, stalls: [...plan.stalls, ...stalls] }, ids, {
          kind: 'stall',
          ids,
        });
      });
  }

  /** Grows or shrinks each selected booth about its middle. */
  protected scaleSelection(): void {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    this.dialog
      .open<number>(ScaleDialogComponent, {
        data: { count: selected.length } satisfies ScaleData,
        width: 'min(380px, 94vw)',
      })
      .subscribe(async (factor) => {
        if (!factor || factor === 1) return;
        const ids = new Set(selected.map((s) => s.id));
        const step = this.snapStep();
        const plan = this.store.plan();
        const next = {
          ...plan,
          stalls: plan.stalls.map((s) => {
            if (!ids.has(s.id)) return s;
            const [cx, cy] = centre(stallRect(s));
            const width = Math.max(step, snap(s.width * factor, step));
            const depth = Math.max(step, snap(s.depth * factor, step));
            return this.rezone({
              ...s,
              x: round(cx - width / 2),
              y: round(cy - depth / 2),
              width,
              depth,
            });
          }),
        };
        await this.store.change(next, [...ids]);
      });
  }

  /** Makes a booth of the selected zone (its box) or drawn rectangle, which it replaces. */
  protected async toBooth(): Promise<void> {
    const zone = this.store.selectedZone();
    const [object] = this.store.selectedObjects();
    const ring = zone
      ? zone.polygon
      : object?.kind === 'rect'
        ? objectOutline(object).points
        : null;
    if (!ring) return;
    const box = ringBox(ring);
    if (zone && Math.abs(polygonArea(zone.polygon) - box.width * box.height) > 0.01) {
      this.notifier.warn('Only a rectangular zone can become a booth.');
      return;
    }
    const plan = this.store.plan();
    const [number] = stallNumbers(plan.stalls, null, 'numbers', 1, '');
    const out = <T extends PlanStall | PlanSeat>(i: T): T =>
      zone && i.zoneId === zone.id ? { ...i, zoneId: null } : i;
    const rest = {
      ...plan,
      zones: zone ? plan.zones.filter((z) => z.id !== zone.id) : plan.zones,
      stalls: plan.stalls.map(out),
      seats: plan.seats.map(out),
      objects: object ? plan.objects.filter((o) => o.id !== object.id) : plan.objects,
    };
    const stall = {
      ...this.newStall(box, number),
      zoneId: zoneAt(centre(box), rest.zones)?.id ?? null,
    };
    await this.store.change({ ...rest, stalls: [...rest.stalls, stall] }, [stall.id], {
      kind: 'stall',
      ids: [stall.id],
    });
  }

  /**
   * Numbers the selected booths from 1 under their island, row by row from the top-left,
   * skipping numbers other booths of the island have.
   */
  protected async numberSelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const ids = new Set(selected.map((s) => s.id));
    const plan = this.store.plan();
    const others = plan.stalls.filter((s) => !ids.has(s.id));
    const ordered = [...selected].sort((a, b) => round(a.y, 0.1) - round(b.y, 0.1) || a.x - b.x);
    const byIsland = new Map<string, PlanStall[]>();
    for (const s of ordered) {
      const key = s.islandNumber ?? '';
      byIsland.set(key, [...(byIsland.get(key) ?? []), s]);
    }
    const numbers = new Map<string, string>();
    for (const [island, stalls] of byIsland) {
      const next = stallNumbers(others, island || null, 'numbers', stalls.length, '1');
      stalls.forEach((s, i) => numbers.set(s.id, next[i]));
    }
    await this.store.change(
      {
        ...plan,
        stalls: plan.stalls.map((s) =>
          numbers.has(s.id) ? { ...s, stallNumber: numbers.get(s.id)! } : s,
        ),
      },
      [...ids],
    );
  }

  // ---- properties ---------------------------------------------------------------------------

  protected async patchStalls(patch: StallPatch): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(this.store.selectedStalls().map((s) => s.id));
    if (!ids.size) return;
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) => {
        if (!ids.has(s.id)) return s;
        const changed = { ...s, ...patch };
        // A smaller stall drops the cuts that are now outside it.
        if ('width' in patch || 'depth' in patch) {
          changed.cutCells = cleanCutCells(changed, changed.cutCells);
        }
        return 'x' in patch || 'y' in patch || 'width' in patch || 'depth' in patch
          ? this.rezone(changed)
          : changed;
      }),
    };
    await this.store.change(next, [...ids]);
  }

  protected async patchZone(patch: Partial<Omit<PlanZone, 'id'>>): Promise<void> {
    const zone = this.store.selectedZone();
    if (!zone) return;
    const plan = this.store.plan();
    await this.store.change(
      { ...plan, zones: plan.zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z)) },
      [zone.id],
    );
  }

  protected async seatCategory(categoryId: string | null): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(this.store.selectedSeats().map((s) => s.id));
    await this.store.change(
      { ...plan, seats: plan.seats.map((s) => (ids.has(s.id) ? { ...s, categoryId } : s)) },
      [...ids],
    );
  }

  protected removeSelection(): void {
    const sel = this.store.selection();
    if (!sel || !this.canEdit()) return;
    const plan = this.store.plan();
    const ids = new Set(sel.ids);
    if (sel.kind === 'zone') {
      const zone = plan.zones.find((z) => ids.has(z.id));
      if (zone) this.removeZone(zone);
      return;
    }
    this.store.remove({
      ...plan,
      stalls: sel.kind === 'stall' ? plan.stalls.filter((s) => !ids.has(s.id)) : plan.stalls,
      seats: sel.kind === 'seat' ? plan.seats.filter((s) => !ids.has(s.id)) : plan.seats,
      objects: sel.kind === 'object' ? plan.objects.filter((o) => !ids.has(o.id)) : plan.objects,
    });
  }

  /** Deletes every stall of the plan, once confirmed; Undo brings them back. */
  protected async removeAllStalls(): Promise<void> {
    const count = this.store.plan().stalls.length;
    if (!count || !this.canEdit()) return;
    const ok = await this.confirm.confirm({
      title: `Delete all ${count.toLocaleString('en-IN')} booths?`,
      message: 'Every booth on the plan is removed. Undo brings them back.',
      confirmLabel: 'Delete all',
      destructive: true,
    });
    if (!ok) return;
    this.store.remove({ ...this.store.plan(), stalls: [] });
  }

  /** Deletes a zone; its stalls and seats stay, in no zone. */
  protected removeZone(zone: PlanZone): void {
    const plan = this.store.plan();
    const out = <T extends PlanStall | PlanSeat>(i: T): T =>
      i.zoneId === zone.id ? { ...i, zoneId: null } : i;
    this.store.remove({
      ...plan,
      zones: plan.zones.filter((z) => z.id !== zone.id),
      stalls: plan.stalls.map(out),
      seats: plan.seats.map(out),
    });
  }

  // ---- dialogs ------------------------------------------------------------------------------

  /** The hall and each zone, to fill; the selected zone first chosen. */
  private regions(): { regions: FillRegion[]; regionId: string } {
    const v = this.store.view()!;
    const floor = this.store.floor()!;
    const hallRing =
      floor.floor[0]?.[0] ??
      rectRing({ x: 0, y: 0, width: v.hall.floor.width, height: v.hall.floor.depth });
    const regions: FillRegion[] = [
      {
        id: 'hall',
        label: `The whole hall (${Math.round(polygonArea(hallRing))} m²)`,
        name: 'the whole hall',
        ring: hallRing,
      },
      ...this.store.plan().zones.map((z) => ({
        id: z.id,
        label: `Zone: ${z.name} (${Math.round(polygonArea(z.polygon))} m²)`,
        name: `zone “${z.name}”`,
        ring: z.polygon,
      })),
    ];
    const selected = this.store.selectedZone()?.id;
    const only = this.store.plan().zones.length === 1 ? this.store.plan().zones[0].id : undefined;
    return { regions, regionId: selected ?? only ?? 'hall' };
  }

  /** The stalls of this hall from a CAD plan (PDF or DXF), reviewed in a dialog before they are added. */
  private importDrawing(file: File): void {
    this.dialog
      .open<DrawingImportOutcome>(DrawingImportDialogComponent, {
        data: {
          store: this.store,
          eventId: this.eventId(),
          hallId: this.hallId(),
          file,
        } satisfies DrawingImportData,
        width: 'min(1100px, 96vw)',
      })
      .subscribe((outcome) => {
        if (outcome?.stalls.length)
          void this.addMany({ stalls: outcome.stalls }, 'booth', outcome.replacing);
      });
  }

  protected importPlan(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.(pdf|dxf)$/i.test(file.name)) {
      this.notifier.warn('Choose the hall’s CAD plan as a PDF or DXF file.');
      return;
    }
    this.importDrawing(file);
  }

  // ---- guided tour --------------------------------------------------------------------------

  protected readonly tour = inject<TourService<PlannerTourCtx>>(TourService);
  protected readonly rupees = rupees;

  /** Where the plan stands, in words: saving, unsaved, or saved and when. */
  protected readonly saveState = computed(() => {
    if (this.store.busy()) return 'Saving…';
    if (this.store.dirty()) return 'Unsaved changes';
    const at = this.store.savedAt();
    return at ? `Saved ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  });

  /** Nothing is drawn yet: the floor offers the three ways to begin. */
  private readonly beginFirst = viewChild<ElementRef<HTMLButtonElement>>('beginFirst');

  /** Tab stays among the ways to begin while the backdrop is up. */
  protected trapBegin(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button, a[href]'),
    ];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected readonly emptyPlan = computed(() => {
    const p = this.store.plan();
    return !p.stalls.length && !p.zones.length && !p.objects.length && !p.seats.length;
  });

  protected readonly colourModes = [
    { id: 'category', label: 'Category' },
    { id: 'scheme', label: 'Scheme' },
    { id: 'price', label: 'Price' },
  ] as const;
  protected readonly schemeColors = SCHEME_COLORS;

  /** What the stalls are coloured by: their category, their scheme, or their price. */
  protected readonly colourBy = signal<'category' | 'scheme' | 'price'>('category');
  /** The price bands of the plan, cheapest first, with the colour each stall of one is drawn in. */
  protected readonly priceBands = computed(() => priceBandsOf(this.store.prices()));
  protected readonly stallColors = computed<ReadonlyMap<string, string> | null>(() => {
    const mode = this.colourBy();
    if (mode === 'scheme') {
      return new Map(
        this.store
          .plan()
          .stalls.map((s) => [
            s.id,
            s.scheme === 'shell' ? SCHEME_COLORS.shell : SCHEME_COLORS.raw,
          ]),
      );
    }
    if (mode === 'price') return new Map(this.priceBands().colors);
    return null;
  });
  protected readonly tourOpen = signal(true);
  /** Why the planner could not be opened, shown on the page itself. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly assistantOpen = signal(false);

  /**
   * Runs the guided tour. What the tour makes is what was not on the plan when it started; the
   * last step offers to remove it, which also leaves the plan unsaved-free if it was before.
   */
  protected startTour(): void {
    if (this.tour.active() || !this.store.view()) return;
    const start = this.store.plan();
    const startDirty = this.store.dirty();
    const known = new Set(
      [...start.zones, ...start.stalls, ...start.seats, ...start.objects].map((i) => i.id),
    );
    const fresh = <T extends { id: string }>(list: T[]) => list.filter((i) => !known.has(i.id));
    const ctx: PlannerTourCtx = {
      store: this.store,
      tool: this.tool,
      setTool: (tool) => this.setTool(tool),
      is3d: () => this.canvas()?.is3d() ?? false,
      enter3d: () => this.canvas()?.enter3d(),
      leave3d: () => this.canvas()?.leave3d(),
      openPlanPanel: () => this.leftOpen.set(true),
      openProperties: () => this.rightOpen.set(true),
      addZone: (polygon) => this.addZone(polygon),
      addBooth: (r) => this.addBooth(r),
      patchStalls: (patch) => this.patchStalls(patch),
      copySelection: () => this.copySelection(),
      madeStalls: () => fresh(this.store.plan().stalls),
      madeZones: () => fresh(this.store.plan().zones),
      memo: {},
    };
    this.tourOpen.set(false);
    const view = this.store.view();
    const steps = plannerTour({
      canEdit: this.canEdit(),
      canPublish: view?.canPublish ?? false,
      needsApproval: view?.needsApproval ?? false,
      hasCategories: this.store.categories().some((c) => c.status === 'active'),
      hasRules: this.rulesOn() > 0,
    });
    this.tour.start(steps, ctx, {
      onEnd: (reason) => {
        this.tourSeen(reason === 'skip');
        this.tourOpen.set(true);
        this.tool.set('select');
      },
      made: () => {
        const p = this.store.plan();
        const parts = [
          [fresh(p.stalls).length, 'booth'],
          [fresh(p.zones).length, 'zone'],
          [fresh(p.seats).length, 'seat'],
          [fresh(p.objects).length, 'drawing'],
        ] as const;
        const text = parts
          .filter(([n]) => n)
          .map(([n, what]) => `${n} ${what}${n === 1 ? '' : 's'}`)
          .join(', ');
        return text || null;
      },
      removeMade: () => {
        const p = this.store.plan();
        const out = <T extends { id: string; zoneId: string | null }>(i: T): T =>
          i.zoneId && !known.has(i.zoneId) ? { ...i, zoneId: null } : i;
        this.store.remove({
          zones: p.zones.filter((z) => known.has(z.id)),
          stalls: p.stalls.filter((s) => known.has(s.id)).map(out),
          seats: p.seats.filter((s) => known.has(s.id)).map(out),
          objects: p.objects.filter((o) => known.has(o.id)),
        });
        // Back to the plan as it was: nothing new to save.
        if (!startDirty && JSON.stringify(this.store.plan()) === JSON.stringify(start)) {
          this.store.dirty.set(false);
        }
      },
    });
  }

  private tourKeys(): { seen: string; off: string } | null {
    const user = this.auth.user()?.id;
    return user ? { seen: `tourSeen:${user}:stall-planner`, off: `tourAutoOff:${user}` } : null;
  }

  /** Remembers the tour was seen here; "Skip the tour" also stops it opening by itself. */
  private tourSeen(off: boolean): void {
    const keys = this.tourKeys();
    if (!keys) return;
    try {
      localStorage.setItem(keys.seen, '1');
      if (off) localStorage.setItem(keys.off, '1');
    } catch {
      // Storage refused: the tour may open again next time.
    }
  }

  /** Opens the tour by itself the first time an organiser opens a planner. */
  private autoTour(): void {
    const keys = this.tourKeys();
    if (this.auth.isStaff() || !this.canEdit() || !keys) return;
    try {
      if (localStorage.getItem(keys.seen) || localStorage.getItem(keys.off)) return;
    } catch {
      return;
    }
    setTimeout(() => this.startTour(), 400);
  }

  // ---- AI assistant -------------------------------------------------------------------------

  /** What the AI assistant reads and does: the store and the same handlers as the buttons. */
  protected readonly agentCtx: PlannerAgentCtx = {
    store: this.store,
    canvas: () => this.canvas(),
    passage: () => {
      const v = this.store.view();
      return v ? v.hall.rules.values.passageWidth[v.hall.event.audience] : 3;
    },
    confirm: (title, message, confirmLabel, destructive = false) =>
      this.confirm.confirm({ title, message, confirmLabel, destructive }),
    copySelection: () => this.copySelection(),
    rotateSelection: () => this.rotateSelection(),
    mirrorSelection: (axis) => this.mirrorSelection(axis),
    numberSelection: () => this.numberSelection(),
    splitSelection: () => this.splitSelection(),
    mergeSelection: () => this.mergeSelection(),
    patchStalls: (patch) => this.patchStalls(patch),
    patchZone: (patch) => this.patchZone(patch),
    moveSelection: (dx, dy) => {
      const sel = this.store.selection();
      return sel ? this.moved({ kind: sel.kind, ids: sel.ids, dx, dy }) : Promise.resolve();
    },
    removeSelection: () => this.removeSelection(),
    removeZone: (zone) => this.removeZone(zone),
    addZone: (polygon) => this.addZone(polygon),
    addBooth: (r) => this.addBooth(r),
    planHall: (brief, options) => this.planHall(brief, options),
    exportPlan: () => this.exportPlan(),
    openProperties: () => this.rightOpen.set(true),
  };

  protected autoBooths(): void {
    const v = this.store.view();
    if (!v) return;
    const passage = v.hall.rules.values.passageWidth[v.hall.event.audience];
    this.dialog
      .open<PlanStall[]>(AutoBoothsDialogComponent, {
        data: { store: this.store, passage, ...this.regions() } satisfies AutoBoothsData,
        width: 'min(1080px, 96vw)',
      })
      .subscribe((stalls) => {
        if (stalls?.length) void this.addMany({ stalls }, 'booth');
      });
  }

  /**
   * Opens Plan hall, from what the AI assistant understood when it asks; resolves to what was
   * added, or null when the person closed it.
   */
  protected async planHall(
    brief?: Partial<PlanBrief>,
    options: { regionId?: string; afresh?: boolean } = {},
  ): Promise<{ added: number; dropped: number; replaced: number; label: string } | null> {
    if (!this.store.view()) return null;
    const regions = this.regions();
    const regionId = regions.regions.some((r) => r.id === options.regionId)
      ? options.regionId!
      : regions.regionId;
    const chosen = await firstValueFrom(
      this.dialog.open<PlanHallResult>(PlanHallDialogComponent, {
        data: {
          store: this.store,
          ...regions,
          regionId,
          brief,
          afresh: options.afresh,
        } satisfies PlanHallData,
        width: 'min(1080px, 96vw)',
      }),
    );
    if (!chosen?.stalls.length) return null;
    const result = await this.addMany({ stalls: chosen.stalls }, 'booth', chosen.replacing);
    return result && { ...result, replaced: chosen.replacing.length, label: chosen.label };
  }

  protected seats(): void {
    const zone = this.store.selectedZone();
    const at = zone ? centre(ringBox(zone.polygon)) : (this.canvas()?.viewCentre() ?? [0, 0]);
    this.dialog
      .open<PlanSeat[]>(SeatsDialogComponent, {
        data: { store: this.store, at, snapStep: this.snapStep() } satisfies SeatsData,
        width: 'min(460px, 94vw)',
      })
      .subscribe(async (seats) => {
        if (!seats?.length) return;
        const plan = this.store.plan();
        const ok = await this.store.change(
          { ...plan, seats: [...plan.seats, ...seats] },
          seats.map((s) => s.id),
          { kind: 'seat', ids: seats.map((s) => s.id) },
        );
        if (ok) this.tool.set('select');
      });
  }

  protected autoSeats(): void {
    this.dialog
      .open<PlanSeat[]>(AutoSeatsDialogComponent, {
        data: { store: this.store, ...this.regions() } satisfies AutoSeatsData,
        width: 'min(820px, 96vw)',
      })
      .subscribe((seats) => {
        if (seats?.length) void this.addMany({ seats }, 'seat');
      });
  }

  private async addMany(
    add: { stalls?: PlanStall[]; seats?: PlanSeat[] },
    what: 'booth' | 'seat',
    replacing: string[] = [],
  ): Promise<{ added: number; dropped: number } | null> {
    const result = await this.store.addPassing(add, new Set(replacing));
    if (!result) return null;
    const name = (n: number) => `${n.toLocaleString('en-IN')} ${what}${n === 1 ? '' : 's'}`;
    if (result.dropped) {
      this.notifier.warn(
        `${name(result.added)} added; ${name(result.dropped)} left out because they break a rule.`,
      );
    } else {
      this.notifier.success(`${name(result.added)} added.`);
    }
    return result;
  }

  /** What Publish does now, or why it cannot. */
  protected readonly publishTip = computed(() => {
    const p = this.store.published();
    if (this.store.dirty()) return 'Save your changes first: the saved plan is what is published';
    if (!this.store.revision()) return 'Save the plan first';
    if (this.store.upToDate()) return `Version ${p!.revision} is published`;
    return p
      ? `Publish version ${this.store.revision()} (version ${p.revision} is published now)`
      : `Publish version ${this.store.revision()}; the rules are checked once more`;
  });

  protected async publish(): Promise<void> {
    const p = this.store.published();
    const ok = await this.confirm.confirm({
      title: 'Publish the stall plan?',
      message: p
        ? `Version ${this.store.revision()} replaces version ${p.revision} as the published plan of this hall; its stalls are written to ITPO.`
        : `Version ${this.store.revision()} becomes the published plan of this hall: its stalls are written to ITPO. You can keep drawing and publish again later.`,
      confirmLabel: 'Publish',
    });
    if (ok) await this.store.publish();
  }

  protected readonly submitTip = computed(() => {
    const venue = 'ITPO';
    if (this.store.dirty()) return 'Save your changes first: the saved plan is what is sent';
    if (!this.store.revision()) return 'Save the plan first';
    if (this.store.upToDate()) return `Version ${this.store.revision()} is approved and published`;
    const unpriced = this.store.unpriced().length;
    if (unpriced) {
      return `Price every stall for sale first: ${unpriced} ${unpriced === 1 ? 'has' : 'have'} no price (Pricing in the toolbar)`;
    }
    return `Send version ${this.store.revision()} to ${venue} for approval; once approved, you publish it`;
  });

  /** External events: the organiser sends the saved plan to the venue for approval. */
  protected async submitPlan(): Promise<void> {
    const venue = 'ITPO';
    const ok = await this.confirm.confirm({
      title: 'Send the plan for approval?',
      message: `Version ${this.store.revision()} goes to ${venue}, who get an email. Until they answer, the plan cannot be changed; you can take it back. Once they approve it, you publish it.`,
      confirmLabel: 'Send for approval',
    });
    if (ok) await this.store.review('submit');
  }

  protected async withdrawPlan(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Take the plan back?',
      message:
        'It is no longer waiting for approval, and you can change it. Send it again when it is ready.',
      confirmLabel: 'Withdraw',
    });
    if (ok) await this.store.review('withdraw');
  }

  /**
   * Saves the plan. On an external event the organiser is then asked whether to send it for
   * approval; saving alone never sends it.
   */
  protected async save(): Promise<void> {
    if (!this.store.dirty() || this.store.busy()) return;
    if (!(await this.store.save())) return;
    if (this.store.view()?.canSubmit) await this.offerApproval();
  }

  private async offerApproval(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Plan saved. Send it for approval?',
      message: `Version ${this.store.revision()} goes to ITPO. Until they answer, the plan cannot be changed; you can take it back. Or keep working, and send it later with Send for approval.`,
      confirmLabel: 'Send for approval',
      cancelLabel: 'Not now',
    });
    if (ok) await this.store.review('submit');
  }
}

/** Reads a saved flag; storage may be blocked, then the default stands. */
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function rememberedWidth(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= 200 && n <= 520 ? n : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked: the setting then lasts for this visit only.
  }
}
