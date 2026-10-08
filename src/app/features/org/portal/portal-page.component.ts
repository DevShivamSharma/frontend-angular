import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import {
  BOOKING_STATUS_LABELS,
  canCancelOwn,
  EVENT_STATUS_LABELS,
  paymentLabel,
} from '../../../core/bookings/booking-rules';
import type { BookingView, PortalView } from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

/**
 * The exhibitor portal's first page: the exhibitor's company, the events it is registered for
 * with their halls, and its own bookings. Stalls are held on a hall's page.
 */
@Component({
  selector: 'app-portal-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (portal(); as p) {
        <app-page-header
          [heading]="p.exhibitor.name"
          subheading="Your events, the halls you can choose stalls in, and your bookings."
        />
      } @else {
        <app-page-header heading="Book a stall" />
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
        <div class="skeleton-list" aria-busy="true" aria-label="Loading your events">
          <div class="panel skeleton"></div>
          <div class="panel skeleton"></div>
        </div>
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="The portal could not be loaded" [text]="message">
            <button mat-flat-button (click)="load()"><mat-icon>refresh</mat-icon>Try again</button>
          </app-empty-state>
        </div>
      } @else if (portal(); as p) {
        @if (p.closedReason) {
          <p class="notice" role="status">
            <mat-icon>lock</mat-icon>
            <span
              >{{ p.closedReason }} You can see your events and bookings here; contact the organiser
              to change a booking.</span
            >
          </p>
        }

        <section>
          <h2 class="section-title">Your events</h2>
          @if (!p.events.length) {
            <div class="panel">
              <app-empty-state
                icon="event"
                heading="You are not registered for an event yet"
                text="Once the organiser registers your company for an event, its halls appear here."
              />
            </div>
          } @else {
            <ul class="events">
              @for (e of p.events; track e.id) {
                <li class="panel">
                  <div class="row">
                    <h3 class="event-name">{{ e.name }}</h3>
                    <span
                      class="status-chip"
                      [class.is-positive]="e.status === 'scheduled'"
                      [class.is-neutral]="e.status !== 'scheduled'"
                      >{{ eventStatusLabels[e.status] }}</span
                    >
                  </div>
                  <p class="muted">
                    {{ e.venue }} · {{ e.startsOn | date: 'd MMM y' }} –
                    {{ e.endsOn | date: 'd MMM y' }}
                  </p>
                  @if (e.status === 'draft') {
                    <p class="muted small">Stalls can be held once the organiser schedules it.</p>
                  }
                  @if (e.halls.length) {
                    <ul class="halls">
                      @for (h of e.halls; track h.hallId) {
                        <li>
                          @if (h.published) {
                            <a
                              class="hall"
                              [routerLink]="[
                                '/',
                                slug(),
                                'portal',
                                'events',
                                e.id,
                                'halls',
                                h.hallId,
                              ]"
                            >
                              <mat-icon aria-hidden="true">grid_on</mat-icon>
                              <span class="hall-name">{{ h.name }}</span>
                              <span class="muted"
                                >{{ h.freeStalls }} free
                                {{ h.freeStalls === 1 ? 'stall' : 'stalls' }}</span
                              >
                              <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
                            </a>
                          } @else {
                            <span class="hall off">
                              <mat-icon aria-hidden="true">grid_off</mat-icon>
                              <span class="hall-name">{{ h.name }}</span>
                              <span class="muted">Stall plan not published yet</span>
                            </span>
                          }
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="muted small">No hall of this event is open for stalls yet.</p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section>
          <h2 class="section-title">My bookings ({{ bookings().length }})</h2>
          @if (!bookings().length) {
            <div class="panel">
              <app-empty-state
                icon="event_seat"
                heading="No bookings yet"
                [text]="
                  p.closedReason
                    ? 'Stalls the organiser books for you appear here.'
                    : 'Open a hall above and hold a free stall; it appears here.'
                "
              />
            </div>
          } @else {
            <div class="table-wrap panel panel-flush">
              <table mat-table [dataSource]="bookings()" aria-label="My bookings">
                <ng-container matColumnDef="stall">
                  <th mat-header-cell *matHeaderCellDef>Stall</th>
                  <td mat-cell *matCellDef="let b">
                    <b>{{ b.stall.number }}</b
                    ><br /><span class="muted small">{{ b.hall.name }}</span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="event">
                  <th mat-header-cell *matHeaderCellDef>Event</th>
                  <td mat-cell *matCellDef="let b">{{ b.event.name }}</td>
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
                    @if (!p.closedReason && canCancel(b)) {
                      <button
                        mat-button
                        class="danger"
                        (click)="cancel(b)"
                        [disabled]="busy()"
                        [attr.aria-label]="'Cancel my hold on stall ' + b.stall.number"
                      >
                        Cancel
                      </button>
                    } @else if (b.status === 'confirmed') {
                      <span class="muted small">The organiser cancels confirmed bookings</span>
                    }
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns"></tr>
              </table>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .small {
      font: var(--mat-sys-body-small);
    }
    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .events {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 16px;
    }
    .events p {
      margin: 4px 0 0;
    }
    .event-name {
      font: var(--mat-sys-title-medium);
      margin: 0;
    }
    .halls {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 8px;
    }
    .hall {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      color: inherit;
      text-decoration: none;
      height: 100%;
      box-sizing: border-box;
    }
    a.hall:hover,
    a.hall:focus-visible {
      border-color: var(--mat-sys-primary);
    }
    .hall.off {
      border-style: dashed;
      color: var(--mat-sys-on-surface-variant);
    }
    .hall-name {
      font: var(--mat-sys-title-small);
      flex: 1 1 auto;
    }
    .chevron {
      color: var(--mat-sys-on-surface-variant);
    }
    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }
    .skeleton-list {
      display: grid;
      gap: 16px;
    }
    .skeleton {
      height: 120px;
      background: var(--mat-sys-surface-container);
      border-color: transparent;
      animation: pulse 1.2s ease-in-out infinite alternate;
    }
    @keyframes pulse {
      from {
        opacity: 0.5;
      }
      to {
        opacity: 1;
      }
    }
  `,
})
export class PortalPageComponent implements OnInit {
  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly eventStatusLabels = EVENT_STATUS_LABELS;
  protected readonly columns = ['stall', 'event', 'status', 'payment', 'created', 'actions'];
  protected readonly slug = this.context.slug;

  protected readonly portal = signal<PortalView | null>(null);
  protected readonly bookings = signal<BookingView[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [portal, bookings] = await Promise.all([
        firstValueFrom(this.api.portal(this.slug())),
        firstValueFrom(this.api.bookings(this.slug())),
      ]);
      this.portal.set(portal);
      this.bookings.set(bookings);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
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

  protected async cancel(b: BookingView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Let go of stall ${b.stall.number}?`,
      message: `Your hold on stall ${b.stall.number} (${b.hall.name}, ${b.event.name}) is cancelled and the stall is free for others. This cannot be undone.`,
      confirmLabel: 'Cancel my hold',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.cancel(this.slug(), b.id, null));
      this.notifier.success(`Your hold on stall ${b.stall.number} is cancelled.`);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
    await this.reload();
  }

  /** After a change: the events (free stall counts) and bookings as they are now. */
  private async reload(): Promise<void> {
    try {
      const [portal, bookings] = await Promise.all([
        firstValueFrom(this.api.portal(this.slug())),
        firstValueFrom(this.api.bookings(this.slug())),
      ]);
      this.portal.set(portal);
      this.bookings.set(bookings);
    } catch (error) {
      this.notifier.error(error, 'Your bookings could not be reloaded.');
    }
  }
}
