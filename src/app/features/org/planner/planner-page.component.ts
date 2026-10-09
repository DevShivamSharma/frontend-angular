import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { OrgContextStore } from '../../../core/org/org.stores';
import { PlansApi } from '../../../core/plans/plans-api.service';
import type { PlanSeat, PlanStall, PlanZone } from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { IconComponent } from '../../../shared/icon.component';
import {
  AutoBoothsData,
  AutoBoothsDialogComponent,
  FillRegion,
} from './auto-booths-dialog.component';
import { AutoSeatsData, AutoSeatsDialogComponent } from './auto-seats-dialog.component';
import {
  MoveEvent,
  PickEvent,
  PlannerCanvasComponent,
  PlannerTool,
} from './planner-canvas.component';
import {
  centre,
  DEFAULT_OPEN,
  newId,
  pointInRing,
  polygonArea,
  rectRing,
  ringBox,
  round,
  stallNumbers,
  stallRect,
  ZONE_COLORS,
  zoneAt,
} from './planner-geometry';
import { PlannerPropertiesComponent, StallPatch } from './planner-properties.component';
import { PlannerStore } from './planner.store';
import { SeatsData, SeatsDialogComponent } from './seats-dialog.component';

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

interface RibbonTool {
  id: PlannerTool;
  label: string;
  icon: string;
  key: string;
}

/**
 * The stall planner of one hall of an event: zones of any shape, booths one by one or filled
 * automatically, and seats. It opens on the floor version the event keeps, and every change is
 * checked against the rules of this event hall; a change that breaks one is not made.
 */
