import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import {
  BOOKING_STATUS_LABELS,
  canLetGo,
  holdUntil,
  paise,
} from '../../../core/bookings/booking-rules';
import type { BookingView } from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

/** The exhibitor's own bookings, newest first; a hold can be let go of while the event is open. */
@Component({
  selector: 'app-portal-bookings-page',
  imports: [
    DatePipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    TableModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header heading="My bookings" subheading="The stalls you hold or have booked." />

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state
            icon="error"
            heading="Your bookings could not be loaded"
            [text]="message"
          >
            <button pButton (click)="load()"><app-icon name="restart_alt" />Try again</button>
          </app-empty-state>
        </div>
      } @else if (!bookings().length) {
        <div class="panel">
          <app-empty-state
            icon="event_seat"
            heading="No bookings yet"
            text="Open a hall from My events and hold a free stall."
          >
            <a pButton [routerLink]="['/', slug(), 'portal']">My events</a>
          </app-empty-state>
        </div>
      } @else {
        <section class="panel">
          <div class="table-wrap">
            <p-table [value]="bookings()" [paginator]="bookings().length > 25" [rows]="25">
              <ng-template #header>
                <tr>
                  <th>Stall</th>
                  <th>Event</th>
                  <th>Hall</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Made</th>
                  <th><span class="visually-hidden">Actions</span></th>
                </tr>
              </ng-template>
              <ng-template #body let-b>
                <tr>
                  <td>
                    <b>{{ b.stall.label }}</b>
                  </td>
                  <td>{{ b.event.name }}</td>
                  <td>{{ b.hall.name }}</td>
                  <td>
                    {{ statusLabels[b.status] }}
                    @if (b.status === 'held' && b.holdExpiresAt) {
                      <br /><span class="muted small">until {{ until(b) }}</span>
                    }
                    @if (b.cancelReason) {
                      <br /><span class="muted small">{{ b.cancelReason }}</span>
                    }
                  </td>
                  <td class="nums">
                    {{ money(b.amountPaise) }}
                    <span class="muted small">excl. GST</span>
                  </td>
                  <td class="muted">{{ b.createdAt | date: 'd MMM y' }}</td>
                  <td class="actions">
                    @if (allowed(b)) {
                      <button
                        pButton
                        [text]="true"
                        severity="danger"
                        (click)="letGo(b)"
                        [disabled]="busy()"
                      >
                        Let go
                      </button>
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
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
  `,
})
export class PortalBookingsPageComponent implements OnInit {
  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly money = paise;
  protected readonly until = holdUntil;
  protected readonly allowed = canLetGo;
  /** Indexed by the table row's status, which the template types as any. */
  protected readonly statusLabels: Record<string, string> = BOOKING_STATUS_LABELS;

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
      this.bookings.set(await firstValueFrom(this.api.bookings(this.slug())));
    } catch (error) {
      this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async letGo(b: BookingView): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Let go of stall ${b.stall.label}?`,
      message: 'The stall is free for others to hold again. This cannot be undone.',
      reasonLabel: 'Why (optional)',
      confirmLabel: 'Let go',
      // "Cancel" next to "Let go" reads as the same thing.
      cancelLabel: 'Keep it',
      destructive: true,
      optional: true,
    });
    if (reason === null) return;
    this.busy.set(true);
    try {
      const done = await firstValueFrom(this.api.cancel(this.slug(), b.id, reason || null));
      this.notifier.success(`You let go of stall ${done.stall.label}.`);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
