import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { errorMessage, httpStatus } from '../../../core/api/http-error';
import { AuthService } from '../../../core/auth/auth.service';
import { paise } from '../../../core/bookings/booking-rules';
import type { PlanContent } from '../../../core/plans/plans.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore, PublicOrgStore } from '../../../core/org/org.stores';
import { PublicEventsApi } from '../../../core/public-events/public-events-api.service';
import type { PublicStallMapView } from '../../../core/public-events/public-events.models';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { PickEvent, PlannerCanvasComponent } from '../planner/planner-canvas.component';
import { Selection } from '../planner/planner.store';
import { BookDialogComponent, BookDialogData } from './book-dialog.component';
import { PublicBarComponent } from './public-bar.component';
import { PUBLIC_STATE_COLORS, PUBLIC_STATE_LABELS, publicColors, publicPlan } from './public-plan';
import { stallArea } from '../../../core/plans/stall-cells';

const EMPTY_PLAN: PlanContent = { zones: [], seats: [], objects: [], stalls: [] };

/**
 * One hall of an event for anyone with the link: the published plan on the planner canvas (2D or
 * 3D), every stall free or not, and a side panel for the stall picked. Booking needs an account:
 * a member who may book goes on to the portal, anyone else is told how to get one.
 */
@Component({
  selector: 'app-public-hall-page',
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
    PublicBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-bar />
    <main class="page">
      <a pButton [text]="true" class="back" [routerLink]="['/', slug(), 'e', eventId()]"
        ><app-icon name="arrow_back" />All halls</a
      >
      <app-page-header
        [heading]="map()?.hall?.name ?? 'Stall map'"
        [subheading]="map()?.event?.name ?? ''"
      />

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="The hall could not be loaded" [text]="message">
            @if (!notFound()) {
              <button pButton (click)="load()"><app-icon name="restart_alt" />Try again</button>
            }
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
              heading="This hall has no stalls"
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
              <p class="count">
                <b>{{ freeCount() }}</b> of {{ forSaleCount() }} stalls free
              </p>
              @if (selected(); as s) {
                <h2 class="section-title">Stall {{ s.label }}</h2>
                <p class="muted small">
                  {{ s.width | number: '1.0-2' }} × {{ s.depth | number: '1.0-2' }} m ·
                  {{ stallArea(s) | number: '1.0-2' }} m² ·
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
                <p class="muted">{{ stateLabels[s.state] }}</p>
              } @else {
                <p class="muted">Pick a stall on the plan to read it.</p>
              }
              <button pButton (click)="book(m)" [disabled]="!m.bookingOpen">
                <app-icon name="lock_clock" />Book this stall
              </button>
              @if (m.closedReason) {
                <p class="muted small">{{ m.closedReason }}</p>
              }
            </aside>
          </div>
        }
      }
    </main>
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
      margin: 0;
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
export class PublicHallPageComponent {
  protected readonly stallArea = stallArea;
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  private readonly api = inject(PublicEventsApi);
  private readonly orgApi = inject(OrgApi);
  private readonly auth = inject(AuthService);
  private readonly context = inject(OrgContextStore);
  private readonly dialog = inject(AppDialog);
  private readonly router = inject(Router);
  private readonly org = inject(PublicOrgStore).config;

  protected readonly slug = computed(() => this.org()?.slug ?? '');
  protected readonly money = paise;
  protected readonly stateLabels = PUBLIC_STATE_LABELS;
  protected readonly colors = publicColors();
  protected readonly legend = (['free', 'unavailable', 'not_for_sale'] as const).map((state) => ({
    label: PUBLIC_STATE_LABELS[state],
    color: PUBLIC_STATE_COLORS[state],
  }));

  protected readonly map = signal<PublicStallMapView | null>(null);
  /** From the event page's call, for the contact address of the booking dialog. */
  private readonly contactEmail = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly selection = signal<Selection | null>(null);
  /** Whether the signed-in member may hold stalls; false when nobody is signed in. */
  private readonly canBook = signal(false);
  /** The latest request; an older answer arriving late is dropped. */
  private token = 0;

  protected readonly plan = computed(() => {
    const m = this.map();
    return m ? publicPlan(m.stalls) : EMPTY_PLAN;
  });
  protected readonly selected = computed(
    () => this.map()?.stalls.find((s) => s.id === this.selection()?.ids[0]) ?? null,
  );
  protected readonly forSaleCount = computed(
    () => this.map()?.stalls.filter((s) => s.state !== 'not_for_sale').length ?? 0,
  );
  protected readonly freeCount = computed(
    () => this.map()?.stalls.filter((s) => s.state === 'free').length ?? 0,
  );

  constructor() {
    effect(() => {
      this.eventId();
      this.hallId();
      untracked(() => {
        this.map.set(null);
        this.selection.set(null);
        void this.load();
        void this.loadAccess();
      });
    });
  }

  protected async load(): Promise<void> {
    const token = ++this.token;
    this.loading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    try {
      const [map, event] = await Promise.all([
        firstValueFrom(this.api.stallMap(this.slug(), this.eventId(), this.hallId())),
        firstValueFrom(this.api.event(this.slug(), this.eventId())),
      ]);
      if (token !== this.token) return;
      this.map.set(map);
      this.contactEmail.set(event.contactEmail);
    } catch (error) {
      if (token === this.token) {
        this.notFound.set(httpStatus(error) === 404);
        this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
      }
    } finally {
      if (token === this.token) this.loading.set(false);
    }
  }

  /** Whether the person signed in (if anyone) may book here, from their permissions. */
  private async loadAccess(): Promise<void> {
    this.canBook.set(false);
    if (!this.auth.signedIn()) return;
    try {
      this.context.context.set(await firstValueFrom(this.orgApi.context(this.slug())));
      this.canBook.set(this.context.can('stalls.book'));
    } catch {
      // Not a member of this organisation: the dialog says how to get an account.
    }
  }

  protected pick(e: PickEvent | null): void {
    this.selection.set(e?.kind === 'stall' ? { kind: 'stall', ids: [e.ids[0]] } : null);
  }

  /** A member who may book goes to the portal's page of this hall; anyone else gets the dialog. */
  protected book(map: PublicStallMapView): void {
    if (this.canBook()) {
      void this.router.navigate([
        '/',
        this.slug(),
        'portal',
        'events',
        map.event.id,
        'halls',
        map.hall.id,
      ]);
      return;
    }
    this.dialog.open<void, BookDialogData>(BookDialogComponent, {
      data: {
        slug: this.slug(),
        eventId: map.event.id,
        hallId: map.hall.id,
        contactEmail: this.contactEmail(),
        signedIn: this.auth.signedIn(),
      },
    });
  }
}
