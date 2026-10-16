import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import { PlansApi } from '../../../core/plans/plans-api.service';
import type { PlanDeliveriesView } from '../../../core/plans/plans.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';

export interface SelfcareSendData {
  slug: string;
  eventId: string;
  hallId: string;
  /** The version just published. */
  revision: number;
}

/** While the push waits or is sent, its status is fetched again this often. */
const POLL_MS = 3_000;
/** After this long the dialog stops watching; the status chip keeps going. */
const WATCH_MS = 120_000;

/**
 * Watches a just-published plan go to SelfCare: a bar while it is sent, then whether SelfCare
 * took it, or why not with Resend. Closes with nothing; the status chip shows the same.
 */
@Component({
  selector: 'app-selfcare-send-dialog',
  imports: [ButtonModule, ProgressBarModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title head"><app-icon name="send" /> Sending to SelfCare</h2>
    <div class="dialog-content stack" role="status" aria-live="polite">
      @switch (state()) {
        @case ('sending') {
          <p-progressbar mode="indeterminate" [style]="{ height: '6px' }" />
          <p>
            Version {{ data.revision }} is published and is being sent to SelfCare. This takes a
            few seconds.
          </p>
          @if (latest()?.lastError; as e) {
            <p class="muted small">
              Last try did not go through ({{ e }}); it is tried again by itself.
            </p>
          }
        }
        @case ('waiting') {
          <p>
            SelfCare has not answered yet. You can close this: the status next to Publish shows
            when it lands, and Resend is there if it fails.
          </p>
        }
        @case ('sent') {
          <p class="ok"><app-icon name="check_circle" /> SelfCare took version {{ data.revision }}.</p>
          @if (latest()?.warnings?.length) {
            <p class="muted small">With a warning: {{ warnings() }}</p>
          }
          <p class="muted small">
            In SelfCare, open the event and pick this hall to see the stalls.
          </p>
        }
        @case ('logged') {
          <p>
            The push was written to the server log, not sent: the server's
            VENUE_CALLBACK_TRANSPORT is log.
          </p>
        }
        @case ('failed') {
          <p class="bad"><app-icon name="error" /> SelfCare did not take version {{ data.revision }}.</p>
          <p>{{ latest()?.lastError ?? 'The venue system did not accept the plan.' }}</p>
          <p class="muted small">
            A hall, event or category setting: fix it, then press Resend. A change to the stalls:
            make it in the plan and Publish again.
          </p>
        }
        @case ('off') {
          <p>{{ view()?.reason }}</p>
        }
      }
    </div>
    <div class="dialog-actions">
      @if (state() === 'failed' && view()?.canResend) {
        <button pButton type="button" [outlined]="true" (click)="resend()" [disabled]="busy()">
          Resend to SelfCare
        </button>
      }
      <button pButton type="button" (click)="ref.close()">Close</button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .stack {
      display: grid;
      gap: 12px;
      min-width: min(360px, 84vw);
    }
    p {
      margin: 0;
    }
    .ok,
    .bad {
      display: flex;
      gap: 6px;
      align-items: center;
      font: var(--app-title-small);
    }
    .ok {
      color: var(--p-green-600, #16a34a);
    }
    .bad {
      color: var(--p-red-600, #dc2626);
    }
    .small {
      font: var(--app-body-small);
    }
  `,
})
export class SelfcareSendDialogComponent {
  protected readonly data = dialogData<SelfcareSendData>();
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(PlansApi);

  protected readonly view = signal<PlanDeliveriesView | null>(null);
  protected readonly busy = signal(false);
  /** Watched long enough with no answer. */
  private readonly gaveUp = signal(false);
  protected readonly latest = computed(() => this.view()?.deliveries[0] ?? null);

  protected readonly state = computed(() => {
    const v = this.view();
    if (v?.reason) return 'off';
    const d = this.latest();
    if (!d || d.status === 'pending' || d.status === 'sending') {
      return this.gaveUp() ? 'waiting' : 'sending';
    }
    if (d.status === 'failed') return 'failed';
    return d.lastStatusCode === null ? 'logged' : 'sent';
  });

  protected readonly warnings = computed(() => (this.latest()?.warnings ?? []).join(', '));

  private timer: ReturnType<typeof setTimeout> | null = null;
  private until = Date.now() + WATCH_MS;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    void this.load();
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async load(): Promise<void> {
    this.stop();
    const { slug, eventId, hallId } = this.data;
    try {
      this.view.set(await firstValueFrom(this.api.deliveries(slug, eventId, hallId)));
    } catch {
      // The error interceptor has shown it; try again on the next tick.
    }
    if (this.state() !== 'sending') return;
    if (Date.now() > this.until) {
      this.gaveUp.set(true);
      return;
    }
    this.timer = setTimeout(() => void this.load(), POLL_MS);
  }

  protected async resend(): Promise<void> {
    const d = this.latest();
    if (!d) return;
    const { slug, eventId, hallId } = this.data;
    this.busy.set(true);
    try {
      this.view.set(await firstValueFrom(this.api.resendDelivery(slug, eventId, hallId, d.id)));
      this.gaveUp.set(false);
      this.until = Date.now() + WATCH_MS;
      void this.load();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
