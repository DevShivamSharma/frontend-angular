import { DatePipe } from '@angular/common';
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
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom, Observable } from 'rxjs';

import { paise } from '../../../core/bookings/booking-rules';
import type { EventView, SettlementView } from '../../../core/events/events.models';
import { SettlementsApi } from '../../../core/events/settlements-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PayoutDialogComponent, PayoutDialogData } from './payout-dialog.component';

/**
 * The money of an event, on the event's page: what was taken, refunded and charged, and what is
 * payable to the payee. The figures are live while the settlement is open; staff close it once
 * the event is completed, then record the bank transfer by hand. Organisers only read it.
 */
@Component({
  selector: 'app-event-settlement',
  imports: [
    DatePipe,
    ButtonModule,
    ProgressBarModule,
    TableModule,
    TooltipModule,
    EmptyStateComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <div class="head">
        <h2 class="section-title">Settlement</h2>
        @if (view(); as v) {
          <span
            class="status-chip"
            [class.is-neutral]="v.status === 'open'"
            [class.is-warning]="v.status === 'closing'"
            [class.is-positive]="v.status === 'settled'"
            >{{ statusLabels[v.status] }}</span
          >
        }
      </div>
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      @if (view(); as v) {
        <dl class="figures">
          <dt>Taken (gross)</dt>
          <dd>{{ money(v.figures.grossPaise, true) }}</dd>
          <dt>Refunded</dt>
          <dd>{{ money(v.figures.refundedPaise, true) }}</dd>
          <dt>Razorpay fees</dt>
          <dd>{{ money(v.figures.gatewayFeePaise, true) }}</dd>
          <dt>Platform fee ({{ v.figures.platformFeePercent }} %)</dt>
          <dd>{{ money(v.figures.platformFeePaise, true) }}</dd>
          <dt class="net">Payable to the payee</dt>
          <dd class="net">
            @if (v.figures.netPayablePaise > 0) {
              {{ money(v.figures.netPayablePaise, true) }}
            } @else {
              Nothing to pay
            }
          </dd>
        </dl>
        @if (v.status === 'open') {
          <p class="muted small">Live figures; they freeze when the settlement is closed.</p>
        } @else if (v.closedAt) {
          <p class="muted small">Closed {{ v.closedAt | date: 'd MMM y' }}</p>
        }
        @if (v.feeUnknown > 0) {
          <p class="muted small">
            <app-icon name="warning" />Razorpay has not reported the fee of {{ v.feeUnknown }}
            {{ v.feeUnknown === 1 ? 'payment' : 'payments' }}; they count as ₹0.
          </p>
        }

        @if (v.payments.length) {
          <div class="table-wrap">
            <p-table [value]="v.payments" [paginator]="v.payments.length > 25" [rows]="25">
              <ng-template #header>
                <tr>
                  <th>Stall</th>
                  <th>Exhibitor</th>
                  <th>Paid on</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Fee</th>
                  <th>Refunded</th>
                </tr>
              </ng-template>
              <ng-template #body let-p>
                <tr>
                  <td>
                    <b>{{ p.stallLabel }}</b>
                  </td>
                  <td>{{ p.exhibitorName }}</td>
                  <td class="muted">{{ p.paidAt | date: 'd MMM y' }}</td>
                  <td>{{ p.method ?? '—' }}</td>
                  <td class="nums">{{ money(p.amountPaise, true) }}</td>
                  <td class="nums">{{ p.feePaise === null ? '—' : money(p.feePaise, true) }}</td>
                  <td class="nums">
                    {{ p.refundedPaise > 0 ? money(p.refundedPaise, true) : '—' }}
                    @if (p.pendingRefundPaise > 0) {
                      <br /><span class="muted small"
                        >{{ money(p.pendingRefundPaise, true) }} on the way</span
                      >
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        } @else {
          <app-empty-state icon="payments" heading="No payments for this event." />
        }

        @if (canManage()) {
          <div class="actions">
            @if (v.status === 'open') {
              <button
                pButton
                (click)="close(v)"
                [disabled]="busy() || !!v.closeRefusal"
                [pTooltip]="v.closeRefusal ?? ''"
              >
                <app-icon name="lock" />Close settlement
              </button>
            } @else if (v.status === 'closing') {
              <button pButton (click)="payout(v)" [disabled]="busy()">
                <app-icon name="account_balance" />Record payout
              </button>
            }
          </div>
        }
        @if (v.status === 'settled' && v.payout; as p) {
          <p>
            Paid to <b>{{ p.payeeName }}</b> on {{ p.settledAt | date: 'd MMM y' }}, reference
            <b>{{ p.reference }}</b>
          </p>
          <pre class="muted">{{ p.bankDetails }}</pre>
        }
      }
    </section>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .figures {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 24px;
      max-width: 440px;
      margin: 8px 0;
    }
    .figures dt,
    .figures dd {
      margin: 0;
    }
    .figures dd {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .figures .net {
      font-weight: 600;
      border-top: 1px solid var(--app-outline-variant);
      padding-top: 6px;
    }
    .small {
      font: var(--app-body-small);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
  `,
})
export class EventSettlementComponent {
  readonly event = input.required<EventView>();

  private readonly api = inject(SettlementsApi);
  private readonly dialog = inject(AppDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly canManage = computed(() => this.context.can('payments.manage'));
  protected readonly money = paise;
  protected readonly statusLabels = { open: 'Open', closing: 'Closing', settled: 'Settled' };
  protected readonly view = signal<SettlementView | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);

  /** Completing the event changes what can be done here, so its status restarts the load. */
  private readonly key = computed(() => `${this.event().id}:${this.event().status}`);

  constructor() {
    // Only the event restarts the load: the request itself reads the session signal.
    effect(() => {
      this.key();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.view.set(await firstValueFrom(this.api.get(this.context.slug(), this.event().id)));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected async close(v: SettlementView): Promise<void> {
    const event = this.event();
    const ok = await this.confirm.confirm({
      title: `Close the settlement of ${event.name}?`,
      message: 'The figures freeze; refunds are no longer made for this event.',
      confirmLabel: 'Close settlement',
    });
    if (ok) await this.step(this.api.close(this.context.slug(), v.eventId), 'Settlement closed.');
  }

  protected payout(v: SettlementView): void {
    const data: PayoutDialogData = {
      slug: this.context.slug(),
      eventId: v.eventId,
      eventName: this.event().name,
      netPayablePaise: v.figures.netPayablePaise,
    };
    this.dialog.open<SettlementView>(PayoutDialogComponent, { data }).subscribe((done) => {
      if (!done) return;
      this.view.set(done);
      this.notifier.success('Payout recorded.');
    });
  }

  private async step(call: Observable<SettlementView>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      this.view.set(await firstValueFrom(call));
      this.notifier.success(done);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