@Component({
  selector: 'app-planner-page',
  imports: [
    DecimalPipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    TooltipModule,
    IconComponent,
    PlannerCanvasComponent,
    PlannerPropertiesComponent,
  ],
  providers: [PlannerStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.view(); as v) {
      <div class="planner">
        <header class="top">
          <a
            pButton
            [text]="true"
            [routerLink]="['/', slug(), 'events', eventId(), 'halls', hallId()]"
            pTooltip="Back to the hall"
            aria-label="Back to the hall"
            ><app-icon name="arrow_back"
          /></a>
          <div class="title">
            <b>{{ v.hall.hall.name }}</b>
            <span class="muted"
              >{{ v.hall.event.name }} · floor v{{ v.hall.hall.floorVersion }} ·
              {{ rulesOn() }} rules on</span
            >
          </div>
          <ol class="stepper" aria-label="Steps">
            @for (step of steps(); track step.label; let i = $index) {
              <li [class.done]="step.done" [class.now]="step.now">
                <span class="dot">
                  @if (step.done && !step.now) {
                    <app-icon name="check" />
                  } @else {
                    {{ i + 1 }}
                  }
                </span>
                <span>{{ step.label }}</span>
              </li>
            }
          </ol>
          <span class="spacer"></span>
          @if (canEdit()) {
            <button
              pButton
              [text]="true"
              (click)="store.undo()"
              [disabled]="!store.canUndo() || store.busy()"
              pTooltip="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <app-icon name="undo" />
            </button>
            <button
              pButton
              [text]="true"
              (click)="store.redo()"
              [disabled]="!store.canRedo() || store.busy()"
              pTooltip="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <app-icon name="redo" />
            </button>
            <button
              pButton
              class="save"
              (click)="save()"
              [disabled]="store.busy() || !store.dirty()"
            >
              <app-icon name="save" />{{ store.dirty() ? 'Save' : 'Saved' }}
            </button>
          }
        </header>

        @if (canEdit()) {
          <nav class="ribbon" aria-label="Tools">
            <div class="group">
              <div class="tools">
                @for (t of pointerTools; track t.id) {
                  <button
                    type="button"
                    class="tool"
                    [class.on]="tool() === t.id"
                    (click)="setTool(t.id)"
                    [attr.aria-pressed]="tool() === t.id"
                    [pTooltip]="t.label + ' (' + t.key + ')'"
                  >
                    <app-icon [name]="t.icon" /><span>{{ t.label }}</span>
                  </button>
                }
              </div>
              <span class="group-label">View</span>
            </div>
            <div class="group">
              <div class="tools">
                @for (t of zoneTools; track t.id) {
                  <button
                    type="button"
                    class="tool"
                    [class.on]="tool() === t.id"
                    (click)="setTool(t.id)"
                    [attr.aria-pressed]="tool() === t.id"
                    [pTooltip]="t.label + ' (' + t.key + ')'"
                  >
                    <app-icon [name]="t.icon" /><span>{{ t.label }}</span>
                  </button>
                }
              </div>
              <span class="group-label">Zones</span>
            </div>
            <div class="group">
              <div class="tools">
                <button
                  type="button"
                  class="tool"
                  [class.on]="tool() === 'booth'"
                  (click)="setTool('booth')"
                  [attr.aria-pressed]="tool() === 'booth'"
                  pTooltip="Booth (B)"
                >
                  <app-icon name="storefront" /><span>Booth</span>
                </button>
                <button
                  type="button"
                  class="tool auto"
                  (click)="autoBooths()"
                  [disabled]="store.busy()"
                >
                  <app-icon name="auto_awesome" /><span>Auto-booths</span>
                </button>
              </div>
              <span class="group-label">Booths</span>
            </div>
            <div class="group">
              <div class="tools">
                <button type="button" class="tool" (click)="seats()" [disabled]="store.busy()">
                  <app-icon name="event_seat" /><span>Seats</span>
                </button>
                <button
                  type="button"
                  class="tool auto seat"
                  (click)="autoSeats()"
                  [disabled]="store.busy()"
                >
                  <app-icon name="auto_awesome" /><span>Auto-seats</span>
                </button>
              </div>
              <span class="group-label">Seats</span>
            </div>
            <div class="group">
              <div class="tools">
                <button
                  type="button"
                  class="tool danger"
                  (click)="removeSelection()"
                  [disabled]="!store.selection() || store.busy()"
                  pTooltip="Delete (Del)"
                >
                  <app-icon name="delete" /><span>Delete</span>
                </button>
              </div>
              <span class="group-label">Modify</span>
            </div>
          </nav>
        } @else {
          <p class="readonly" role="status">
            <app-icon name="visibility" /> {{ v.readOnlyReason }} You are seeing the plan as it was
            last saved.
          </p>
        }
        @if (store.busy()) {
          <p-progressbar mode="indeterminate" class="busy" />
        }

        <div class="body">
          <aside class="side left" aria-label="Plan">
            <h3>Plan</h3>
            <dl class="counts">
              <dt>Zones</dt>
              <dd>{{ store.plan().zones.length }}</dd>
              <dt>Stalls</dt>
              <dd>{{ store.plan().stalls.length }}</dd>
              <dt>Stall area</dt>
              <dd>{{ stallArea() | number: '1.0-0' }} m²</dd>
              <dt>Seats</dt>
              <dd>{{ store.plan().seats.length | number }}</dd>
              <dt>Hall</dt>
              <dd>
                {{ v.hall.hall.width | number: '1.0-1' }} ×
                {{ v.hall.hall.depth | number: '1.0-1' }} m
              </dd>
            </dl>
            <h3>Zones</h3>
            @if (!store.plan().zones.length) {
              <p class="muted small">No zones yet. Draw one with Zone or Polygon.</p>
            }
            <ul class="zones">
              @for (z of store.plan().zones; track z.id) {
                <li
                  [class.on]="
                    store.selection()?.kind === 'zone' && store.selection()?.ids?.[0] === z.id
                  "
                >
                  <button
                    type="button"
                    class="zone"
                    (click)="store.select({ kind: 'zone', ids: [z.id] })"
                  >
                    <span class="swatch" [style.background]="z.color"></span>
                    <span class="zname">{{ z.name }}</span>
                    <span class="muted nums">{{ area(z) | number: '1.0-0' }} m²</span>
                  </button>
                  @if (canEdit()) {
                    <button
                      type="button"
                      class="x"
                      (click)="removeZone(z)"
                      [attr.aria-label]="'Delete ' + z.name"
                      pTooltip="Delete zone"
                    >
                      <app-icon name="close" />
                    </button>
                  }
                </li>
              }
            </ul>
            @if (store.categories().length) {
              <h3>Categories</h3>
              <ul class="legend">
                @for (c of store.categories(); track c.id; let i = $index) {
                  <li><span class="swatch" [style.background]="colorOf(i)"></span>{{ c.name }}</li>
                }
              </ul>
            }
            <h3>Rules</h3>
            <p class="muted small">
              Every change is checked against the {{ rulesOn() }} rules on for this hall. A change
              that breaks one is not made; the message says why.
            </p>
          </aside>

          <app-planner-canvas
            #canvas
            class="canvas"
            [floor]="v.hall.floor"
            [plan]="store.plan()"
            [selection]="store.selection()"
            [tool]="tool()"
            [snapStep]="snapStep()"
            [categoryColors]="categoryColors()"
            [readonly]="!canEdit()"
            (drawRect)="drawn($event)"
            (drawPolygon)="zoneFromPolygon($event)"
            (placeAt)="placeBooth($event)"
            (pick)="picked($event)"
            (move)="moved($event)"
          />

          <aside class="side right" aria-label="Properties">
            <app-planner-properties
              [store]="store"
              [readonly]="!canEdit()"
              (patch)="patchStalls($event)"
              (zonePatch)="patchZone($event)"
              (seatCategory)="seatCategory($event)"
              (remove)="removeSelection()"
            />
          </aside>
        </div>
      </div>
    } @else {
      <p-progressbar mode="indeterminate" />
    }
  `,
  styles: `
    :host {
      display: block;
      height: calc(100dvh - 64px);
    }
    .planner {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--app-surface);
    }
    .top {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--app-outline-variant);
      min-width: 0;
      flex-wrap: wrap;
    }
    .title {
      display: grid;
      min-width: 0;
    }
    .title span {
      font: var(--app-body-small);
    }
    .spacer {
      flex: 1;
    }
    .stepper {
      display: flex;
      gap: 6px;
      align-items: center;
      margin: 0 0 0 16px;
      padding: 0;
      list-style: none;
      font: var(--app-label-medium);
      color: var(--app-on-surface-variant);
    }
    .stepper li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .stepper li + li::before {
      content: '';
      width: 28px;
      border-top: 2px solid var(--app-outline-variant);
    }
    .stepper li.done + li::before,
    .stepper li.done::before {
      border-color: #16a34a;
    }
    .dot {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid var(--app-outline-variant);
      font-size: 12px;
      font-weight: 700;
    }
    .done {
      color: #15803d;
    }
    .done .dot {
      background: #16a34a;
      border-color: #16a34a;
      color: #fff;
    }
    .now {
      color: var(--app-on-surface);
    }
    .now .dot {
      background: var(--app-primary);
      border-color: var(--app-primary);
      color: var(--app-on-primary);
    }
    .save {
      --p-button-primary-background: #16a34a;
      --p-button-primary-border-color: #16a34a;
      --p-button-primary-hover-background: #15803d;
      --p-button-primary-hover-border-color: #15803d;
    }
    .ribbon {
      display: flex;
      gap: 0;
      padding: 4px 8px 0;
      border-bottom: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
      overflow-x: auto;
    }
    .group {
      display: grid;
      justify-items: center;
      padding: 0 10px;
      border-right: 1px solid var(--app-outline-variant);
    }
    .group:last-child {
      border-right: 0;
    }
    .tools {
      display: flex;
      gap: 2px;
    }
    .group-label {
      padding: 2px 0 4px;
      font: var(--app-label-small);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--app-on-surface-variant);
    }
    .tool {
      display: grid;
      justify-items: center;
      gap: 4px;
      min-width: 64px;
      padding: 8px 8px 6px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--app-on-surface);
      font: var(--app-label-small);
      cursor: pointer;
      white-space: nowrap;
    }
    .tool app-icon {
      font-size: 1.15rem;
    }
    .tool:hover:not(:disabled),
    .tool:focus-visible {
      background: var(--app-surface-container);
    }
    .tool.on {
      background: #1e293b;
      color: #fff;
    }
    .tool.auto {
      color: #15803d;
    }
    .tool.seat {
      color: #7e22ce;
    }
    .tool.danger {
      color: var(--app-error);
    }
    .tool:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .readonly {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 10px 16px;
      background: #fef9c3;
      color: #713f12;
      font: var(--app-body-medium);
    }
    .busy {
      position: absolute;
      inset: 0 0 auto;
      z-index: 2;
      height: 3px;
    }
    .body {
      flex: 1;
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr) 300px;
      min-height: 0;
    }
    @media (max-width: 1100px) {
      .body {
        grid-template-columns: minmax(0, 1fr) 280px;
      }
      .left {
        display: none !important;
      }
    }
    .side {
      display: grid;
      gap: 10px;
      align-content: start;
      padding: 14px;
      overflow: auto;
      background: var(--app-surface-container-lowest);
    }
    .left {
      border-right: 1px solid var(--app-outline-variant);
    }
    .right {
      border-left: 1px solid var(--app-outline-variant);
    }
    .side h3 {
      margin: 6px 0 0;
      font: var(--app-label-small);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--app-on-surface-variant);
    }
    .canvas {
      min-width: 0;
      min-height: 0;
    }
    .counts {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      margin: 0;
      font-size: 13px;
    }
    .counts dt {
      color: var(--app-on-surface-variant);
    }
    .counts dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .zones,
    .legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    .zones li {
      display: flex;
      align-items: center;
      border-radius: 8px;
    }
    .zones li.on {
      background: var(--app-secondary-container);
    }
    .zone {
      flex: 1;
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 0;
      padding: 6px 8px;
      border: 0;
      background: none;
      color: inherit;
      font: var(--app-body-medium);
      text-align: left;
      cursor: pointer;
    }
    .zname {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .x {
      border: 0;
      background: none;
      color: var(--app-on-surface-variant);
      padding: 6px;
      border-radius: 6px;
      cursor: pointer;
    }
    .x:hover {
      color: var(--app-error);
    }
    .legend li {
      display: flex;
      gap: 8px;
      align-items: center;
      font: var(--app-body-small);
    }
    .swatch {
      width: 14px;
      height: 14px;
      flex: none;
      border-radius: 3px;
      border: 1px solid rgb(0 0 0 / 0.15);
    }
    .small {
      font: var(--app-body-small);
      margin: 0;
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PlannerPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  protected readonly store = inject(PlannerStore);
  private readonly api = inject(PlansApi);
  private readonly dialog = inject(AppDialog);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);
  protected readonly slug = inject(OrgContextStore).slug;
  private readonly canvas = viewChild<PlannerCanvasComponent>('canvas');

  protected readonly tool = signal<PlannerTool>('select');
  protected readonly canEdit = this.store.canEdit;

  protected readonly pointerTools: RibbonTool[] = [
    { id: 'select', label: 'Select', icon: 'near_me', key: 'V' },
    { id: 'pan', label: 'Pan', icon: 'swap_horiz', key: 'H' },
  ];
  protected readonly zoneTools: RibbonTool[] = [
    { id: 'zone-rect', label: 'Zone', icon: 'crop_square', key: 'Z' },
    { id: 'zone-poly', label: 'Polygon', icon: 'polyline', key: 'P' },
  ];

  /** The 1 m grid profile asks for whole metres; else half-metre steps. */
  protected readonly snapStep = computed(() =>
    this.store.view()?.hall.rules.drawingProfile === 'grid' ? 1 : 0.5,
  );
  protected readonly rulesOn = computed(() => this.store.view()?.hall.hall.rulesOn ?? 0);
  protected readonly categoryColors = computed(
    () => new Map(this.store.categories().map((c, i) => [c.id, this.colorOf(i)] as const)),
  );
  protected readonly stallArea = computed(() =>
    this.store.plan().stalls.reduce((sum, s) => sum + s.width * s.depth, 0),
  );
  protected readonly steps = computed(() => {
    const p = this.store.plan();
    const t = this.tool();
    return [
      { label: 'Zones', done: p.zones.length > 0, now: t === 'zone-rect' || t === 'zone-poly' },
      { label: 'Booths', done: p.stalls.length > 0, now: t === 'booth' },
      { label: 'Seats', done: p.seats.length > 0, now: false },
      {
        label: 'Save',
        done: this.store.revision() > 0 && !this.store.dirty(),
        now: this.store.dirty(),
      },
    ];
  });

  constructor() {
    effect(() => {
      const [eventId, hallId] = [this.eventId(), this.hallId()];
      untracked(() => void this.load(eventId, hallId));
    });
  }

  private async load(eventId: string, hallId: string): Promise<void> {
    try {
      const view = await firstValueFrom(this.api.get(this.slug(), eventId, hallId));
      this.store.load(this.slug(), eventId, hallId, view);
    } catch {
      // The error interceptor has shown it.
    }
  }

  /** Leaving with unsaved changes asks first (see the route's guard). */
  canLeave(): Promise<boolean> | boolean {
    if (!this.store.dirty()) return true;
    return this.confirm.confirm({
      title: 'Leave without saving?',
      message: 'The plan has changes that are not saved. They are lost if you leave.',
      confirmLabel: 'Leave',
      destructive: true,
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  @HostListener('window:keydown', ['$event'])
  protected key(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable], .p-dialog')) return;
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
      const tool = ({ v: 'select', h: 'pan', z: 'zone-rect', p: 'zone-poly', b: 'booth' } as const)[
        e.key.toLowerCase() as 'v'
      ];
      if (tool) this.setTool(tool);
    }
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

  private async addZone(polygon: Point[]): Promise<void> {
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
      zones: [...plan.zones, zone],
      stalls: plan.stalls.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
      seats: plan.seats.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
    };
    if (await this.store.change(next, [zone.id], { kind: 'zone', ids: [zone.id] })) {
      this.tool.set('select');
    }
  }

  private async addBooth(r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<void> {
    const plan = this.store.plan();
    const [number] = stallNumbers(plan.stalls, null, 'numbers', 1, '');
    const stall = this.newStall(r, number);
    await this.store.change({ ...plan, stalls: [...plan.stalls, stall] }, [stall.id], {
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
    } else {
      next = { ...plan, seats: plan.seats.map((s) => (ids.has(s.id) ? this.rezone(shift(s)) : s)) };
    }
    await this.store.change(next, e.ids);
  }

  /** The zone an item is in after it moved. */
  private rezone<T extends PlanStall | PlanSeat>(i: T): T {
    return { ...i, zoneId: zoneAt(centre(stallRect(i)), this.store.plan().zones)?.id ?? null };
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
    });
  }

  /** Deletes a zone; its stalls and seats stay, in no zone. */
  protected removeZone(zone: PlanZone): void {
    const plan = this.store.plan();
    const out = <T extends PlanStall | PlanSeat>(i: T): T =>
      i.zoneId === zone.id ? { ...i, zoneId: null } : i;
    this.store.remove({
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
  ): Promise<void> {
    const result = await this.store.addPassing(add);
    if (!result) return;
    const name = (n: number) => `${n.toLocaleString('en-IN')} ${what}${n === 1 ? '' : 's'}`;
    if (result.dropped) {
      this.notifier.warn(
        `${name(result.added)} added; ${name(result.dropped)} left out because they break a rule.`,
      );
    } else {
      this.notifier.success(`${name(result.added)} added.`);
    }
  }

  protected async save(): Promise<void> {
    if (!this.store.dirty() || this.store.busy()) return;
    await this.store.save();
  }
}
