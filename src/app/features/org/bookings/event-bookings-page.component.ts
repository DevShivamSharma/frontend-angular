import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';

import { errorMessage, httpStatus } from '../../../core/api/http-error';
import {
  BOOKING_STATUS_LABELS,
  bookingClosedReason,
  canCancel,
  canConfirm,
  canExportToSelfcare,
  canMove,
  CHANNEL_LABELS,
  EVENT_STATUS_LABELS,
  paymentLabel,
  STALL_STATE_LABELS,
} from '../../../core/bookings/booking-rules';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import {
  BOOKING_STATUSES,
  BookingEventView,
  BookingStatus,
  BookingView,
  ExhibitorOption,
  MapStallView,
  StallMapView,
} from '../../../core/bookings/bookings.models';
import type { EventPlanSummaryView } from '../../../core/events/events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { MoveBookingDialogComponent, MoveBookingDialogData } from './move-booking-dialog.component';
import { NewBookingDialogComponent, NewBookingDialogData } from './new-booking-dialog.component';
import {
  SelfcareExportDialogComponent,
  SelfcareExportDialogData,
} from './selfcare-export-dialog.component';
import { StallMapComponent } from './stall-map.component';

const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: 'plan in draft',
  approved: 'plan approved, not published',
};

/**
 * An event's bookings: the published stall plan of each of its halls with which stalls are free,
 * and every booking of the event. Members who manage bookings book a free stall for a registered
 * exhibitor, confirm, move and cancel bookings, and export a held one for SelfCare.
 */
