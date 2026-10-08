import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { errorMessage, httpStatus } from '../../../core/api/http-error';
import { BookingsApi } from '../../../core/bookings/bookings-api.service';
import type { BookingView, MapStallView } from '../../../core/bookings/bookings.models';

export interface MoveBookingDialogData {
  slug: string;
  booking: BookingView;
  /** The event's halls with a published plan (all of them when that is not known). */
  halls: { hallId: string; name: string }[];
}

interface FreeStalls {
  hallId: string;
  name: string;
  stalls: MapStallView[];
}

/** Moves a booking to another free stall of the same event. Closes with the moved booking. */
@Component({
  selector: 'app-move-booking-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Move stall {{ data.booking.stall.number }}</h2>
    <mat-dialog-content class="stack">
      <p class="muted">
        {{ data.booking.exhibitor.name }} moves to another free stall of
        {{ data.booking.event.name }}. Stall {{ data.booking.stall.number }} becomes free.
      </p>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
        <p class="muted">Finding free stalls…</p>
      } @else if (loadError(); as message) {
        <p class="error" role="alert">{{ message }}</p>
        <button mat-stroked-button type="button" (click)="load()">
          <mat-icon>refresh</mat-icon>Try again
        </button>
      } @else if (!freeCount()) {
        <p class="notice" role="status">No other stall of this event is free right now.</p>
      } @else {
        <mat-form-field>
          <mat-label>New stall</mat-label>
          <mat-select [formControl]="stallId">
            @for (hall of free(); track hall.hallId) {
              <mat-optgroup [label]="hall.name">
                @for (s of hall.stalls; track s.id) {
                  <mat-option [value]="s.id"
                    >{{ s.number }} · {{ s.area | number: '1.0-2' }} m²</mat-option
                  >
                }
              </mat-optgroup>
            }
          </mat-select>
          <mat-error>Choose the new stall</mat-error>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        (click)="submit()"
        [disabled]="busy() || loading() || !freeCount()"
      >
        Move booking
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
    p {
      margin: 0 0 12px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .notice {
      padding: 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
    }
    button[mat-stroked-button] {
      justify-self: start;
    }
  `,
})
export class MoveBookingDialogComponent implements OnInit {
  protected readonly data = inject<MoveBookingDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(BookingsApi);
  private readonly ref = inject(MatDialogRef<MoveBookingDialogComponent, BookingView>);

  protected readonly stallId = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly free = signal<FreeStalls[]>([]);
  protected readonly freeCount = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  /** The free stalls of every published hall of the event, as the stall maps show them now. */
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    const { slug, booking } = this.data;
    try {
      const maps = await Promise.all(
        this.data.halls.map((h) =>
          firstValueFrom(this.api.stallMap(slug, booking.event.id, h.hallId)).catch(
            (error: unknown) => {
              // A hall without a published plan has no stall to move to.
              if (httpStatus(error) === 404) return null;
              throw error;
            },
          ),
        ),
      );
      const free = this.data.halls
        .map((h, i) => ({
          hallId: h.hallId,
          name: h.name,
          stalls: (maps[i]?.stalls ?? []).filter(
            (s) => s.state === 'free' && s.id !== booking.stall.id,
          ),
        }))
        .filter((h) => h.stalls.length);
      this.free.set(free);
      this.freeCount.set(free.reduce((n, h) => n + h.stalls.length, 0));
    } catch (error) {
      this.loadError.set(errorMessage(error, 'The free stalls could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(): Promise<void> {
    if (this.stallId.invalid) {
      this.stallId.markAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      this.ref.close(
        await firstValueFrom(
          this.api.move(this.data.slug, this.data.booking.id, this.stallId.value),
        ),
      );
    } catch (error) {
      // The error interceptor has shown it. A conflict means the stall was taken meanwhile.
      if (httpStatus(error) === 409) {
        this.stallId.reset();
        await this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
