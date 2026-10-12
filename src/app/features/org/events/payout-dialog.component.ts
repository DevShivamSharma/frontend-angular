import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { firstValueFrom } from 'rxjs';

import { paise } from '../../../core/bookings/booking-rules';
import { SettlementsApi } from '../../../core/events/settlements-api.service';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

export interface PayoutDialogData {
  slug: string;
  eventId: string;
  eventName: string;
  netPayablePaise: number;
}

/**
 * Records the bank transfer made to the payee of a closed settlement: who was paid, where, and
 * the bank's reference. Closes with the settled settlement.
 */
@Component({
  selector: 'app-payout-dialog',
  imports: [FormsModule, ButtonModule, InputTextModule, TextareaModule, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Record payout</h2>
    <div class="dialog-content stack">
      <p class="muted">
        Transfer {{ money(data.netPayablePaise, true) }} to the payee by bank, then record it here.
        This cannot be undone.
      </p>
      <app-field label="Payee name" error="2 to 160 characters" for="payout-payee">
        <input
          id="payout-payee"
          pInputText
          [ngModel]="payeeName()"
          (ngModelChange)="payeeName.set($event)"
        />
      </app-field>
      <app-field label="Bank details" error="5 to 1000 characters" for="payout-bank">
        <textarea
          pTextarea
          id="payout-bank"
          rows="3"
          placeholder="Account name, number, IFSC, bank"
          [ngModel]="bankDetails()"
          (ngModelChange)="bankDetails.set($event)"
        ></textarea>
      </app-field>
      <app-field label="Transfer reference (UTR)" error="3 to 120 characters" for="payout-reference">
        <input
          id="payout-reference"
          pInputText
          [ngModel]="reference()"
          (ngModelChange)="reference.set($event)"
        />
      </app-field>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" severity="secondary" (click)="ref.close()">
        Cancel
      </button>
      <button pButton type="button" (click)="submit()" [disabled]="busy() || !valid()">
        Record payout
      </button>
    </div>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 8px;
      min-width: min(440px, 80vw);
    }
    p {
      margin: 0;
    }
  `,
})
export class PayoutDialogComponent {
  protected readonly data = dialogData<PayoutDialogData>();
  private readonly api = inject(SettlementsApi);
  protected readonly ref = inject(DialogRef);
  protected readonly money = paise;

  protected readonly payeeName = signal('');
  protected readonly bankDetails = signal('');
  protected readonly reference = signal('');
  protected readonly busy = signal(false);

  /** The server's lengths, on what it will keep (trimmed). */
  protected readonly valid = computed(
    () =>
      this.inRange(this.payeeName(), 2, 160) &&
      this.inRange(this.bankDetails(), 5, 1000) &&
      this.inRange(this.reference(), 3, 120),
  );

  private inRange(value: string, min: number, max: number): boolean {
    const length = value.trim().length;
    return length >= min && length <= max;
  }

  protected async submit(): Promise<void> {
    if (!this.valid()) return;
    this.busy.set(true);
    try {
      this.ref.close(
        await firstValueFrom(
          this.api.payout(this.data.slug, this.data.eventId, {
            payeeName: this.payeeName().trim(),
            bankDetails: this.bankDetails().trim(),
            reference: this.reference().trim(),
          }),
        ),
      );
    } catch {
      // The error interceptor has shown it; the dialog stays open to correct or cancel.
    } finally {
      this.busy.set(false);
    }
  }
}