@Component({
  selector: 'app-event-bookings-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    EmptyStateComponent,
    PageHeaderComponent,
    StallMapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a mat-button class="back" [routerLink]="['/', slug(), 'events', eventId()]">
        <mat-icon>arrow_back</mat-icon>{{ event()?.name ?? 'Event' }}
      </a>
      @if (event(); as e) {
        <app-page-header
          heading="Bookings"
          [subheading]="
            e.name +
            ' at ' +
            e.venue.name +
            ', ' +
            (e.startsOn | date: 'd MMM y') +
            ' - ' +
            (e.endsOn | date: 'd MMM y')
          "
        >
          <span meta class="meta">
            <span
              class="status-chip"
              [class.is-positive]="e.status === 'scheduled'"
              [class.is-neutral]="e.status === 'draft'"
              [class.is-warning]="e.status === 'cancelled'"
              >{{ eventStatusLabels[e.status] }}</span
            >
          </span>
        </app-page-header>
      } @else {
        <app-page-header heading="Bookings" />
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
        <div class="skeleton-layout" aria-busy="true" aria-label="Loading bookings">
          <div class="panel skeleton tall"></div>
          <div class="panel skeleton side-skeleton"></div>
          <div class="panel skeleton wide"></div>
        </div>
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="The bookings could not be loaded" [text]="message">
            <button mat-flat-button (click)="load()"><mat-icon>refresh</mat-icon>Try again</button>
          </app-empty-state>
        </div>
      } @else if (event(); as e) {
        @if (closedReason(); as reason) {
          <p class="notice" role="status">
            <mat-icon>info</mat-icon><span>{{ reason }}</span>
          </p>
        }

        @if (!e.halls.length) {
          <div class="panel">
            <app-empty-state
              icon="grid_on"
              heading="This event has no hall yet"
              text="Stalls are booked on the published stall plan of a hall the event books."
            />
          </div>
        } @else if (!publishedHalls().length) {
          <div class="panel">
            <app-empty-state
              icon="map"
              heading="No stall plan is published yet"
              text="Stalls can be booked once a hall's stall plan is approved and published."
            />
          </div>
        } @else {
          <section class="panel panel-flush">
            <nav mat-tab-nav-bar [tabPanel]="hallPanel" mat-stretch-tabs="false" aria-label="Halls">
              @for (h of publishedHalls(); track h.hallId) {
                <a mat-tab-link [active]="h.hallId === hallId()" (click)="selectHall(h.hallId)">{{
                  h.name
                }}</a>
              }
            </nav>
            <mat-tab-nav-panel #hallPanel>
              <div class="layout">
                <div class="stage">
                  @if (mapError(); as message) {
                    <app-empty-state
                      icon="error"
                      heading="The stall map could not be loaded"
                      [text]="message"
                    >
                      <button mat-stroked-button (click)="loadMap()">
                        <mat-icon>refresh</mat-icon>Try again
                      </button>
                    </app-empty-state>
                  } @else if (map(); as m) {
                    <div class="row bar">
                      <span class="muted small">
                        {{ counts().free }} free, {{ counts().held }} held,
                        {{ counts().booked }} booked
                      </span>
                      <span class="spacer"></span>
                      @if (mapLoading()) {
                        <span class="muted small">Updating…</span>
                      }
                    </div>
                    @if (m.stalls.length) {
                      <app-stall-map
                        [floor]="m.floor"
                        [stalls]="m.stalls"
                        [selectedId]="selectedStallId()"
                        viewer="staff"
                        [label]="'Stalls of ' + m.hall.name"
                        (picked)="selectedStallId.set($event.id)"
                      />
                    } @else {
                      <app-empty-state
                        icon="grid_off"
                        heading="This plan has no stalls"
                        text="The published plan of this hall has no stall to book."
                      />
                    }
                  } @else {
                    <div
                      class="skeleton map-skeleton"
                      aria-busy="true"
                      aria-label="Loading the stall map"
                    ></div>
                  }
                </div>

                <aside class="side" aria-label="Selected stall">
                  @if (selectedStall(); as s) {
                    <div class="row">
                      <h2 class="section-title grow">Stall {{ s.number }}</h2>
                      <span
                        class="status-chip"
                        [class.is-positive]="s.state === 'free'"
                        [class.is-neutral]="s.state === 'booked'"
                        >{{ stallStateLabels[s.state] }}</span
                      >
                    </div>
                    <p class="muted small">
                      {{ s.area | number: '1.0-2' }} m², {{ s.width | number: '1.0-2' }} ×
                      {{ s.depth | number: '1.0-2' }} m, {{ s.openSides.length }}
                      {{ s.openSides.length === 1 ? 'side' : 'sides' }} open{{
                        s.stallType
                          ? s.stallType === 'shell'
                            ? ', shell scheme'
                            : ', bare space'
                          : ''
                      }}
                    </p>
                    @if (selectedBooking(); as b) {
                      <dl class="facts">
                        <dt>Exhibitor</dt>
                        <dd>{{ b.exhibitor.name }}</dd>
                        <dt>Status</dt>
                        <dd>{{ statusLabel(b) }}</dd>
                        <dt>Channel</dt>
                        <dd>{{ channelLabel(b) }}</dd>
                        <dt>Payment</dt>
                        <dd>{{ payment(b) }}</dd>
                        @if (b.note) {
                          <dt>Note</dt>
                          <dd>{{ b.note }}</dd>
                        }
                        @if (b.externalRef) {
                          <dt>Venue reference</dt>
                          <dd>{{ b.externalRef }}</dd>
                        }
                        <dt>Created</dt>
                        <dd>{{ b.createdAt | date: 'd MMM y, HH:mm' }}</dd>
                      </dl>
                      @if (canManage()) {
                        <div class="actions">
                          @if (allowed.confirm(b)) {
                            <button mat-flat-button (click)="confirmBooking(b)" [disabled]="busy()">
                              <mat-icon>check</mat-icon>Confirm
                            </button>
                          }
                          @if (allowed.move(b)) {
                            <button mat-stroked-button (click)="move(b)" [disabled]="busy()">
                              <mat-icon>swap_horiz</mat-icon>Move
                            </button>
                          }
                          @if (allowed.export(b)) {
                            <button mat-stroked-button (click)="exportSelfcare(b)">
                              <mat-icon>data_object</mat-icon>SelfCare export
                            </button>
                          }
                          @if (allowed.cancel(b)) {
                            <button
                              mat-button
                              class="danger"
                              (click)="cancel(b)"
                              [disabled]="busy()"
                            >
                              <mat-icon>cancel</mat-icon>Cancel booking
                            </button>
                          }
                        </div>
                      }
                    } @else if (s.booking) {
                      <p>
                        {{ stallStateLabels[s.state] }} for {{ s.booking.exhibitor }}. The booking
                        details have not loaded yet.
                      </p>
                      <button mat-stroked-button (click)="refresh()">
                        <mat-icon>refresh</mat-icon>Reload
                      </button>
                    } @else if (canManage()) {
                      @if (bookReason(); as reason) {
                        <p class="muted">{{ reason }}</p>
                      } @else {
                        <p class="muted">
                          This stall is free. Book it for an exhibitor registered for the event.
                        </p>
                        <button mat-flat-button (click)="book(s)" [disabled]="busy()">
                          <mat-icon>add</mat-icon>Book this stall
                        </button>
                      }
                    } @else {
                      <p class="muted">
                        This stall is free. Booking stalls needs the Manage bookings permission.
                      </p>
                    }
                  } @else {
                    <p class="muted hint">
                      <mat-icon>touch_app</mat-icon>
                      Pick a stall on the map to see its booking{{
                        canManage() ? ', or to book it' : ''
                      }}.
                    </p>
                  }
                </aside>
              </div>
            </mat-tab-nav-panel>
          </section>
        }

        @if (unpublishedHalls().length) {
          <p class="muted small unpublished">
            Not published yet:
            @for (h of unpublishedHalls(); track h.hallId; let last = $last) {
              {{ h.name }} ({{ h.state }}){{ last ? '.' : ',' }}
            }
          </p>
        }

        <section>
          <div class="row list-bar">
            <h2 class="section-title grow">Bookings ({{ bookings().length }})</h2>
            <mat-form-field class="inline-field filter">
              <mat-label>Status</mat-label>
              <mat-select
                [value]="statusFilter()"
                (selectionChange)="statusFilter.set($event.value)"
              >
                <mat-option value="">All statuses</mat-option>
                @for (s of statuses; track s) {
                  <mat-option [value]="s">{{ statusLabels[s] }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field class="inline-field filter">
              <mat-label>Hall</mat-label>
              <mat-select [value]="hallFilter()" (selectionChange)="hallFilter.set($event.value)">
                <mat-option value="">All halls</mat-option>
                @for (h of e.halls; track h.hallId) {
                  <mat-option [value]="h.hallId">{{ h.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          @if (!bookings().length) {
            <div class="panel">
              <app-empty-state
                icon="event_seat"
                heading="No bookings yet"
                [text]="
                  canManage() && !closedReason()
                    ? 'Pick a free stall on the map and book it for a registered exhibitor. Exhibitors can also hold stalls through the portal.'
                    : 'Bookings of this event appear here once stalls are held or booked.'
                "
              />
            </div>
          } @else if (!shownBookings().length) {
            <div class="panel empty-state">
              No booking matches these filters.
              <button mat-button (click)="clearFilters()">Show all</button>
            </div>
          } @else {
            <div class="table-wrap panel panel-flush">
              <table mat-table [dataSource]="shownBookings()" aria-label="Bookings of the event">
                <ng-container matColumnDef="stall">
                  <th mat-header-cell *matHeaderCellDef>Stall</th>
                  <td mat-cell *matCellDef="let b">
                    @if (isShown(b)) {
                      <button
                        mat-button
                        class="inline"
                        (click)="show(b)"
                        [attr.aria-label]="'Show stall ' + b.stall.number + ' on the map'"
                      >
                        {{ b.stall.number }}
                      </button>
                    } @else {
                      <b>{{ b.stall.number }}</b>
                    }
                    <br /><span class="muted small">{{ b.stall.area | number: '1.0-2' }} m²</span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="hall">
                  <th mat-header-cell *matHeaderCellDef>Hall</th>
                  <td mat-cell *matCellDef="let b">{{ b.hall.name }}</td>
                </ng-container>
                <ng-container matColumnDef="exhibitor">
                  <th mat-header-cell *matHeaderCellDef>Exhibitor</th>
                  <td mat-cell *matCellDef="let b">
                    {{ b.exhibitor.name }}
                    @if (b.note) {
                      <br /><span class="muted small">{{ b.note }}</span>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="channel">
                  <th mat-header-cell *matHeaderCellDef>Channel</th>
                  <td mat-cell *matCellDef="let b">{{ channelLabel(b) }}</td>
                </ng-container>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Status</th>
                  <td mat-cell *matCellDef="let b">
                    <span
                      class="status-chip"
                      [class.is-positive]="b.status === 'confirmed'"
                      [class.is-neutral]="b.status === 'cancelled' || b.status === 'expired'"
                      >{{ statusLabel(b) }}</span
                    >
                    @if (b.cancelReason) {
                      <br /><span class="muted small">{{ b.cancelReason }}</span>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="payment">
                  <th mat-header-cell *matHeaderCellDef>Payment</th>
                  <td mat-cell *matCellDef="let b" class="muted">{{ payment(b) }}</td>
                </ng-container>
                <ng-container matColumnDef="created">
                  <th mat-header-cell *matHeaderCellDef>Created</th>
                  <td mat-cell *matCellDef="let b">{{ b.createdAt | date: 'd MMM y, HH:mm' }}</td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef>
                    <span class="cdk-visually-hidden">Actions</span>
                  </th>
                  <td mat-cell *matCellDef="let b" class="actions-cell">
                    @if (hasActions(b)) {
                      <button
                        mat-icon-button
                        [matMenuTriggerFor]="bookingMenu"
                        [attr.aria-label]="'Actions for stall ' + b.stall.number"
                        [disabled]="busy()"
                      >
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #bookingMenu="matMenu" xPosition="before">
                        @if (allowed.confirm(b)) {
                          <button mat-menu-item (click)="confirmBooking(b)">
                            <mat-icon>check</mat-icon><span>Confirm</span>
                          </button>
                        }
                        @if (allowed.move(b)) {
                          <button mat-menu-item (click)="move(b)">
                            <mat-icon>swap_horiz</mat-icon><span>Move</span>
                          </button>
                        }
                        @if (allowed.export(b)) {
                          <button mat-menu-item (click)="exportSelfcare(b)">
                            <mat-icon>data_object</mat-icon><span>SelfCare export</span>
                          </button>
                        }
                        @if (allowed.cancel(b)) {
                          <button mat-menu-item (click)="cancel(b)">
                            <mat-icon>cancel</mat-icon><span>Cancel booking</span>
                          </button>
                        }
                      </mat-menu>
                    }
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns()"></tr>
                <tr mat-row *matRowDef="let row; columns: columns()"></tr>
              </table>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .meta {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
    }
    .notice {
      display: flex;
      gap: 12px;
      align-items: center;
      margin: 0;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
    }
    .notice mat-icon {
      flex: none;
    }
    .notice span {
      max-width: 72ch;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 20px;
      padding: 20px;
      align-items: start;
    }
    .bar {
      margin-bottom: 8px;
      min-height: 24px;
    }
    /* The selected stall, as a card of the shared language beside the map. */
    .side {
      display: grid;
      gap: 10px;
      align-content: start;
      padding: 20px;
      border-radius: 20px;
      border: 1px solid var(--card-border);
      background: var(--card-surface);
      box-shadow: var(--card-highlight);
    }
    .side p {
      margin: 0;
    }
    .side .actions {
      margin-top: 4px;
    }
    .hint {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .facts {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 4px 12px;
      margin: 4px 0 8px;
    }
    .facts dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .facts dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-family: var(--app-display-font);
      font-weight: 500;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .inline {
      min-width: 0;
      padding: 0 4px;
      height: auto;
      font-weight: 600;
    }
    .unpublished {
      margin: -8px 0 0;
      max-width: 72ch;
    }
    .list-bar {
      margin-bottom: 12px;
    }
    .filter {
      width: 180px;
      --mat-form-field-container-height: 40px;
      --mat-form-field-container-vertical-padding: 8px;
    }
    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }
    .skeleton-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 16px;
    }
    .skeleton-layout .tall {
      height: 420px;
    }
    .skeleton-layout .wide {
      grid-column: 1 / -1;
      height: 160px;
    }
    /* Static placeholders: the progress bar above shows that loading is under way. */
    .skeleton {
      background: var(--mat-sys-surface-container);
      border-color: transparent;
    }
    .side-skeleton {
      height: 200px;
    }
    .map-skeleton {
      height: 360px;
      border-radius: 12px;
    }
    @media (max-width: 1000px) {
      .layout,
      .skeleton-layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class EventBookingsPageComponent implements OnInit {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(BookingsApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly statuses = BOOKING_STATUSES;
  protected readonly statusLabels = BOOKING_STATUS_LABELS;
  protected readonly stallStateLabels = STALL_STATE_LABELS;
  protected readonly eventStatusLabels = EVENT_STATUS_LABELS;
  protected readonly allowed = {
    confirm: canConfirm,
    move: canMove,
    cancel: canCancel,
    export: canExportToSelfcare,
  };

  protected readonly slug = this.context.slug;
  protected readonly canManage = computed(() => this.context.can('bookings.manage'));

  protected readonly event = signal<BookingEventView | null>(null);
  /** Null when the member may not see plans (no `layouts.view`): every hall is then tried. */
  protected readonly plans = signal<EventPlanSummaryView[] | null>(null);
  protected readonly bookings = signal<BookingView[]>([]);
  private readonly exhibitors = signal<ExhibitorOption[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly hallId = signal<string | null>(null);
  protected readonly map = signal<StallMapView | null>(null);
  protected readonly mapLoading = signal(false);
  protected readonly mapError = signal<string | null>(null);
  protected readonly selectedStallId = signal<string | null>(null);
  private mapToken = 0;

  protected readonly statusFilter = signal<BookingStatus | ''>('');
  protected readonly hallFilter = signal('');

  protected readonly publishedHalls = computed(() => {
    const halls = this.event()?.halls ?? [];
    const plans = this.plans();
    if (!plans) return halls;
    const published = new Set(plans.filter((p) => p.status === 'published').map((p) => p.hallId));
    return halls.filter((h) => published.has(h.hallId));
  });
  protected readonly unpublishedHalls = computed(() => {
    const plans = this.plans();
    if (!plans) return [];
    const byHall = new Map(plans.map((p) => [p.hallId, p]));
    return (this.event()?.halls ?? [])
      .map((h) => ({ ...h, status: byHall.get(h.hallId)?.status ?? null }))
      .filter((h) => h.status !== 'published')
      .map((h) => ({ ...h, state: h.status ? PLAN_STATUS_LABELS[h.status] : 'no plan yet' }));
  });
  protected readonly closedReason = computed(() => {
    const e = this.event();
    return e ? bookingClosedReason(e) : null;
  });
  /** Why a free stall cannot be booked now; null while it can. */
  protected readonly bookReason = computed(
    () =>
      this.closedReason() ??
      (this.map()?.bookable === false ? 'Stalls of this hall cannot be booked now.' : null),
  );
  protected readonly selectedStall = computed(
    () => this.map()?.stalls.find((s) => s.id === this.selectedStallId()) ?? null,
  );
  protected readonly selectedBooking = computed(() => {
    const id = this.selectedStall()?.booking?.id;
    return id ? (this.bookings().find((b) => b.id === id) ?? null) : null;
  });
  protected readonly counts = computed(() => {
    const counts = { free: 0, held: 0, booked: 0 };
    for (const s of this.map()?.stalls ?? []) counts[s.state]++;
    return counts;
  });
  protected readonly shownBookings = computed(() => {
    const status = this.statusFilter();
    const hall = this.hallFilter();
    return this.bookings().filter(
      (b) => (!status || b.status === status) && (!hall || b.hall.id === hall),
    );
  });
  protected readonly columns = computed(() => {
    const columns = ['stall', 'hall', 'exhibitor', 'channel', 'status', 'payment', 'created'];
    return this.canManage() ? [...columns, 'actions'] : columns;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    const slug = this.slug();
    const eventId = this.eventId();
    try {
      const [event, plans, bookings, exhibitors] = await Promise.all([
        firstValueFrom(this.api.event(slug, eventId)),
        firstValueFrom(this.api.plans(slug, eventId)).catch((error: unknown) => {
          if (httpStatus(error) === 403) return null;
          throw error;
        }),
        firstValueFrom(this.api.bookings(slug, { eventId })),
        this.canManage()
          ? firstValueFrom(this.api.exhibitors(slug, eventId)).catch(
              // The error interceptor has shown it; booking then says no exhibitor is listed.
              () => [] as ExhibitorOption[],
            )
          : Promise.resolve([] as ExhibitorOption[]),
      ]);
      this.event.set(event);
      this.plans.set(plans);
      this.bookings.set(bookings);
      this.exhibitors.set(exhibitors.filter((x) => x.eventIds.includes(eventId)));
      const halls = this.publishedHalls();
      const current = this.hallId();
      if (halls.length && !halls.some((h) => h.hallId === current)) {
        this.selectHall(halls[0].hallId);
      }
    } catch (error) {
      this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected selectHall(hallId: string): void {
    if (hallId === this.hallId() && this.map()) return;
    this.hallId.set(hallId);
    this.selectedStallId.set(null);
    this.map.set(null);
    void this.loadMap();
  }

  /** The current hall's stall map. The latest answer wins when halls are switched quickly. */
  protected async loadMap(): Promise<void> {
    const hallId = this.hallId();
    if (!hallId) return;
    const token = ++this.mapToken;
    this.mapLoading.set(true);
    this.mapError.set(null);
    try {
      const map = await firstValueFrom(this.api.stallMap(this.slug(), this.eventId(), hallId));
      if (token === this.mapToken) this.map.set(map);
    } catch (error) {
      if (token === this.mapToken) {
        this.map.set(null);
        this.mapError.set(errorMessage(error, 'The stall map could not be loaded.'));
      }
    } finally {
      if (token === this.mapToken) this.mapLoading.set(false);
    }
  }

  /** After a change: the bookings and the map as they are now. */
  protected async refresh(): Promise<void> {
    await Promise.all([this.reloadBookings(), this.loadMap()]);
  }

  private async reloadBookings(): Promise<void> {
    try {
      this.bookings.set(
        await firstValueFrom(this.api.bookings(this.slug(), { eventId: this.eventId() })),
      );
    } catch (error) {
      this.notifier.error(error, 'The bookings could not be reloaded.');
    }
  }

  protected payment(b: BookingView): string {
    return paymentLabel(b.paymentStatus);
  }

  protected statusLabel(b: BookingView): string {
    return BOOKING_STATUS_LABELS[b.status];
  }

  protected channelLabel(b: BookingView): string {
    return CHANNEL_LABELS[b.channel];
  }

  protected hasActions(b: BookingView): boolean {
    return (
      this.canManage() && (canConfirm(b) || canMove(b) || canCancel(b) || canExportToSelfcare(b))
    );
  }

  /** Whether the booking's stall is on a hall whose map can be shown. */
  protected isShown(b: BookingView): boolean {
    return this.publishedHalls().some((h) => h.hallId === b.hall.id);
  }

  protected show(b: BookingView): void {
    this.selectHall(b.hall.id);
    this.selectedStallId.set(b.stall.id);
  }

  protected clearFilters(): void {
    this.statusFilter.set('');
    this.hallFilter.set('');
  }

  protected book(stall: MapStallView): void {
    const event = this.event();
    const map = this.map();
    if (!event || !map) return;
    const data: NewBookingDialogData = {
      slug: this.slug(),
      eventId: event.id,
      eventName: event.name,
      hallName: map.hall.name,
      stall,
      exhibitors: this.exhibitors(),
    };
    this.dialog
      .open(NewBookingDialogComponent, { data })
      .afterClosed()
      .subscribe((booking?: BookingView | null) => {
        if (booking) {
          this.notifier.success(
            `Stall ${booking.stall.number} ${booking.status === 'confirmed' ? 'booked' : 'held'} for ${booking.exhibitor.name}.`,
          );
        }
        // Null: the stall was taken meanwhile; show it as it is now.
        if (booking !== undefined) void this.refresh();
      });
  }

  protected async confirmBooking(b: BookingView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Confirm stall ${b.stall.number}?`,
      message:
        b.paymentStatus === 'pending'
          ? `${b.exhibitor.name} keeps the stall. The venue's system has not reported a payment for this hold; confirming records no payment.`
          : `${b.exhibitor.name} keeps the stall. No payment is taken or recorded here.`,
      confirmLabel: 'Confirm booking',
    });
    if (!confirmed) return;
    await this.run(this.api.confirm(this.slug(), b.id), (done) => {
      this.notifier.success(`Stall ${done.stall.number} confirmed for ${done.exhibitor.name}.`);
    });
  }

  protected async cancel(b: BookingView): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Cancel the booking of stall ${b.stall.number}?`,
      message: `${b.exhibitor.name} loses the stall, and it is free to book again. This cannot be undone.`,
      confirmLabel: 'Cancel booking',
      destructive: true,
      reasonLabel: 'Reason (kept with the booking)',
    });
    if (reason === null) return;
    await this.run(this.api.cancel(this.slug(), b.id, reason), (done) => {
      this.notifier.success(`The booking of stall ${done.stall.number} is cancelled.`);
    });
  }

  protected move(b: BookingView): void {
    const data: MoveBookingDialogData = {
      slug: this.slug(),
      booking: b,
      halls: this.publishedHalls(),
    };
    this.dialog
      .open(MoveBookingDialogComponent, { data })
      .afterClosed()
      .subscribe((moved?: BookingView) => {
        if (!moved) return;
        this.notifier.success(
          `${moved.exhibitor.name} moved to stall ${moved.stall.number} (${moved.hall.name}).`,
        );
        if (moved.hall.id === this.hallId()) this.selectedStallId.set(moved.stall.id);
        void this.refresh();
      });
  }

  protected exportSelfcare(b: BookingView): void {
    const data: SelfcareExportDialogData = { slug: this.slug(), booking: b };
    this.dialog.open(SelfcareExportDialogComponent, { data, maxWidth: '760px', width: '95vw' });
  }

  /** One change to a booking; afterwards the page shows things as they are now. */
  private async run(
    call: Observable<BookingView>,
    done: (booking: BookingView) => void,
  ): Promise<void> {
    this.busy.set(true);
    try {
      done(await firstValueFrom(call));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
    await this.refresh();
  }
}
