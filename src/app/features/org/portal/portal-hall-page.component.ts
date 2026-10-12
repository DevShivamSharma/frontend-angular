import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import {
  holdUntil,
  MINE_COLOR,
  paise,
  STALL_STATE_COLORS,
  STALL_STATE_LABELS,
} from '../../../core/bookings/booking-rules';
import type {
  BookingView,
  PortalHoldView,
  StallMapView,
} from '../../../core/bookings/bookings.models';
import type { PlanContent } from '../../../core/plans/plans.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { PortalPayment } from '../../../core/bookings/portal-payment.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { PickEvent, PlannerCanvasComponent } from '../planner/planner-canvas.component';
import { Selection } from '../planner/planner.store';
import { portalColors, portalPlan } from './portal-plan';

const EMPTY_PLAN: PlanContent = { zones: [], seats: [], objects: [], stalls: [] };

/**
 * One hall of an event for an exhibitor: the published plan on the planner canvas (2D or 3D),
 * every stall coloured by availability and the exhibitor's own in blue. Picking a stall reads it
 * in the side panel, where a free one is held for an hour and paid for. Nothing on the plan can
 * be changed.
 */
@Component({
  selector: 'app-portal-hall-page',
  imports: [
    DecimalPipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    TooltipModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    PlannerCanvasComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a pButton [text]="true" class="back" [routerLink]="['/', slug(), 'portal']"
        ><app-icon name="arrow_back" />My events</a
      >
      <app-page-header
        [heading]="map()?.hall?.name ?? 'Choose a stall'"
        [subheading]="map()?.event?.name ?? ''"
      />

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="The hall could not be loaded" [text]="message">
            <button pButton (click)="load()"><app-icon name="restart_alt" />Try again</button>
          </app-empty-state>
        </div>
      } @else if (map(); as m) {
        @if (m.closedReason) {
          <p class="notice" role="status"><app-icon name="info" />{{ m.closedReason }}</p>
        }
        @if (!m.stalls.length) {
          <div class="panel">
            <app-empty-state
              icon="grid_on"
              [heading]="m.published ? 'This hall has no stalls' : 'The plan is not published yet'"
              text="Stalls appear here once the organiser publishes the hall's plan."
            />
          </div>
        } @else {
          <div class="layout">
            <div class="panel stage">
              <div class="tools" role="toolbar" aria-label="Look at the hall">
                <button
                  type="button"
                  pButton
                  [text]="true"
                  (click)="canvas.zoomBy(1.25)"
                  pTooltip="Zoom in"
                  tooltipPosition="bottom"
                >
                  <app-icon name="zoom_in" /><span class="visually-hidden">Zoom in</span>
                </button>
                <button
                  type="button"
                  pButton
                  [text]="true"
                  (click)="canvas.zoomBy(0.8)"
                  pTooltip="Zoom out"
                  tooltipPosition="bottom"
                >
                  <app-icon name="zoom_out" /><span class="visually-hidden">Zoom out</span>
                </button>
                <button
                  type="button"
                  pButton
                  [text]="true"
                  (click)="canvas.fit()"
                  pTooltip="The whole hall"
                  tooltipPosition="bottom"
                >
                  <app-icon name="fit_screen" /><span class="visually-hidden">The whole hall</span>
                </button>
                <ul class="legend" aria-label="Colours">
                  @for (l of legend; track l.label) {
                    <li><span class="swatch" [style.background]="l.color"></span>{{ l.label }}</li>
                  }
                </ul>
              </div>
              <app-planner-canvas
                #canvas
                class="canvas"
                [floor]="m.floor"
                [plan]="plan()"
                [selection]="selection()"
                tool="select"
                [categoryColors]="colors"
                [readonly]="true"
                (pick)="pick($event)"
              />
            </div>

            <aside class="panel side" aria-label="Selected stall">
              @if (selected(); as s) {
                <h2 class="section-title">Stall {{ s.label }}</h2>
                <p class="muted small">
                  {{ s.width | number: '1.0-2' }} × {{ s.depth | number: '1.0-2' }} m ·
                  {{ s.width * s.depth | number: '1.0-2' }} m² ·
                  {{ s.openSides.length ? s.openSides.join(', ') : 'no' }} open
                  {{ s.openSides.length === 1 ? 'side' : 'sides' }}
                </p>
                @if (s.price; as p) {
                  <p>
                    <b>{{ money(p.amountPaise) }}</b>
                    <span class="muted small">excl. GST</span>
                  </p>
                  <p class="muted small">{{ p.reckoning }}</p>
                }
                @if (s.booking; as b) {
                  <p>
                    <b>{{ b.status === 'confirmed' ? 'Booked by you' : yourHold(b.id) }}</b>
                  </p>
                } @else if (s.state === 'free') {
                  @if (m.bookable) {
                    <button
                      pButton
                      (click)="hold(m, s.id, s.label, s.price?.amountPaise ?? 0)"
                      [disabled]="busy()"
                    >
                      <app-icon name="lock_clock" />{{ holdLabel(s.price?.amountPaise ?? 0) }}
                    </button>
                    <p class="muted small">Held for 60 minutes while you pay.</p>
                  } @else {
                    <p class="muted">Free, but it cannot be held now.</p>
                  }
                } @else {
                  <p class="muted">{{ stateLabels[s.state] }}</p>
                }
              } @else {
                <p class="muted">Pick a stall on the plan to read it and hold it.</p>
              }
            </aside>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 16px;
      align-items: start;
    }
    .stage {
      display: flex;
      flex-direction: column;
      height: min(72vh, 680px);
      min-height: 400px;
      padding: 0;
      overflow: hidden;
    }
    .canvas {
      flex: 1;
      min-height: 0;
    }
    .tools {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--app-outline-variant);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin: 0 0 0 auto;
      padding: 0;
      list-style: none;
      font: var(--app-body-small);
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
    .side {
      display: grid;
      gap: 8px;
    }
    .side p,
    .side .section-title {
      margin: 0;
    }
    .small {
      font: var(--app-body-small);
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class PortalHallPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly payment = inject(PortalPayment);
  private readonly context = inject(OrgContextStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly slug = this.context.slug;
  protected readonly money = paise;
  protected readonly stateLabels = STALL_STATE_LABELS;
  protected readonly colors = portalColors();
  protected readonly legend = [
    ...(['free', 'held', 'booked', 'not_for_sale'] as const).map((state) => ({
      label: STALL_STATE_LABELS[state],
      color: STALL_STATE_COLORS[state],
    })),
    { label: 'Yours', color: MINE_COLOR },
  ];

  protected readonly map = signal<StallMapView | null>(null);
  /** The exhibitor's own bookings, for when their holds run out. */
  private readonly mine = signal<BookingView[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly selection = signal<Selection | null>(null);
  /** The latest hold, with its payment (Checkout) when the server could open one. */
  protected readonly lastHold = signal<PortalHoldView | null>(null);
  /** The latest request; an older answer arriving late is dropped. */
  private token = 0;
  /** Reloads once more when a payment is still being confirmed with Razorpay. */
  private pendingReload: ReturnType<typeof setTimeout> | null = null;

  protected readonly plan = computed(() => {
    const m = this.map();
    return m ? portalPlan(m) : EMPTY_PLAN;
  });
  protected readonly selected = computed(
    () => this.map()?.stalls.find((s) => s.id === this.selection()?.ids[0]) ?? null,
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.pendingReload) clearTimeout(this.pendingReload);
    });
    // Only the route inputs restart the load: the requests themselves read the session signal.
    effect(() => {
      this.eventId();
      this.hallId();
      untracked(() => {
        this.map.set(null);
        this.selection.set(null);
        void this.load();
      });
    });
  }

  /** The map and the exhibitor's bookings as they are now; `showLoading` false after a change. */
  protected async load(showLoading = true): Promise<void> {
    const token = ++this.token;
    if (showLoading) this.loading.set(true);
    this.loadError.set(null);
    try {
      const [map, mine] = await Promise.all([
        firstValueFrom(this.api.stallMap(this.slug(), this.eventId(), this.hallId())),
        firstValueFrom(this.api.bookings(this.slug())),
      ]);
      if (token !== this.token) return;
      this.map.set(map);
      this.mine.set(mine);
    } catch (error) {
      if (token === this.token) {
        this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
      }
    } finally {
      if (token === this.token) this.loading.set(false);
    }
  }

  protected pick(e: PickEvent | null): void {
    this.selection.set(e?.kind === 'stall' ? { kind: 'stall', ids: [e.ids[0]] } : null);
  }

  /** "Held for you until HH:MM", from the exhibitor's own booking of the stall. */
  protected yourHold(bookingId: string): string {
    const b = this.mine().find((x) => x.id === bookingId);
    return b ? `Held for you until ${holdUntil(b)}` : 'Held for you';
  }

  /** The hold button: with a price, holding goes straight on to paying. */
  protected holdLabel(amountPaise: number): string {
    return amountPaise ? `Hold and pay ${paise(amountPaise)} (excl. GST)` : 'Hold this stall';
  }

  protected async hold(
    map: StallMapView,
    stallId: string,
    label: string,
    amountPaise: number,
  ): Promise<void> {
    const price = amountPaise ? `${paise(amountPaise)} (excl. GST)` : null;
    const ok = await this.confirm.confirm({
      title: `Hold stall ${label} for 60 minutes?`,
      message: price
        ? `The stall is yours while the hold lasts; pay ${price} next to keep it. Let go of it any time from My bookings.`
        : 'The stall is yours while the hold lasts. Let go of it any time from My bookings.',
      confirmLabel: price ? 'Hold and pay' : 'Hold stall',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const held = await firstValueFrom(
        this.api.hold(this.slug(), {
          eventId: map.event.id,
          hallId: map.hall.id,
          stallId,
          note: null,
        }),
      );
      this.lastHold.set(held);
      if (held.paymentError) {
        this.notifier.warn(
          `Stall ${label} is held until ${holdUntil(held.booking)}. ${held.paymentError} Pay for it from My bookings.`,
        );
      } else {
        // Reload first, so the map shows the hold while Checkout is open.
        await this.load(false);
        const result = await this.payment.pay(this.slug(), held.booking, held.checkout);
        if (result?.outcome === 'pending') this.reloadSoon();
      }
    } catch {
      // The error interceptor has shown it; the map below shows the stall as it is now.
    } finally {
      this.busy.set(false);
    }
    await this.load(false);
  }

  /** A payment awaiting Razorpay's webhook: look again in a few seconds, once. */
  private reloadSoon(): void {
    this.pendingReload = setTimeout(() => void this.load(false), 5000);
  }
}
