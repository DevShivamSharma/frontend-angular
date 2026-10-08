import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type { BookingView, SelfcareBookingPayload } from '../../../core/bookings/bookings.models';
import { selfcareRowInput } from '../../../core/bookings/selfcare-row';

export interface SelfcareExportDialogData {
  slug: string;
  booking: BookingView;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const WHOLE = /^[0-9]+$/;

/**
 * A held booking as rows of ITPO SelfCare's tables, for the venue to write there: SelfCare holds
 * the stall and takes the payment. SelfCare's own ids and its price-master values are entered by
 * hand when known; nothing is pre-filled, stored, or sent to SelfCare from here.
 */
@Component({
  selector: 'app-selfcare-export-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>SelfCare export for stall {{ data.booking.stall.number }}</h2>
    @if (rows(); as payload) {
      <mat-dialog-content class="stack">
        <p class="muted">
          The held booking of {{ data.booking.exhibitor.name }} as SelfCare rows, in SelfCare's
          pre-payment state. Copy them into the venue's system. Nothing was sent or stored.
        </p>
        <div class="json-bar row">
          <span class="muted small">T_STALLS, T_STALL_BOOKING and T_STALL_BOOKING_DETAIL</span>
          <span class="spacer"></span>
          <button mat-stroked-button type="button" (click)="copy()">
            <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon
            >{{ copied() ? 'Copied' : 'Copy JSON' }}
          </button>
        </div>
        <pre class="json" aria-label="SelfCare rows as JSON" tabindex="0">{{ json() }}</pre>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="rows.set(null)">Change values</button>
        <button mat-flat-button type="button" mat-dialog-close>Done</button>
      </mat-dialog-actions>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-dialog-content class="stack">
          <p class="muted">
            Enter SelfCare's own ids and its price-master values if you have them. Every field is
            optional and starts empty. Without prices, the amounts in the rows stay empty.
          </p>

          <h3 class="group">SelfCare ids</h3>
          <div class="form-grid">
            @for (f of idFields; track f.key) {
              <mat-form-field>
                <mat-label>{{ f.label }}</mat-label>
                <input matInput [formControlName]="f.key" autocomplete="off" />
                <mat-hint>{{ f.hint }}</mat-hint>
                <mat-error>{{ f.error }}</mat-error>
              </mat-form-field>
            }
          </div>

          <h3 class="group">Prices (SelfCare price master)</h3>
          <div class="form-grid">
            @for (f of priceFields; track f.key) {
              <mat-form-field>
                <mat-label>{{ f.label }}</mat-label>
                <input matInput type="number" [formControlName]="f.key" min="0" step="any" />
                @if (f.suffix) {
                  <span matTextSuffix>{{ f.suffix }}</span>
                }
                <mat-error>{{ f.error }}</mat-error>
              </mat-form-field>
            }
            <mat-form-field>
              <mat-label>Corner charges apply</mat-label>
              <mat-select formControlName="corner_charges_applicable">
                <mat-option value="">Not stated</mat-option>
                <mat-option value="yes">Yes</mat-option>
                <mat-option value="no">No</mat-option>
              </mat-select>
              <mat-hint>Needed once a price is entered</mat-hint>
            </mat-form-field>
          </div>

          <h3 class="group">Tax</h3>
          <div class="form-grid">
            @for (f of taxFields; track f.key) {
              <mat-form-field>
                <mat-label>{{ f.label }}</mat-label>
                <input
                  matInput
                  type="number"
                  [formControlName]="f.key"
                  min="0"
                  max="100"
                  step="any"
                />
                <span matTextSuffix>%</span>
                <mat-error>0 to 100</mat-error>
              </mat-form-field>
            }
          </div>

          @if (formError(); as message) {
            <p class="error" role="alert">{{ message }}</p>
          }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>Cancel</button>
          <button mat-flat-button type="submit" [disabled]="busy()">Make SelfCare rows</button>
        </mat-dialog-actions>
      </form>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(640px, 80vw);
    }
    p {
      margin: 0 0 12px;
      max-width: 72ch;
    }
    .group {
      font: var(--mat-sys-title-small);
      margin: 8px 0;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .json-bar {
      margin-bottom: 8px;
    }
    .json {
      margin: 0;
      padding: 12px;
      max-height: 50vh;
      overflow: auto;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-small);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre;
    }
  `,
})
export class SelfcareExportDialogComponent {
  protected readonly data = inject<SelfcareExportDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(BookingsApi);
  private readonly clipboard = inject(Clipboard);
  private readonly fb = inject(FormBuilder);

  protected readonly idFields = [
    { key: 'user_id', label: 'User id', hint: "SelfCare's user (uuid)", error: 'A uuid' },
    { key: 'event_id', label: 'Event id', hint: "SelfCare's event (uuid)", error: 'A uuid' },
    {
      key: 'event_hall_id',
      label: 'Event hall id',
      hint: "SelfCare's event hall (uuid)",
      error: 'A uuid',
    },
    { key: 'hall_id', label: 'Hall id', hint: "SelfCare's hall number", error: 'A whole number' },
    { key: 'stall_id', label: 'Stall id', hint: "SelfCare's T_STALLS id (uuid)", error: 'A uuid' },
    {
      key: 'product_category_id',
      label: 'Product category id',
      hint: "SelfCare's category number",
      error: 'A whole number',
    },
  ] as const;
  protected readonly priceFields = [
    { key: 'bare_rate', label: 'Bare rate', suffix: 'per m²', error: '0 or more' },
    { key: 'shell_rate', label: 'Shell rate', suffix: 'per m²', error: '0 or more' },
    { key: 'two_side_open_rate_percent', label: '2 sides open', suffix: '%', error: '0 to 100' },
    { key: 'three_side_open_rate_percent', label: '3 sides open', suffix: '%', error: '0 to 100' },
    { key: 'four_side_open_rate_percent', label: '4 sides open', suffix: '%', error: '0 to 100' },
    { key: 'catlog_entry_charge', label: 'Catalogue entry charge', suffix: '', error: '0 or more' },
  ] as const;
  protected readonly taxFields = [
    { key: 'cgst_percent', label: 'CGST' },
    { key: 'sgst_percent', label: 'SGST' },
    { key: 'igst_percent', label: 'IGST' },
  ] as const;

  private readonly percent = [Validators.min(0), Validators.max(100)];
  /** Every field starts empty: nothing is assumed about SelfCare's ids or prices. */
  protected readonly form = this.fb.group({
    user_id: ['', Validators.pattern(UUID)],
    event_id: ['', Validators.pattern(UUID)],
    event_hall_id: ['', Validators.pattern(UUID)],
    hall_id: ['', [Validators.pattern(WHOLE), Validators.min(1)]],
    stall_id: ['', Validators.pattern(UUID)],
    product_category_id: ['', [Validators.pattern(WHOLE), Validators.min(1)]],
    bare_rate: [null as number | null, Validators.min(0)],
    shell_rate: [null as number | null, Validators.min(0)],
    two_side_open_rate_percent: [null as number | null, this.percent],
    three_side_open_rate_percent: [null as number | null, this.percent],
    four_side_open_rate_percent: [null as number | null, this.percent],
    catlog_entry_charge: [null as number | null, Validators.min(0)],
    corner_charges_applicable: ['' as '' | 'yes' | 'no'],
    cgst_percent: [null as number | null, this.percent],
    sgst_percent: [null as number | null, this.percent],
    igst_percent: [null as number | null, this.percent],
  });

  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly rows = signal<SelfcareBookingPayload | null>(null);
  protected readonly json = computed(() => JSON.stringify(this.rows(), null, 2));
  protected readonly copied = signal(false);

  protected async submit(): Promise<void> {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const result = selfcareRowInput({
      ...value,
      corner_charges_applicable: value.corner_charges_applicable ?? '',
    });
    if (!result.ok) {
      this.formError.set(result.error);
      return;
    }
    this.busy.set(true);
    try {
      this.rows.set(
        await firstValueFrom(
          this.api.selfcareRow(this.data.slug, this.data.booking.id, result.input),
        ),
      );
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(): void {
    this.copied.set(this.clipboard.copy(this.json()));
    setTimeout(() => this.copied.set(false), 2000);
  }
}
