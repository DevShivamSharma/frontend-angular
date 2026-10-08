import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { HallView, VenueView } from '../../../core/api/api.models';
import { EventsApi } from '../../../core/events/events-api.service';
import type { EventDetailView } from '../../../core/events/events.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';

export interface AddHallsData {
  slug: string;
  event: EventDetailView;
}

/** Picks halls of one venue for the event. Closes with the event as saved. */
@Component({
  selector: 'app-add-halls-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Add halls to {{ data.event.name }}</h2>
    <mat-dialog-content class="stack">
      <p class="muted">
        Each hall is added on its floor as it is today, with your organisation’s rules. You can
        switch rules for each hall afterwards.
      </p>
      <mat-form-field>
        <mat-label>Venue</mat-label>
        <mat-select [ngModel]="venueId()" (ngModelChange)="pickVenue($event)">
          @for (v of venues(); track v.id) {
            <mat-option [value]="v.id">{{ v.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (venueId() && !loading() && !halls().length) {
        <p class="muted">This venue has no halls yet.</p>
      }
      <ul class="halls">
        @for (h of halls(); track h.id) {
          <li>
            <mat-checkbox
              [checked]="picked().has(h.id) || taken().has(h.id)"
              [disabled]="taken().has(h.id)"
              (change)="toggle(h.id, $event.checked)"
            >
              <span class="hall">
                <b>{{ h.name }}</b>
                <span class="muted small">
                  {{ h.width | number: '1.0-1' }} × {{ h.depth | number: '1.0-1' }} m ·
                  {{ h.floorArea | number: '1.0-0' }} m²{{ h.level ? ' · ' + h.level : '' }}
                  @if (taken().has(h.id)) {
                    · already in this event
                  }
                </span>
              </span>
            </mat-checkbox>
          </li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="add()" [disabled]="!picked().size || busy()">
        Add {{ picked().size || '' }} {{ picked().size === 1 ? 'hall' : 'halls' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 8px;
      min-width: min(480px, 80vw);
    }
    .halls {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    .hall {
      display: grid;
    }
    .small {
      font: var(--mat-sys-body-small);
      font-variant-numeric: tabular-nums;
    }
    p {
      margin: 0;
    }
  `,
})
export class AddHallsDialogComponent {
  protected readonly data = inject<AddHallsData>(MAT_DIALOG_DATA);
  private readonly venuesApi = inject(VenuesApi);
  private readonly eventsApi = inject(EventsApi);
  private readonly ref = inject(MatDialogRef<AddHallsDialogComponent, EventDetailView>);

  protected readonly venues = signal<VenueView[]>([]);
  protected readonly venueId = signal<string | null>(null);
  protected readonly halls = signal<HallView[]>([]);
  protected readonly picked = signal(new Set<string>());
  protected readonly taken = computed(() => new Set(this.data.event.halls.map((h) => h.hallId)));
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    void this.loadVenues();
  }

  private async loadVenues(): Promise<void> {
    try {
      const venues = await firstValueFrom(this.venuesApi.venues(this.data.slug));
      this.venues.set(venues);
      if (venues.length === 1) await this.pickVenue(venues[0].id);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async pickVenue(id: string): Promise<void> {
    this.venueId.set(id);
    this.picked.set(new Set());
    this.loading.set(true);
    try {
      this.halls.set(await firstValueFrom(this.venuesApi.halls(this.data.slug, id)));
    } catch {
      this.halls.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string, on: boolean): void {
    this.picked.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected async add(): Promise<void> {
    this.busy.set(true);
    try {
      this.ref.close(
        await firstValueFrom(
          this.eventsApi.addHalls(this.data.slug, this.data.event.id, [...this.picked()]),
        ),
      );
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
