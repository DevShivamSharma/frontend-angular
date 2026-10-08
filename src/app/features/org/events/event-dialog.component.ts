import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import { EVENT_KINDS, EventKind, EventView } from '../../../core/events/events.models';
import type { EventType } from '../../../core/rules/rules.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';

export interface EventDialogData {
  slug: string;
  /** The event to edit; absent to create one. */
  event?: EventView;
  /** The venue can change only for a member of the whole organisation. */
  canChangeVenue: boolean;
}

/** A calendar day, `YYYY-MM-DD`, as the server takes it. */
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The last day cannot be before the first day. */
function daysInOrder(group: AbstractControl): ValidationErrors | null {
  const { startsOn, endsOn } = group.value as { startsOn?: string; endsOn?: string };
  return startsOn && endsOn && endsOn < startsOn ? { daysOrder: true } : null;
}

/** Creates or edits an event. Closes with the saved event. */
@Component({
  selector: 'app-event-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.event ? 'Edit event' : 'New event' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        @if (!data.event) {
          <p class="muted intro">A new event starts as a draft. Book its halls next.</p>
        }
        <mat-form-field class="full-width">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial maxlength="160" />
          <mat-error>2 to 160 characters</mat-error>
        </mat-form-field>
        <div class="pair">
          <mat-form-field>
            <mat-label>Venue</mat-label>
            <mat-select formControlName="venueId">
              @for (venue of venueOptions(); track venue.id) {
                <mat-option [value]="venue.id">{{ venue.name }}</mat-option>
              }
            </mat-select>
            @if (venueHint(); as hint) {
              <mat-hint>{{ hint }}</mat-hint>
            }
            <mat-error>Choose a venue</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" maxlength="40" />
            <mat-hint>Optional short name, e.g. IITF</mat-hint>
          </mat-form-field>
        </div>
        <div class="pair">
          <mat-form-field>
            <mat-label>Kind</mat-label>
            <mat-select formControlName="kind">
              @for (kind of kinds; track kind.value) {
                <mat-option [value]="kind.value">{{ kind.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>{{ kindHint() }}</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Event type</mat-label>
            <mat-select formControlName="eventType">
              <mat-option value="B2B">B2B</mat-option>
              <mat-option value="B2C">B2C</mat-option>
            </mat-select>
            <mat-hint>The rules check stalls by it</mat-hint>
          </mat-form-field>
        </div>
        <div class="pair">
          <mat-form-field>
            <mat-label>First day</mat-label>
            <input matInput type="date" formControlName="startsOn" />
            <mat-error>Choose the first day</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Last day</mat-label>
            <input matInput type="date" formControlName="endsOn" />
            <mat-error>Choose the last day</mat-error>
          </mat-form-field>
        </div>
        @if (form.hasError('daysOrder')) {
          <p class="error" role="alert">The last day cannot be before the first day.</p>
        }
        <fieldset>
          <legend class="muted">Organiser</legend>
          <mat-form-field class="full-width">
            <mat-label>Organiser name</mat-label>
            <input matInput formControlName="organiserName" maxlength="160" />
          </mat-form-field>
          <div class="pair">
            <mat-form-field>
              <mat-label>Organiser email</mat-label>
              <input matInput type="email" formControlName="organiserEmail" maxlength="254" />
              <mat-error>A valid email address</mat-error>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Organiser phone</mat-label>
              <input matInput type="tel" formControlName="organiserPhone" maxlength="32" />
            </mat-form-field>
          </div>
        </fieldset>
        <mat-form-field class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput formControlName="description" rows="3" maxlength="2000"></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ data.event ? 'Save' : 'Create event' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content {
      min-width: min(560px, 80vw);
    }
    .intro {
      margin: 0 0 16px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      gap: 0 12px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
    }
    legend {
      padding: 0;
      margin-bottom: 8px;
    }
    .error {
      margin: -8px 0 16px;
      color: var(--mat-sys-error);
    }
    @media (max-width: 480px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class EventDialogComponent {
  protected readonly data = inject<EventDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(EventsApi);
  private readonly venuesApi = inject(VenuesApi);
  private readonly ref = inject(MatDialogRef<EventDialogComponent, EventView>);

  protected readonly kinds = EVENT_KINDS;
  private readonly venues = signal<{ id: string; name: string }[]>([]);
  private readonly venuesLoaded = signal(false);
  /** The event's own venue stays listed even when the venues cannot be read. */
  protected readonly venueOptions = computed(() => {
    const own = this.data.event?.venue;
    const list = this.venues();
    return own && !list.some((v) => v.id === own.id) ? [own, ...list] : list;
  });
  private readonly venueLocked =
    !!this.data.event && (!this.data.canChangeVenue || this.data.event.hallCount > 0);
  protected readonly venueHint = computed(() => {
    if (!this.data.event || !this.venueLocked) {
      return this.venuesLoaded() && !this.venues().length ? 'Add a venue first' : null;
    }
    return this.data.canChangeVenue
      ? 'The venue can change only while the event books no hall'
      : 'Only a member of the whole organisation changes the venue';
  });

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      venueId: [this.data.event?.venue.id ?? '', Validators.required],
      name: [
        this.data.event?.name ?? '',
        [Validators.required, Validators.minLength(2), Validators.maxLength(160)],
      ],
      code: [this.data.event?.code ?? '', Validators.maxLength(40)],
      kind: [this.data.event?.kind ?? ('internal' as EventKind), Validators.required],
      eventType: [this.data.event?.eventType ?? ('B2B' as EventType), Validators.required],
      startsOn: [this.data.event?.startsOn ?? '', [Validators.required, Validators.pattern(DAY)]],
      endsOn: [this.data.event?.endsOn ?? '', [Validators.required, Validators.pattern(DAY)]],
      organiserName: [this.data.event?.organiser.name ?? '', Validators.maxLength(160)],
      organiserEmail: [
        this.data.event?.organiser.email ?? '',
        [Validators.email, Validators.maxLength(254)],
      ],
      organiserPhone: [this.data.event?.organiser.phone ?? '', Validators.maxLength(32)],
      description: [this.data.event?.description ?? '', Validators.maxLength(2000)],
    },
    { validators: daysInOrder },
  );
  private readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  protected readonly kindHint = computed(
    () => EVENT_KINDS.find((k) => k.value === this.kind())?.hint ?? '',
  );
  protected readonly busy = signal(false);

  constructor() {
    if (this.venueLocked) {
      this.form.controls.venueId.disable();
    }
    void this.loadVenues();
  }

  private async loadVenues(): Promise<void> {
    try {
      const venues = await firstValueFrom(this.venuesApi.venues(this.data.slug));
      this.venues.set(venues.map((v) => ({ id: v.id, name: v.name })));
      if (!this.data.event && venues.length === 1) {
        this.form.controls.venueId.setValue(venues[0].id);
      }
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.venuesLoaded.set(true);
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const value = this.form.getRawValue();
    const blank = (text: string): string | null => text.trim() || null;
    const input = {
      venueId: value.venueId,
      name: value.name.trim(),
      code: blank(value.code),
      kind: value.kind,
      eventType: value.eventType,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      organiserName: blank(value.organiserName),
      organiserEmail: blank(value.organiserEmail),
      organiserPhone: blank(value.organiserPhone),
      description: blank(value.description),
    };
    try {
      const saved = await firstValueFrom(
        this.data.event
          ? this.api.updateEvent(this.data.slug, this.data.event.id, input)
          : this.api.createEvent(this.data.slug, input),
      );
      this.ref.close(saved);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
