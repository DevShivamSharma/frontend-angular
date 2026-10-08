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
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import {
  BOOKING_STATUS_LABELS,
  canCancelOwn,
  paymentLabel,
} from '../../../core/bookings/booking-rules';
import type {
  BookingView,
  MapStallView,
  PortalView,
  StallMapView,
} from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { StallMapComponent } from '../bookings/stall-map.component';

/**
 * One hall of an event, for an exhibitor: which stalls are free, which are its own, and holding a
 * free one. Other exhibitors' stalls show only as taken. A hold is confirmed by the organiser, or
 * by the venue's own system once it reports the payment (`hybrid_hold`).
 */
@Component({
  selector: 'app-portal-hall-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
    StallMapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a mat-button class="back" [routerLink]="['/', slug(), 'portal']">
        <mat-icon>arrow_back</mat-icon>My events
      </a>
      @if (map(); as m) {
        <app-page-header [heading]="m.hall.name" [subheading]="m.event.name" />
      } @else {
        <app-page-header heading="Choose a stall" />
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
        <div class="layout" aria-busy="true" aria-label="Loading the stall map">
          <div class="panel skeleton tall"></div>
          <div class="panel skeleton"></div>
        </div>
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="This hall could not be loaded" [text]="message">
            <button mat-flat-button (click)="load()"><mat-icon>refresh</mat-icon>Try again</button>
          </app-empty-state>
        </div>
      } @else if (map(); as m) {
        @if (closedReason(); as reason) {
          <p class="notice" role="status">
            <mat-icon>lock</mat-icon><span>{{ reason }}</span>
          </p>
        }

        <div class="layout">
          <section class="panel stage" aria-label="Stall map">
            <div class="row bar">
              <span class="muted small"
                >{{ freeCount() }} of {{ m.stalls.length }} stalls free</span
              >
              <span class="spacer"></span>
              @if (refreshing()) {
                <span class="muted small">Updating…</span>
              }
            </div>
            @if (m.stalls.length) {
              <app-stall-map
                [floor]="m.floor"
                [stalls]="m.stalls"
                [selectedId]="selectedId()"
                viewer="exhibitor"
                [label]="'Stalls of ' + m.hall.name"
                (picked)="pick($event)"
              />
            } @else {
              <app-empty-state
                icon="grid_off"
                heading="This hall has no stalls"
                text="The organiser has published no stall in this hall."
              />
            }
          </section>

          <aside class="panel side" aria-label="Selected stall">
            @if (held(); as b) {
              <div class="done" role="status">
                <mat-icon>check_circle</mat-icon>
                <div>
                  <h2 class="section-title">Stall {{ b.stall.number }} is held for you</h2>
                  <p>{{ confirmText() }}</p>
                </div>
              </div>
            }
            @if (selected(); as s) {
              <h2 class="section-title">Stall {{ s.number }}</h2>
              <p class="muted small">
                {{ s.area | number: '1.0-2' }} m², {{ s.width | number: '1.0-2' }} ×
                {{ s.depth | number: '1.0-2' }} m, {{ s.openSides.length }}
                {{ s.openSides.length === 1 ? 'side' : 'sides' }} open{{
                  s.stallType ? (s.stallType === 'shell' ? ', shell scheme' : ', bare space') : ''
                }}
              </p>
              @if (s.booking?.own) {
                @if (ownBooking(s); as b) {
                  <dl class="facts">
                    <dt>Status</dt>
                    <dd>{{ statusLabel(b) }}</dd>
                    <dt>Payment</dt>
                    <dd>{{ payment(b) }}</dd>
                    @if (b.note) {
                      <dt>Note</dt>
                      <dd>{{ b.note }}</dd>
                    }
                    <dt>Held on</dt>
                    <dd>{{ b.createdAt | date: 'd MMM y, HH:mm' }}</dd>
                  </dl>
                  @if (b.status === 'held') {
                    @if (!held()) {
                      <p class="muted small">{{ confirmText() }}</p>
                    }
                    @if (!portal()?.closedReason && canCancel(b)) {
                      <button mat-button class="danger" (click)="cancel(b)" [disabled]="busy()">
                        <mat-icon>cancel</mat-icon>Cancel my hold
                      </button>
                    }
                  } @else if (b.status === 'confirmed') {
                    <p class="muted small">
                      This booking is confirmed. Only the organiser can change or cancel it, so
                      contact them if you need to.
                    </p>
                  }
                } @else {
                  <p>This stall is yours.</p>
                }
              } @else if (s.state !== 'free') {
                <p>Taken by another exhibitor.</p>
              } @else if (m.bookable) {
                <p class="muted small">
                  This stall is free. A hold keeps it for you until it is confirmed, and you can
                  cancel your hold yourself.
                </p>
                <mat-form-field>
                  <mat-label>Note for the organiser</mat-label>
                  <textarea
                    matInput
                    rows="2"
                    maxlength="500"
                    [ngModel]="note()"
                    (ngModelChange)="note.set($event)"
                  ></textarea>
                  <mat-hint>Optional</mat-hint>
                </mat-form-field>
                <button mat-flat-button (click)="hold(s)" [disabled]="busy()">
                  <mat-icon>bookmark_add</mat-icon>Hold this stall
                </button>
              } @else {
                <p class="muted">Free, but stalls cannot be held here right now.</p>
              }
            } @else if (!held()) {
              <p class="muted hint">
                <mat-icon>touch_app</mat-icon>
                {{
                  m.bookable
                    ? 'Pick a free stall on the map to hold it.'
                    : 'Pick a stall on the map to see it.'
                }}
              </p>
            }
          </aside>
        </div>
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .notice {
      display: flex;
      gap: 12px;
      align-items: center;
      margin: 0;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
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
      gap: 16px;
      align-items: start;
    }
    .bar {
      margin-bottom: 8px;
    }
    .side {
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .side p {
      margin: 0;
    }
    .section-title {
      margin: 0;
    }
    .hint {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    /* The held confirmation, in a lit tile of the organisation's colour. */
    .done {
      display: flex;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 16px;
      background: var(--card-icon-fill);
      color: var(--mat-sys-on-primary-container);
      box-shadow: var(--card-highlight);
    }
    .done mat-icon {
      flex: none;
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
    }
    /* Static placeholders: the progress bar above shows that loading is under way. */
    .skeleton {
      height: 200px;
      background: var(--mat-sys-surface-container);
      border-color: transparent;
    }
    .skeleton.tall {
      height: 420px;
    }
    @media (max-width: 1000px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class PortalHallPageComponent implements OnInit {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;

  protected readonly map = signal<StallMapView | null>(null);
  protected readonly portal = signal<PortalView | null>(null);
  protected readonly bookings = signal<BookingView[]>([]);
  protected readonly loading = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly note = signal('');
  /** The hold just made, until another stall is picked. */
  protected readonly held = signal<BookingView | null>(null);

  protected readonly selected = computed(
    () => this.map()?.stalls.find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly freeCount = computed(
    () => this.map()?.stalls.filter((s) => s.state === 'free').length ?? 0,
  );
  /** Why stalls cannot be held here now; null while they can. */
  protected readonly closedReason = computed(() => {
    const map = this.map();
    if (!map || map.bookable) return null;
    const closed = this.portal()?.closedReason;
    if (closed) return closed;
    switch (map.event.status) {
      case 'draft':
        return `Stalls of ${map.event.name} can be held once the organiser schedules it.`;
      case 'completed':
        return `${map.event.name} is completed.`;
      case 'cancelled':
        return `${map.event.name} is cancelled.`;
      default:
        return 'Stalls cannot be held in this hall right now.';
    }
  });
  /** Who confirms a hold, as the organisation's booking mode says. */
  protected readonly confirmText = computed(() =>
    this.portal()?.bookingMode === 'hybrid_hold'
      ? "The venue's own booking system takes the payment. Once it reports the payment, the booking is confirmed. This platform takes no payment."
      : 'The organiser confirms the booking. No payment is taken here.',
  );

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      await this.fetch();
    } catch (error) {
      this.loadError.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async fetch(): Promise<void> {
    const slug = this.slug();
    const [map, portal, bookings] = await Promise.all([
      firstValueFrom(this.api.stallMap(slug, this.eventId(), this.hallId())),
      firstValueFrom(this.api.portal(slug)),
      firstValueFrom(this.api.bookings(slug)),
    ]);
    this.map.set(map);
    this.portal.set(portal);
    this.bookings.set(bookings);
  }

  /** After a change: the map, the portal and the bookings as they are now. */
  private async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      await this.fetch();
    } catch (error) {
      this.notifier.error(error, 'The stall map could not be reloaded.');
    } finally {
      this.refreshing.set(false);
    }
  }

  protected pick(stall: MapStallView): void {
    if (stall.id !== this.selectedId()) {
      this.note.set('');
      this.held.set(null);
    }
    this.selectedId.set(stall.id);
  }

  protected ownBooking(stall: MapStallView): BookingView | null {
    const id = stall.booking?.id;
    return id ? (this.bookings().find((b) => b.id === id) ?? null) : null;
  }

  protected payment(b: BookingView): string {
    return paymentLabel(b.paymentStatus);
  }

  protected statusLabel(b: BookingView): string {
    return BOOKING_STATUS_LABELS[b.status];
  }

  protected canCancel(b: BookingView): boolean {
    return canCancelOwn(b);
  }

  protected async hold(stall: MapStallView): Promise<void> {
    this.busy.set(true);
    try {
      const booking = await firstValueFrom(
        this.api.hold(this.slug(), {
          eventId: this.eventId(),
          stallId: stall.id,
          note: this.note().trim() || null,
        }),
      );
      this.held.set(booking);
      this.note.set('');
      this.notifier.success(`Stall ${booking.stall.number} is held for you.`);
    } catch {
      // The error interceptor has shown it, e.g. that the stall was taken meanwhile; the
      // refresh below shows the hall as it is now.
    }
    await this.refresh();
    this.busy.set(false);
  }

  protected async cancel(b: BookingView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Cancel your hold on stall ${b.stall.number}?`,
      message: `Stall ${b.stall.number} becomes free for other exhibitors. This cannot be undone.`,
      confirmLabel: 'Cancel my hold',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.cancel(this.slug(), b.id, null));
      this.held.set(null);
      this.notifier.success(`Your hold on stall ${b.stall.number} is cancelled.`);
    } catch {
      // The error interceptor has shown it.
    }
    await this.refresh();
    this.busy.set(false);
  }
}
