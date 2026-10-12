import { DatePipe, DecimalPipe } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { firstValueFrom, Observable } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import {
  BOOKING_STATUS_LABELS,
  canCancel,
  canConfirm,
  canMove,
  canRefund,
  paise,
  paymentLabel,
  STALL_STATE_LABELS,
} from '../../../core/bookings/booking-rules';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type {
  BookingView,
  MapStallView,
  StallMapView,
} from '../../../core/bookings/bookings.models';
import { EventsApi } from '../../../core/events/events-api.service';
import type { EventDetailView, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { MoveBookingDialogComponent, MoveBookingDialogData } from './move-booking-dialog.component';
import { NewBookingDialogComponent, NewBookingDialogData } from './new-booking-dialog.component';
import { RefundDialogComponent, RefundDialogData } from './refund-dialog.component';
import { StallMapComponent } from './stall-map.component';

/**
 * An event's bookings, as staff work them (ported from `@feature/rules`): each hall's published
 * stalls with which are free, and every booking of the event. Members who manage bookings hold
 * or book a free stall for a registered exhibitor, and confirm, move or cancel bookings. The map
 * reads the published plan only, so a later save of the plan shows here once it is published.
 */
@Component({
  selector: 'app-event-bookings-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    SelectButtonModule,
    TableModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    StallMapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a pButton [text]="true" class="back" [routerLink]="['/', slug(), 'events', eventId()]"
        ><app-icon name="arrow_back" />{{ event()?.name ?? 'Event' }}</a
      >
      <app-page-header heading="Bookings" [subheading]="event()?.name ?? ''" />

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="The bookings could not be loaded" [text]="message">
            <button pButton (click)="load(eventId())">
              <app-icon name="restart_alt" />Try again
            </button>
          </app-empty-state>
        </div>
      } @else if (event(); as e) {
        <section class="panel">
          @if (!e.halls.length) {
            <app-empty-state
              icon="meeting_room"
              heading="This event has no hall yet"
              text="Stalls are booked on the published plan of a hall the event uses."
            />
          } @else {
            @if (e.halls.length > 1) {
              <p-selectbutton
                [options]="e.halls"
                optionLabel="name"
                optionValue="hallId"
                [allowEmpty]="false"
                ariaLabel="Hall"
                [ngModel]="hallId()"
                (ngModelChange)="selectHall($event)"
              />
            }
            @if (map(); as m) {
              @if (m.closedReason) {
                <p class="notice" role="status"><app-icon name="info" />{{ m.closedReason }}</p>
              }
              @if (m.stalls.length) {
                <p class="muted small">
                  {{ counts().free }} free · {{ counts().held }} held · {{ counts().booked }} booked
                </p>
                <div class="layout">
                  <app-stall-map
                    [floor]="m.floor"
                    [stalls]="m.stalls"
                    [selectedId]="selectedId()"
                    [label]="'Stalls of ' + m.hall.name"
                    (picked)="selectedId.set($event.id)"
                  />
                  <aside class="side" aria-label="Selected stall">
                    @if (selected(); as s) {
                      <h2 class="section-title">Stall {{ s.label }}</h2>
                      <p class="muted small">
                        {{ s.width * s.depth | number: '1.0-2' }} m² · {{ s.openSides.length }} open
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
                          {{ stateLabels[s.state] }} · <b>{{ b.exhibitor }}</b>
                        </p>
                        <p class="muted small">Confirm, move or cancel it in the list below.</p>
                      } @else if (s.state === 'free' && canManage() && m.bookable) {
                        <button pButton (click)="book(m, s)" [disabled]="busy()">
                          <app-icon name="add" />Book this stall
                        </button>
                      } @else {
                        <p class="muted">{{ stateLabels[s.state] }}</p>
                      }
                    } @else {
                      <p class="muted">
                        Pick a stall on the map to see it{{ canManage() ? ', or to book it' : '' }}.
                      </p>
                    }
                  </aside>
                </div>
              } @else if (m.published) {
                <app-empty-state
                  icon="grid_on"
                  heading="The published plan of this hall has no stalls"
                  text="Publish this hall's plan again to sell its stalls."
                />
              }
            } @else if (mapError(); as message) {
              <app-empty-state
                icon="error"
                heading="The stall map could not be loaded"
                [text]="message"
              >
                <button pButton [outlined]="true" (click)="loadMap()">Try again</button>
              </app-empty-state>
            } @else {
              <p-progressbar mode="indeterminate" />
            }
          }
        </section>

        <section class="panel">
          <h2 class="section-title">Bookings ({{ bookings().length }})</h2>
          @if (!bookings().length) {
            <app-empty-state
              icon="event_seat"
              heading="No bookings yet"
              [text]="
                canManage()
                  ? 'Pick a free stall on the map and book it for a registered exhibitor.'
                  : 'Bookings of this event appear here.'
              "
            />
          } @else {
            <div class="table-wrap">
              <p-table [value]="bookings()" [paginator]="bookings().length > 25" [rows]="25">
                <ng-template #header>
                  <tr>
                    <th>Stall</th>
                    <th>Hall</th>
                    <th>Exhibitor</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Made</th>
                    <th><span class="visually-hidden">Actions</span></th>
                  </tr>
                </ng-template>
                <ng-template #body let-b>
                  <tr>
                    <td>
                      <b>{{ b.stall.label }}</b>
                    </td>
                    <td>{{ b.hall.name }}</td>
                    <td>
                      {{ b.exhibitor.name }}
                      @if (b.note) {
                        <br /><span class="muted small">{{ b.note }}</span>
                      }
                    </td>
                    <td>
                      {{ statusLabels[b.status] }}
                      @if (b.status === 'held' && b.holdExpiresAt) {
                        <br /><span class="muted small"
                          >until {{ b.holdExpiresAt | date: 'd MMM, HH:mm' }}</span
                        >
                      }
                      @if (b.cancelReason) {
                        <br /><span class="muted small">{{ b.cancelReason }}</span>
                      }
                    </td>
                    <td class="nums">{{ money(b.amountPaise) }}</td>
                    <td>{{ paymentText(b) }}</td>
                    <td class="muted">{{ b.createdAt | date: 'd MMM y' }}</td>
                    <td class="actions">
                      @if (canRefundAny() && allowed.refund(b)) {
                        <button
                          pButton
                          [text]="true"
                          severity="danger"
                          (click)="refund(b)"
                          [disabled]="busy()"
                        >
                          Refund
                        </button>
                      }
                      @if (canManage()) {
                        @if (allowed.confirm(b)) {
                          <button
                            pButton
                            [text]="true"
                            (click)="confirmBooking(b)"
                            [disabled]="busy()"
                          >
                            Confirm
                          </button>
                        }
                        @if (allowed.move(b)) {
                          <button pButton [text]="true" (click)="move(b)" [disabled]="busy()">
                            Move
                          </button>
                        }
                        @if (allowed.cancel(b)) {
                          <button
                            pButton
                            [text]="true"
                            severity="danger"
                            (click)="cancel(b)"
                            [disabled]="busy()"
                          >
                            Cancel
                          </button>
                        }
                      }
                    </td>
                  </tr>
                </ng-template>
              </p-table>
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
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 24px;
      align-items: start;
    }
    .side {
      display: grid;
      gap: 8px;
    }
    .side p {
      margin: 0;
    }
    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
    .small {
      font: var(--app-body-small);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .actions {
      text-align: right;
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class EventBookingsPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(BookingsApi);
  private readonly eventsApi = inject(EventsApi);
  private readonly exhibitorsApi = inject(ExhibitorsApi);
  private readonly dialog = inject(AppDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly canManage = computed(() => this.context.can('bookings.manage'));
  /** Refunds are their own permission, apart from managing bookings. */
  protected readonly canRefundAny = computed(() => this.context.can('payments.manage'));
  protected readonly money = paise;
  protected readonly paymentText = paymentLabel;
  protected readonly stateLabels = STALL_STATE_LABELS;
  /** Indexed by the table row's status, which the template types as any. */
  protected readonly statusLabels: Record<string, string> = BOOKING_STATUS_LABELS;
  protected readonly allowed = {
    confirm: canConfirm,
    move: canMove,
    cancel: canCancel,
    refund: canRefund,
  };

  protected readonly event = signal<EventDetailView | null>(null);
  protected readonly bookings = signal<BookingView[]>([]);
  private readonly exhibitors = signal<ExhibitorView[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly hallId = signal<string | null>(null);
  protected readonly map = signal<StallMapView | null>(null);
  protected readonly mapError = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  /** The latest stall-map request; an older answer arriving late is dropped. */
  private mapToken = 0;

  protected readonly selected = computed(
    () => this.map()?.stalls.find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly counts = computed(() => {
    const counts = { free: 0, held: 0, booked: 0, not_for_sale: 0 };
    for (const s of this.map()?.stalls ?? []) counts[s.state]++;
    return counts;
  });

  constructor() {
    // Only the route input restarts the load: the requests themselves read the session signal.
    effect(() => {
      const id = this.eventId();
      untracked(() => void this.load(id));
    });
  }

  protected async load(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [event, bookings, exhibitors] = await Promise.all([
        firstValueFrom(this.eventsApi.event(this.slug(), id)),
        firstValueFrom(this.api.bookings(this.slug(), { eventId: id })),
        this.canManage()
          ? firstValueFrom(this.exhibitorsApi.list(this.slug(), id))
          : Promise.resolve([] as ExhibitorView[]),
      ]);
      this.event.set(event);
      this.bookings.set(bookings);
      this.exhibitors.set(exhibitors);
      const first = event.halls[0]?.hallId;
      if (first && !event.halls.some((h) => h.hallId === this.hallId())) this.selectHall(first);
    } catch (error) {
      this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected selectHall(hallId: string): void {
    this.hallId.set(hallId);
    this.selectedId.set(null);
    this.map.set(null);
    void this.loadMap();
  }

  protected async loadMap(): Promise<void> {
    const hallId = this.hallId();
    if (!hallId) return;
    const token = ++this.mapToken;
    this.mapError.set(null);
    try {
      const map = await firstValueFrom(this.api.stallMap(this.slug(), this.eventId(), hallId));
      if (token === this.mapToken) this.map.set(map);
    } catch (error) {
      if (token === this.mapToken) {
        this.map.set(null);
        this.mapError.set(errorMessage(error, 'The stall map could not be loaded.'));
      }
    }
  }

  /** After a change: the bookings and the map as they are now. */
  private async refresh(): Promise<void> {
    try {
      this.bookings.set(
        await firstValueFrom(this.api.bookings(this.slug(), { eventId: this.eventId() })),
      );
    } catch (error) {
      this.notifier.error(error, 'The bookings could not be reloaded.');
    }
    await this.loadMap();
  }

  protected book(map: StallMapView, stall: MapStallView): void {
    const event = this.event();
    if (!event) return;
    const data: NewBookingDialogData = {
      slug: this.slug(),
      eventId: event.id,
      eventName: event.name,
      hallId: map.hall.id,
      hallName: map.hall.name,
      stall,
      exhibitors: this.exhibitors(),
    };
    this.dialog
      .open<BookingView | null>(NewBookingDialogComponent, { data })
      .subscribe((booking) => {
        if (booking) {
          this.notifier.success(
            `Stall ${booking.stall.label} ${booking.status === 'confirmed' ? 'booked' : 'held'} for ${booking.exhibitor.name}.`,
          );
        }
        // Null: the stall was taken meanwhile; show it as it is now.
        if (booking !== undefined) void this.refresh();
      });
  }

  protected async confirmBooking(b: BookingView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Confirm stall ${b.stall.label} for ${b.exhibitor.name}?`,
      message: `${b.exhibitor.name} keeps the stall at ${paise(b.amountPaise)} excl. GST. No payment is taken or recorded here yet.`,
      confirmLabel: 'Confirm booking',
    });
    if (!ok) return;
    await this.run(this.api.confirm(this.slug(), b.id), (done) =>
      this.notifier.success(`Stall ${done.stall.label} confirmed for ${done.exhibitor.name}.`),
    );
  }

  protected async cancel(b: BookingView): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Cancel the booking of stall ${b.stall.label}?`,
      message: `${b.exhibitor.name} loses the stall, and it is free to book again. This cannot be undone.${
        b.payment?.status === 'paid' || b.payment?.status === 'partially_refunded'
          ? ' Cancelling does not refund; use Refund for that.'
          : ''
      }`,
      reasonLabel: 'Reason (kept with the booking)',
      confirmLabel: 'Cancel booking',
      // "Cancel" next to "Cancel booking" reads as the same thing.
      cancelLabel: 'Keep booking',
      destructive: true,
    });
    if (reason === null) return;
    await this.run(this.api.cancel(this.slug(), b.id, reason), (done) =>
      this.notifier.success(`The booking of stall ${done.stall.label} is cancelled.`),
    );
  }

  protected move(b: BookingView): void {
    const data: MoveBookingDialogData = {
      slug: this.slug(),
      booking: b,
      halls: this.event()?.halls ?? [],
    };
    this.dialog.open<BookingView>(MoveBookingDialogComponent, { data }).subscribe((moved) => {
      if (!moved) return;
      this.notifier.success(`${moved.exhibitor.name} moved to stall ${moved.stall.label}.`);
      void this.refresh();
    });
  }

  protected refund(b: BookingView): void {
    const data: RefundDialogData = { slug: this.slug(), booking: b };
    this.dialog.open<BookingView>(RefundDialogComponent, { data }).subscribe((done) => {
      if (!done) return;
      this.notifier.success(`Refund for stall ${done.stall.label} is on its way to the exhibitor.`);
      void this.refresh();
    });
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
