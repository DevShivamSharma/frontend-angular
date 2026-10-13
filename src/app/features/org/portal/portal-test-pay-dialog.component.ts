import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { Notifier } from '../../../core/ui/notifier.service';

export interface PortalTestPayDialogData {
  /** "₹333", what Checkout will ask for. */
  amount: string;
}

/** How to pay in Razorpay test mode; Checkout opens on that method. */
export type TestPayMethod = 'netbanking' | 'card';

/**
 * Razorpay's published test values, shown before Checkout opens while the server uses test keys
 * (`rzp_test_…`). Checkout cannot be filled from this page — it runs in Razorpay's own frame and
 * only takes name, email, phone and the method in advance — so the card is offered for copying.
 */
const TEST_CARD = { number: '5267 3181 8797 5449', expiry: '12/30', cvv: '123' };

@Component({
  selector: 'app-portal-test-pay-dialog',
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Test payment</h2>
    <div class="dialog-content">
      <p class="muted">
        Razorpay is in <b>test mode</b>: no real money moves. Pay {{ data.amount }} with one of these.
      </p>
      <section class="way">
        <h3>Netbanking (easiest)</h3>
        <p class="muted small">Pick any bank, then press <b>Success</b> on Razorpay's test page.</p>
        <button pButton type="button" (click)="ref.close('netbanking')">
          Pay with test netbanking
        </button>
      </section>
      <section class="way">
        <h3>Card</h3>
        <dl class="rows">
          <dt>Number</dt>
          <dd>
            <code>{{ card.number }}</code>
            <button pButton type="button" [text]="true" size="small" (click)="copy(card.number)">
              Copy
            </button>
          </dd>
          <dt>Expiry</dt>
          <dd><code>{{ card.expiry }}</code></dd>
          <dt>CVV</dt>
          <dd><code>{{ card.cvv }}</code></dd>
        </dl>
        <p class="muted small">Then press <b>Success</b> if Razorpay asks for an OTP.</p>
        <button pButton type="button" [outlined]="true" (click)="ref.close('card')">
          Pay with test card
        </button>
      </section>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
    </div>
  `,
  styles: `
    .way {
      padding: 12px 0;
      border-top: 1px solid var(--app-outline-variant);
    }
    h3 {
      margin: 0 0 4px;
      font: var(--app-title-small);
    }
    .small {
      font: var(--app-body-small);
    }
    .rows {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 12px;
      align-items: center;
      margin: 8px 0;
    }
    dt {
      color: var(--app-on-surface-variant);
    }
    dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    code {
      font-family: ui-monospace, monospace;
    }
  `,
})
export class PortalTestPayDialogComponent {
  protected readonly data = dialogData<PortalTestPayDialogData>();
  protected readonly ref = inject(DialogRef);
  private readonly notifier = inject(Notifier);
  protected readonly card = TEST_CARD;

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ''));
      this.notifier.success('Card number copied.');
    } catch {
      this.notifier.warn('Copy did not work; type the number in.');
    }
  }
}
