import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
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
  isPaid,
  paise,
  paymentLabel,
} from '../../../core/bookings/booking-rules';
import type { BookingView } from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { PortalPayment } from '../../../core/bookings/portal-payment.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import {
  PortalReceiptDialogComponent,
  PortalReceiptDialogData,
} from './portal-receipt-dialog.component';

/**
 * The exhibitor's own bookings, newest first: a hold is paid for or let go of while the event is
 * open, and a paid stall has its receipt.
 */
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
                  <th class="text-right">Amount</th>
                  <th>Made</th>
                  <th><span class="visually-hidden">Actions</span></th>
                </tr>
              </ng-template>
              <ng-template #body let-b>
                <tr>
                  <td>
                    <span class="stall-label">{{ b.stall.label }}</span>
                  </td>
                  <td>{{ b.event.name }}</td>
                  <td>{{ b.hall.name }}</td>
                  <td>
                    <span class="status-chip" [class]="chipClass(b.status)">
                      {{ statusLabels[b.status] }}
                    </span>
                    @if (b.status === 'held' && b.holdExpiresAt) {
                      <div class="sub-detail">
                        <i class="pi pi-clock sub-icon"></i> until {{ until(b) }}
                      </div>
                    }
                    @if (b.payment) {
                      <div class="sub-detail">{{ paymentText(b) }}</div>
                    }
                    @if (b.cancelReason) {
                      <div class="sub-detail">{{ b.cancelReason }}</div>
                    }
                  </td>
                  <td class="nums text-right">
                    <span class="amount-main">{{ money(b.amountPaise) }}</span>
                    <span class="muted small"> excl. GST</span>
                  </td>
                  <td class="muted">{{ b.createdAt | date: 'd MMM y' }}</td>
                  <td class="actions">
                    @if (b.status === 'held' && !paid(b)) {
                      <button
                        pButton
                        [text]="true"
                        icon="pi pi-wallet"
                        (click)="pay(b)"
                        [disabled]="busy()"
                      >
                        Pay
                      </button>
                    }
                    @if (paid(b)) {
                      <button
                        pButton
                        [text]="true"
                        icon="pi pi-receipt"
                        (click)="receipt(b)"
                      >
                        Receipt
                      </button>
                    }
                    @if (allowed(b)) {
                      <button
                        pButton
                        [text]="true"
                        severity="danger"
                        icon="pi pi-times"
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
    .text-right {
      text-align: right;
    }
    .actions {
      text-align: right;
      white-space: nowrap;
    }

    /* Stall label pill */
    .stall-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      padding: 2px 10px;
      border-radius: 8px;
      font-weight: 700;
      font: var(--app-label-large);
      background: color-mix(in srgb, var(--app-primary) 10%, transparent);
      color: var(--app-primary);
    }

    /* Sub-details under the status chip */
    .sub-detail {
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .sub-icon {
      font-size: 0.7rem;
    }

    /* Amount main value */
    .amount-main {
      font-weight: 600;
    }
  `,
})
export class PortalBookingsPageComponent implements OnInit {
  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly payment = inject(PortalPayment);
  private readonly dialog = inject(AppDialog);
  private readonly context = inject(OrgContextStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly slug = this.context.slug;
  protected readonly money = paise;
  protected readonly until = holdUntil;
  protected readonly allowed = canLetGo;
  protected readonly paid = isPaid;
  protected readonly paymentText = paymentLabel;
  /** Indexed by the table row's status, which the template types as any. */
  protected readonly statusLabels: Record<string, string> = BOOKING_STATUS_LABELS;

  /** Maps a booking status to the appropriate status-chip CSS variant class. */
  protected chipClass(status: string): string {
    switch (status) {
      case 'confirmed':
        return 'is-positive';
      case 'held':
        return 'is-warning';
      case 'expired':
      case 'cancelled':
        return 'is-neutral';
      default:
        return '';
    }
  }

  protected readonly bookings = signal<BookingView[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Reloads once more when a payment is still being confirmed with Razorpay. */
  private pendingReload: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.pendingReload) clearTimeout(this.pendingReload);
    });
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

  protected async pay(b: BookingView): Promise<void> {
    this.busy.set(true);
    try {
      const result = await this.payment.pay(this.slug(), b, null);
      if (result?.outcome === 'pending') {
        // Razorpay's webhook finishes it; look again in a few seconds, once.
        this.pendingReload = setTimeout(() => void this.load(), 5000);
      }
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  protected receipt(b: BookingView): void {
    const data: PortalReceiptDialogData = { booking: b };
    this.dialog.open(PortalReceiptDialogComponent, { data });
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
