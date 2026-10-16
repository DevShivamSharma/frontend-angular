import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { PlansApi } from '../../../core/plans/plans-api.service';
import type { PlanDeliveriesView, PlanDeliveryView } from '../../../core/plans/plans.models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';

/** While a push is waiting or being sent, the status is fetched again this often. */
const POLL_MS = 10_000;

/** What SelfCare's warning codes mean (receiver contract, success `warnings`). */
const WARNINGS: Record<string, string> = {
  HALL_HAS_NO_BASE_LAYOUT:
    'the hall has no base layout in SelfCare, so the stalls may not draw there until ITPO adds one',
};

/**
 * Whether a hall's published plan reached the venue system (SelfCare), with Resend for a failed
 * push. Renders nothing for events whose publishes are not pushed.
 */
@Component({
  selector: 'app-plan-delivery-status',
  imports: [DatePipe, ButtonModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      @if (v.pushes) {
        <span class="delivery">
          @if (v.reason) {
            <span class="status-chip is-neutral chip" [pTooltip]="v.reason" tooltipPosition="bottom"
              >Not sent: {{ v.reason }}</span
            >
          } @else if (latest(); as d) {
            @if (d.status === 'pending' || d.status === 'sending') {
              <span class="status-chip chip" [pTooltip]="sendingTip(d)" tooltipPosition="bottom"
                >Sending…</span
              >
            } @else if (d.status === 'delivered') {
              @if (d.lastStatusCode !== null && d.warnings.length) {
                <span
                  class="status-chip is-warning chip"
                  [pTooltip]="warningsTip(d)"
                  tooltipPosition="bottom"
                  >Sent, with a warning: {{ warningText(d.warnings[0]) }}</span
                >
              } @else if (d.lastStatusCode !== null) {
                <span
                  class="status-chip is-positive chip"
                  [pTooltip]="
                    'Version ' + d.revision + ', ' + (d.deliveredAt | date: 'd MMM y, HH:mm')
                  "
                  tooltipPosition="bottom"
                  >Sent to SelfCare</span
                >
              } @else {
                <span
                  class="status-chip is-neutral chip"
                  pTooltip="The server's VENUE_CALLBACK_TRANSPORT is log."
                  tooltipPosition="bottom"
                  >Logged, not sent</span
                >
              }
            } @else {
              <span
                class="status-chip is-warning chip"
                [pTooltip]="failedTip(d, v.canResend)"
                tooltipPosition="bottom"
                >Not sent: {{ d.lastError ?? 'it failed' }}</span
              >
            }
            @if (v.canResend) {
              <button
                pButton
                type="button"
                size="small"
                [text]="true"
                (click)="resend(d)"
                [disabled]="busy()"
                pTooltip="Sends the published plan to SelfCare again; it replaces the hall's stalls there."
                tooltipPosition="bottom"
              >
                Resend to SelfCare
              </button>
            }
          } @else {
            <span
              class="status-chip is-neutral chip"
              pTooltip="Publish to send this hall to SelfCare."
              tooltipPosition="bottom"
              >Not sent yet</span
            >
          }
        </span>
      }
    }
  `,
  styles: `
    .delivery {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .chip {
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class PlanDeliveryStatusComponent {
  readonly slug = input.required<string>();
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();
  /** The published revision; a change fetches the status again. */
  readonly revision = input<number | null>(null);
  /** A change fetches the status again: the page's SelfCare dialog may have resent it. */
  readonly refresh = input(0);

  private readonly api = inject(PlansApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);

  protected readonly view = signal<PlanDeliveriesView | null>(null);
  protected readonly busy = signal(false);
  protected readonly latest = computed(() => this.view()?.deliveries[0] ?? null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
    effect(() => {
      // Reads all five inputs, so a change in any of them loads again.
      this.revision();
      this.refresh();
      void this.load(this.slug(), this.eventId(), this.hallId());
    });
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async load(slug: string, eventId: string, hallId: string): Promise<void> {
    this.stopTimer();
    try {
      this.view.set(await firstValueFrom(this.api.deliveries(slug, eventId, hallId)));
    } catch {
      // Secondary information; the error interceptor has shown it.
      return;
    }
    this.pollWhileSending(slug, eventId, hallId);
  }

  /** A push that is waiting or being sent finishes by itself; look again soon. */
  private pollWhileSending(slug: string, eventId: string, hallId: string): void {
    const status = this.latest()?.status;
    if (status === 'pending' || status === 'sending') {
      this.timer = setTimeout(() => void this.load(slug, eventId, hallId), POLL_MS);
    }
  }

  protected sendingTip(d: PlanDeliveryView): string {
    const parts = [`Attempt ${d.attempts}`];
    if (d.lastError) parts.push(`Last try: ${d.lastError}`);
    if (d.status === 'pending' && d.nextAttemptAt) {
      parts.push(`Next try ${new Date(d.nextAttemptAt).toLocaleTimeString()}`);
    }
    return parts.join('. ');
  }

  /** A SelfCare warning code in words; an unknown code is shown as it came. */
  protected warningText(code: string): string {
    return WARNINGS[code] ?? code;
  }

  protected warningsTip(d: PlanDeliveryView): string {
    const when = d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : '';
    const said = d.warnings.map((w) => this.warningText(w)).join('. ');
    return `Version ${d.revision} reached SelfCare${when ? ` on ${when}` : ''}. ${said}.`;
  }

  /** What went wrong, and what to do: fix it, then Resend sends what is published now. */
  protected failedTip(d: PlanDeliveryView, canResend: boolean): string {
    const why = d.lastError ?? 'The venue system did not accept the plan.';
    return canResend
      ? `Version ${d.revision} did not reach SelfCare. ${why} A hall, event or category setting: fix it, then press Resend. A change to the stalls: make it in the plan and Publish, which sends it again.`
      : `Version ${d.revision} did not reach SelfCare. ${why}`;
  }

  protected async resend(delivery: PlanDeliveryView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Send again?',
      message: `Send version ${delivery.revision} to SelfCare again? It goes as a new delivery, and SelfCare replaces this hall's stalls with it.`,
      confirmLabel: 'Send again',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      this.view.set(
        await firstValueFrom(
          this.api.resendDelivery(this.slug(), this.eventId(), this.hallId(), delivery.id),
        ),
      );
      this.stopTimer();
      this.pollWhileSending(this.slug(), this.eventId(), this.hallId());
      this.notifier.success('Sent again; SelfCare answers within a minute.');
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
