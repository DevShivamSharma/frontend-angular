import { DatePipe, DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import { OrgContextStore } from '../../../core/org/org.stores';
import { stallLabel } from '../../../core/plans/plans.models';
import { forSale, rupees } from '../../../core/plans/stall-price';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { IconComponent } from '../../../shared/icon.component';
import { PlannerCanvasComponent, PlannerTool } from './planner-canvas.component';
import { PlannerStore } from './planner.store';

/** The tools a reviewer has: they look and measure, and change nothing. */
const TOOLS: Array<{ id: PlannerTool; label: string; icon: string }> = [
  { id: 'select', label: 'Select a stall', icon: 'near_me' },
  { id: 'measure-distance', label: 'Measure a distance', icon: 'measure' },
  { id: 'measure-area', label: 'Measure an area', icon: 'area' },
];

/**
 * The venue's review of an external event's stall plan: the organiser's saved plan, in 3D and
 * 2D, to look at and measure; what it holds, whether it keeps the hall's rules, and Approve or
 * Send back when it waits for approval. Nothing on it changes the plan.
 */
@Component({
  selector: 'app-plan-review',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    TooltipModule,
    IconComponent,
    PlannerCanvasComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.view(); as v) {
      <div class="review-page">
        <header class="bar">
          <a class="back" [routerLink]="back()" aria-label="Back to the hall">
            <app-icon name="arrow_back" />
          </a>
          <div class="title">
            <h1>Review: {{ v.hall.hall.name }}</h1>
            <p class="muted">
              {{ v.hall.event.name }} · drawn by {{ organiser() }}
              @if (v.plan.revision) {
                · version {{ v.plan.revision }}
              }
            </p>
          </div>
          <span class="status" [class]="status().tone" role="status">
            <app-icon [name]="status().icon" />{{ status().label }}
          </span>
          @if (v.canApprove) {
            <div class="actions">
              <button
                type="button"
                class="btn quiet"
                (click)="sendBack()"
                [disabled]="store.busy()"
                pTooltip="Send the plan back to the organiser, saying what to change"
                tooltipPosition="bottom"
              >
                <app-icon name="close" />Send back
              </button>
              <button
                type="button"
                class="btn approve"
                (click)="approve()"
                [disabled]="store.busy() || breaks().length > 0"
                [pTooltip]="
                  breaks().length
                    ? 'The plan breaks a rule of the hall: send it back'
                    : 'Approve the plan, which publishes it; the organiser gets an email'
                "
                tooltipPosition="bottom"
              >
                <app-icon name="check_circle" />Approve
              </button>
            </div>
          }
        </header>

        <div class="body">
          <div class="stage">
            @if (v.plan.revision) {
              <div class="tools" role="toolbar" aria-label="Look at the plan">
                @for (t of tools; track t.id) {
                  <button
                    type="button"
                    class="icon"
                    [class.on]="tool() === t.id"
                    [attr.aria-pressed]="tool() === t.id"
                    (click)="tool.set(t.id)"
                    [pTooltip]="t.label"
                    tooltipPosition="bottom"
                  >
                    <app-icon [name]="t.icon" /><span class="sr">{{ t.label }}</span>
                  </button>
                }
                <span class="divider"></span>
                <button
                  type="button"
                  class="icon"
                  (click)="canvas.zoomBy(1.25)"
                  pTooltip="Zoom in"
                  tooltipPosition="bottom"
                >
                  <app-icon name="zoom_in" /><span class="sr">Zoom in</span>
                </button>
                <button
                  type="button"
                  class="icon"
                  (click)="canvas.zoomBy(0.8)"
                  pTooltip="Zoom out"
                  tooltipPosition="bottom"
                >
                  <app-icon name="zoom_out" /><span class="sr">Zoom out</span>
                </button>
                <button
                  type="button"
                  class="icon"
                  (click)="canvas.fit()"
                  pTooltip="The whole hall"
                  tooltipPosition="bottom"
                >
                  <app-icon name="fit_screen" /><span class="sr">The whole hall</span>
                </button>
                <span class="divider"></span>
                <button
                  type="button"
                  class="icon"
                  [class.on]="showLabels()"
                  [attr.aria-pressed]="showLabels()"
                  (click)="showLabels.set(!showLabels())"
                  pTooltip="Stall numbers"
                  tooltipPosition="bottom"
                >
                  <app-icon name="label" /><span class="sr">Stall numbers</span>
                </button>
                <button
                  type="button"
                  class="icon"
                  [class.on]="showGrid()"
                  [attr.aria-pressed]="showGrid()"
                  (click)="showGrid.set(!showGrid())"
                  pTooltip="Grid"
                  tooltipPosition="bottom"
                >
                  <app-icon name="grid_on" /><span class="sr">Grid</span>
                </button>
              </div>
              <app-planner-canvas
                #canvas
                class="canvas"
                [floor]="v.hall.floor"
                [plan]="store.plan()"
                [selection]="store.selection()"
                [tool]="tool()"
                [categoryColors]="categoryColors()"
                [readonly]="true"
                [showGrid]="showGrid()"
                [showLabels]="showLabels()"
                (pick)="store.select($event)"
              />
            } @else {
              <div class="empty">
                <app-icon name="hourglass_empty" />
                <p>{{ organiser() }} has not saved a stall plan for this hall yet.</p>
              </div>
            }
          </div>

          <aside class="side" aria-label="About the plan">
            @if (v.plan.review; as r) {
              <section class="card">
                <h2>Approval</h2>
                <p class="small">
                  {{ r.submittedBy ?? 'The organiser' }} sent version {{ r.revision }} on
                  {{ r.submittedAt | date: 'd MMM y, HH:mm' }}.
                </p>
                @if (r.reviewedAt) {
                  <p class="small">
                    {{ r.reviewedBy ?? 'The venue' }}
                    {{ r.status === 'approved' ? 'approved it' : 'sent it back' }} on
                    {{ r.reviewedAt | date: 'd MMM y, HH:mm' }}.
                  </p>
                }
                @if (r.note) {
                  <blockquote>{{ r.note }}</blockquote>
                }
                @if (r.status !== 'submitted' && v.plan.revision > r.revision) {
                  <p class="small muted">
                    Saved again since (version {{ v.plan.revision }}), not sent yet.
                  </p>
                }
              </section>
            }

            @if (v.plan.revision) {
              <section class="card">
                <h2>Rules of the hall</h2>
                @if (v.findings === null) {
                  <p class="small muted">Checked when the plan is opened.</p>
                } @else if (breaks().length) {
                  <p class="small bad">
                    <app-icon name="warning" />The plan breaks {{ breaks().length }}
                    {{ breaks().length === 1 ? 'rule' : 'rules' }} now:
                  </p>
                  <ul class="findings">
                    @for (f of breaks(); track $index) {
                      <li>
                        <button type="button" class="link" (click)="show(f.ids)">
                          {{ f.message }}
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="small good">
                    <app-icon name="check_circle" />It keeps every rule of the hall.
                  </p>
                }
              </section>

              <section class="card">
                <h2>What it holds</h2>
                <dl class="stats">
                  <dt>Stalls</dt>
                  <dd>{{ summary().stalls | number }}</dd>
                  <dt>For sale</dt>
                  <dd>{{ summary().forSale | number }}</dd>
                  <dt>Area for sale</dt>
                  <dd>{{ summary().area | number: '1.0-0' }} m²</dd>
                  <dt>Premium</dt>
                  <dd>{{ summary().premium | number }}</dd>
                  <dt>Corner (2+ open sides)</dt>
                  <dd>{{ summary().corner | number }}</dd>
                  <dt>Blocked</dt>
                  <dd>{{ summary().blocked | number }}</dd>
                  <dt>Zones</dt>
                  <dd>{{ summary().zones | number }}</dd>
                  @if (summary().seats) {
                    <dt>Seats</dt>
                    <dd>{{ summary().seats | number }}</dd>
                  }
                  @if (store.pricing()) {
                    <dt>Value (excl. GST)</dt>
                    <dd>{{ rupees(store.planValue()) }}</dd>
                    <dt>Without a price</dt>
                    <dd>{{ store.unpriced().length | number }}</dd>
                  }
                </dl>
              </section>

              <section class="card">
                <h2>Selected stall</h2>
                @if (picked(); as s) {
                  <dl class="stats">
                    <dt>Number</dt>
                    <dd>{{ s.label }}</dd>
                    <dt>Size</dt>
                    <dd>
                      {{ s.width | number: '1.0-2' }} × {{ s.depth | number: '1.0-2' }} m ({{
                        s.width * s.depth | number: '1.0-1'
                      }}
                      m²)
                    </dd>
                    <dt>Open sides</dt>
                    <dd>{{ s.sides }}</dd>
                    <dt>Categories</dt>
                    <dd>{{ s.categories || '—' }}</dd>
                    @if (s.flags) {
                      <dt>Marked</dt>
                      <dd>{{ s.flags }}</dd>
                    }
                    @if (store.pricing()) {
                      <dt>Price</dt>
                      <dd [title]="s.reckoning">{{ s.price }}</dd>
                    }
                  </dl>
                } @else {
                  <p class="small muted">Click a stall on the plan to read it here.</p>
                }
              </section>
            }
          </aside>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .review-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--app-surface);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
    }
    .back {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      color: var(--app-on-surface);
    }
    .back:hover {
      background: var(--app-surface-container);
    }
    .title {
      flex: 1;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font: var(--app-title-medium);
    }
    .muted {
      margin: 0;
      color: var(--app-on-surface-variant);
      font: var(--app-body-small);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font: var(--app-label-medium);
      background: var(--app-surface-container);
      color: var(--app-on-surface);
    }
    .status.wait {
      background: light-dark(#e0f2fe, #0c4a6e);
      color: light-dark(#0c4a6e, #e0f2fe);
    }
    .status.good {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#14532d, #dcfce7);
    }
    .status.bad {
      background: light-dark(#fee2e2, #7f1d1d);
      color: light-dark(#7f1d1d, #fee2e2);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border: 0;
      border-radius: 4px;
      font: var(--app-label-medium);
      cursor: pointer;
    }
    .btn.quiet {
      background: var(--app-surface-container);
      color: var(--app-on-surface);
    }
    .btn.approve {
      background: #16a34a;
      color: #fff;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
    }
    .stage {
      position: relative;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .tools {
      display: flex;
      align-items: center;
      gap: 1px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--app-on-surface);
      cursor: pointer;
    }
    .icon:hover {
      background: var(--app-surface-container);
    }
    .icon.on {
      background: var(--app-on-surface);
      color: var(--app-surface);
    }
    .divider {
      width: 1px;
      height: 20px;
      margin: 0 6px;
      background: var(--app-outline-variant);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .canvas {
      flex: 1;
      min-height: 0;
    }
    .empty {
      flex: 1;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 8px;
      color: var(--app-on-surface-variant);
    }
    .side {
      overflow-y: auto;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 12px;
      border-left: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
    }
    .card {
      padding: 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
    }
    h2 {
      margin: 0 0 8px;
      font: var(--app-label-large);
    }
    .small {
      margin: 0 0 6px;
      font: var(--app-body-small);
    }
    .good,
    .bad {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .good {
      color: light-dark(#15803d, #4ade80);
    }
    .bad {
      color: var(--app-error);
    }
    blockquote {
      margin: 6px 0;
      padding: 6px 10px;
      border-left: 3px solid var(--app-error);
      background: var(--app-surface-container);
      font: var(--app-body-small);
    }
    .findings {
      margin: 0;
      padding-left: 18px;
      font: var(--app-body-small);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: left;
      text-decoration: underline;
      cursor: pointer;
    }
    .stats {
      display: grid;
      grid-template-columns: auto auto;
      gap: 4px 12px;
      margin: 0;
      font: var(--app-body-small);
    }
    .stats dt {
      color: var(--app-on-surface-variant);
    }
    .stats dd {
      margin: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    @media (max-width: 900px) {
      .body {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(360px, 1fr) auto;
      }
      .side {
        border-left: 0;
        border-top: 1px solid var(--app-outline-variant);
      }
    }
  `,
})
export class PlanReviewComponent {
  protected readonly rupees = rupees;
  protected readonly store = inject(PlannerStore);
  private readonly context = inject(OrgContextStore);
  private readonly confirm = inject(ConfirmService);
  protected readonly canvas = viewChild<PlannerCanvasComponent>('canvas');

  readonly categoryColors = input<ReadonlyMap<string, string>>(new Map());

  protected readonly tools = TOOLS;
  protected readonly tool = signal<PlannerTool>('select');
  protected readonly showLabels = signal(true);
  protected readonly showGrid = signal(false);

  protected readonly back = computed(() => {
    const v = this.store.view();
    return v
      ? ['/', this.context.slug(), 'events', v.hall.event.id, 'halls', v.hall.hall.hallId]
      : ['/'];
  });
  protected readonly organiser = computed(
    () => this.store.view()?.hall.event.organiserName ?? 'The organiser',
  );
  protected readonly breaks = computed(() => this.store.view()?.findings ?? []);

  /** Where the plan stands, in a word and a colour. */
  protected readonly status = computed(() => {
    const v = this.store.view();
    const r = v?.plan.review;
    if (!v?.plan.revision) return { label: 'Not drawn yet', icon: 'hourglass_empty', tone: '' };
    if (r?.status === 'submitted')
      return {
        label: `Waiting for approval · v${r.revision}`,
        icon: 'hourglass_empty',
        tone: 'wait',
      };
    if (r?.status === 'approved')
      return { label: `Approved · v${r.revision}`, icon: 'check_circle', tone: 'good' };
    if (r?.status === 'rejected')
      return { label: `Sent back · v${r.revision}`, icon: 'warning', tone: 'bad' };
    return { label: 'Not sent for approval yet', icon: 'edit', tone: '' };
  });

  protected readonly summary = computed(() => {
    const p = this.store.plan();
    const open = p.stalls.filter((s) => !s.isBlocked);
    return {
      stalls: p.stalls.length,
      forSale: open.filter((s) => s.isActive).length,
      area: open.reduce((sum, s) => sum + s.width * s.depth, 0),
      premium: p.stalls.filter((s) => s.isPremium).length,
      corner: p.stalls.filter((s) => s.openSides.length >= 2).length,
      blocked: p.stalls.length - open.length,
      zones: p.zones.length,
      seats: p.seats.length,
    };
  });

  /** The stall clicked on the plan, in words. */
  protected readonly picked = computed(() => {
    const s = this.store.selectedStalls()[0];
    if (!s) return null;
    const names = this.store.categoryName();
    const price = this.store.prices().get(s.id) ?? null;
    const flags = [
      s.isPremium && 'premium',
      s.isBlocked && 'blocked',
      s.isFnb && 'food & beverage',
      s.isBranding && 'branding',
      s.isMarqueeAvailable && 'marquee',
      !s.isActive && 'not for sale',
    ].filter(Boolean);
    return {
      label: stallLabel(s),
      price: price
        ? `₹${price.price.toLocaleString('en-IN')}`
        : forSale(s)
          ? 'none'
          : 'not for sale',
      reckoning: price?.reckoning ?? '',
      width: s.width,
      depth: s.depth,
      sides: s.openSides.length ? s.openSides.join(', ') : 'none',
      categories: s.categoryIds.map((id) => names.get(id) ?? '?').join(', '),
      flags: flags.join(', '),
    };
  });

  constructor() {
    // The organiser's plan opens in 3D: the hall as visitors will walk it. 2D is a click away.
    afterNextRender(() => {
      if (this.store.view()?.plan.revision) this.canvas()?.enter3d();
    });
  }

  /** A broken rule's stalls, picked on the plan in 2D. */
  protected show(ids: string[]): void {
    if (this.canvas()?.is3d()) this.canvas()?.leave3d();
    this.tool.set('select');
    if (ids.length) this.store.select({ kind: 'stall', ids });
  }

  protected async approve(): Promise<void> {
    const r = this.store.view()?.plan.review;
    const ok = await this.confirm.confirm({
      title: 'Approve the stall plan?',
      message: `Version ${r?.revision} becomes the published plan of this hall. ${r?.submittedBy ?? 'The organiser'} gets an email.`,
      confirmLabel: 'Approve',
    });
    if (ok) await this.store.review('approve');
  }

  protected async sendBack(): Promise<void> {
    const r = this.store.view()?.plan.review;
    const note = await this.confirm.askReason({
      title: 'Send the plan back?',
      message: `${r?.submittedBy ?? 'The organiser'} gets an email with your note, and can change the plan and send it again.`,
      reasonLabel: 'What should change',
      confirmLabel: 'Send back',
      destructive: true,
    });
    if (note) await this.store.review('reject', note);
  }
}
