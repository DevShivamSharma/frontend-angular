import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import type { HallView, VenueView } from '../../../core/api/api.models';
import { EventsApi } from '../../../core/events/events-api.service';
import type { EventDetailView } from '../../../core/events/events.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';

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
    ButtonModule,
    ProgressBarModule,
    FieldComponent,
    SelectModule,
    CheckboxModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Add halls to {{ data.event.name }}</h2>
    <div class="dialog-content stack">
      <p class="muted">
        Each hall is added on its floor as it is today, with your organisation’s rules. You can
        switch rules for each hall afterwards.
      </p>
      <app-field label="Venue" for="add-halls-venue">
        <p-select
          inputId="add-halls-venue"
          [options]="venues()"
          optionLabel="name"
          optionValue="id"
          placeholder="Choose a venue"
          [ngModel]="venueId()"
          (ngModelChange)="pickVenue($event)"
        />
      </app-field>
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      @if (venueId() && !loading() && !halls().length) {
        <p class="muted">This venue has no halls yet.</p>
      }
      <ul class="halls">
        @for (h of halls(); track h.id) {
          <li>
            <span class="check">
              <p-checkbox
                [binary]="true"
                [inputId]="'add-hall-' + h.id"
                [ngModel]="picked().has(h.id) || taken().has(h.id)"
                [disabled]="taken().has(h.id)"
                (ngModelChange)="toggle(h.id, $event)"
              />
              <label class="hall" [for]="'add-hall-' + h.id">
                <b>{{ h.name }}</b>
                <span class="muted small">
                  {{ h.width | number: '1.0-1' }} × {{ h.depth | number: '1.0-1' }} m ·
                  {{ h.floorArea | number: '1.0-0' }} m²{{ h.level ? ' · ' + h.level : '' }}
                  @if (taken().has(h.id)) {
                    · already in this event
                  }
                </span>
              </label>
            </span>
          </li>
        }
      </ul>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton (click)="add()" [disabled]="!picked().size || busy()">
        Add {{ picked().size || '' }} {{ picked().size === 1 ? 'hall' : 'halls' }}
      </button>
    </div>
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
      font: var(--app-body-small);
      font-variant-numeric: tabular-nums;
    }
    p {
      margin: 0;
    }
  `,
})
export class AddHallsDialogComponent {
  protected readonly data = dialogData<AddHallsData>();
  private readonly venuesApi = inject(VenuesApi);
  private readonly eventsApi = inject(EventsApi);
  protected readonly ref = inject(DialogRef);

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
