import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { firstValueFrom } from 'rxjs';

import { errorMessage, httpStatus } from '../../../core/api/http-error';
import { paise } from '../../../core/bookings/booking-rules';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type { BookingView } from '../../../core/bookings/bookings.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

export interface MoveBookingDialogData {
  slug: string;
  booking: BookingView;
  /** The event's halls. */
  halls: Array<{ hallId: string; name: string }>;
}

interface FreeStall {
  key: string;
  hallId: string;
  stallId: string;
  label: string;
}

/**
 * Moves a booking to another free stall of the same event, at that stall's published price.
 * Closes with the moved booking.
 */
@Component({
  selector: 'app-move-booking-dialog',
  imports: [FormsModule, ButtonModule, ProgressBarModule, SelectModule, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Move stall {{ data.booking.stall.label }}</h2>
    <div class="dialog-content stack">
      <p class="muted">
        {{ data.booking.exhibitor.name }} moves to another free stall of
        {{ data.booking.event.name }}, at that stall's published price. Stall
        {{ data.booking.stall.label }} becomes free.
      </p>
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <p class="error" role="alert">{{ message }}</p>
        <button pButton [outlined]="true" type="button" (click)="load()">Try again</button>
      } @else if (!free().length) {
        <p class="notice" role="status">No other stall of this event is free right now.</p>
      } @else {
        <app-field label="New stall" for="move-booking-stall">
          <p-select
            inputId="move-booking-stall"
            ariaLabel="New stall"
            [options]="free()"
            optionLabel="label"
            optionValue="key"
            placeholder="Choose a free stall"
            [ngModel]="picked()"
            (ngModelChange)="picked.set($event)"
          />
        </app-field>
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="submit()" [disabled]="busy() || !picked()">
        Move booking
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
    .error {
      color: var(--app-error);
    }
    .notice {
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
  `,
})
export class MoveBookingDialogComponent {
  protected readonly data = dialogData<MoveBookingDialogData>();
  private readonly api = inject(BookingsApi);
  protected readonly ref = inject(DialogRef);

  protected readonly free = signal<FreeStall[]>([]);
  protected readonly picked = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  /** The free stalls of every hall of the event, as their stall maps show them now. */
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    const { slug, booking, halls } = this.data;
    try {
      const maps = await Promise.all(
        halls.map((h) => firstValueFrom(this.api.stallMap(slug, booking.event.id, h.hallId))),
      );
      this.free.set(
        maps.flatMap((m) =>
          m.stalls
            .filter((s) => s.state === 'free')
            .map((s) => ({
              key: `${m.hall.id}/${s.id}`,
              hallId: m.hall.id,
              stallId: s.id,
              label: `${m.hall.name} · ${s.label}${s.price ? ` · ${paise(s.price.amountPaise)}` : ''}`,
            })),
        ),
      );
    } catch (error) {
      this.loadError.set(errorMessage(error, 'The free stalls could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const target = this.free().find((f) => f.key === this.picked());
    if (!target) return;
    this.busy.set(true);
    try {
      this.ref.close(
        await firstValueFrom(
          this.api.move(this.data.slug, this.data.booking.id, target.hallId, target.stallId),
        ),
      );
    } catch (error) {
      // The error interceptor has shown it. A conflict means the stall was taken meanwhile.
      if (httpStatus(error) === 409) {
        this.picked.set(null);
        await this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
