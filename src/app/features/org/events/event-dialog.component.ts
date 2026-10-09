import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventKind, EventView } from '../../../core/events/events.models';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { SelectModule } from 'primeng/select';

export interface EventDialogData {
  slug: string;
  kind: EventKind;
  /** The event to edit; absent to create one. */
  event?: EventView;
}

/** The dates in order: build-up ≤ start ≤ end ≤ dismantling. */
function datesInOrder(group: AbstractControl): ValidationErrors | null {
  const { startsOn, endsOn, buildUpOn, dismantleOn } = group.value as Record<string, string>;
  if (startsOn && endsOn && endsOn < startsOn) return { endsBeforeStart: true };
  if (buildUpOn && startsOn && buildUpOn > startsOn) return { buildUpAfterStart: true };
  if (dismantleOn && endsOn && dismantleOn < endsOn) return { dismantleBeforeEnd: true };
  return null;
}

/** Creates or edits an internal or external event. Closes with the saved event. */
@Component({
  selector: 'app-event-dialog',
  imports: [ReactiveFormsModule, ButtonModule, FieldComponent, InputTextModule, SelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">
      {{
        data.event
          ? 'Edit event'
          : data.kind === 'external'
            ? 'New external event'
            : 'New internal event'
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content stack">
        <app-field label="Event name" error="2 to 160 characters" for="event-dialog-name">
          <input
            id="event-dialog-name"
            pInputText
            formControlName="name"
            cdkFocusInitial
            maxlength="160"
          />
        </app-field>
        @if (data.kind === 'external') {
          <app-field
            label="Organiser"
            hint="The company that booked the halls"
            error="Name the organiser"
            for="event-dialog-organiser-name"
          >
            <input
              id="event-dialog-organiser-name"
              pInputText
              formControlName="organiserName"
              maxlength="160"
            />
          </app-field>
        }
        <div class="row2">
          <app-field
            label="Event id in your system"
            hint="Optional, e.g. the hall booking number"
            for="event-dialog-venue-event-id"
          >
            <input
              id="event-dialog-venue-event-id"
              pInputText
              formControlName="venueEventId"
              maxlength="80"
            />
          </app-field>
          <app-field
            label="Visitors"
            for="event-dialog-audience"
            hint="Sets the passage width the rules ask for"
          >
            <p-select
              inputId="event-dialog-audience"
              formControlName="audience"
              [options]="audiences"
              optionLabel="label"
              optionValue="value"
            />
          </app-field>
        </div>
        <div class="row2">
          <app-field label="Starts" error="Choose the first day" for="event-dialog-starts-on">
            <input id="event-dialog-starts-on" pInputText type="date" formControlName="startsOn" />
          </app-field>
          <app-field label="Ends" error="Choose the last day" for="event-dialog-ends-on">
            <input id="event-dialog-ends-on" pInputText type="date" formControlName="endsOn" />
          </app-field>
        </div>
        <div class="row2">
          <app-field label="Build-up from" hint="Optional" for="event-dialog-build-up-on">
            <input
              id="event-dialog-build-up-on"
              pInputText
              type="date"
              formControlName="buildUpOn"
            />
          </app-field>
          <app-field label="Dismantling until" hint="Optional" for="event-dialog-dismantle-on">
            <input
              id="event-dialog-dismantle-on"
              pInputText
              type="date"
              formControlName="dismantleOn"
            />
          </app-field>
        </div>
        @if (form.errors && form.touched) {
          <p class="problem" role="alert">
            @if (form.hasError('endsBeforeStart')) {
              The event ends before it starts.
            } @else if (form.hasError('buildUpAfterStart')) {
              Build-up starts on or before the first day.
            } @else {
              Dismantling ends on or after the last day.
            }
          </p>
        }
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy()">
          {{ data.event ? 'Save' : 'Create event' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(520px, 80vw);
    }
    .row2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0 12px;
    }
    .problem {
      margin: 0;
      color: var(--app-error);
    }
  `,
})
export class EventDialogComponent {
  protected readonly data = dialogData<EventDialogData>();
  private readonly api = inject(EventsApi);
  protected readonly ref = inject(DialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      name: [this.data.event?.name ?? '', [Validators.required, Validators.minLength(2)]],
      organiserName: [
        this.data.event?.organiserName ?? '',
        this.data.kind === 'external' ? Validators.required : [],
      ],
      venueEventId: [this.data.event?.venueEventId ?? ''],
      audience: [this.data.event?.audience ?? ('B2B' as const)],
      startsOn: [this.data.event?.startsOn ?? '', Validators.required],
      endsOn: [this.data.event?.endsOn ?? '', Validators.required],
      buildUpOn: [this.data.event?.buildUpOn ?? ''],
      dismantleOn: [this.data.event?.dismantleOn ?? ''],
    },
    { validators: datesInOrder },
  );
  protected readonly busy = signal(false);
  protected readonly audiences = [
    { value: 'B2B', label: 'B2B (trade)' },
    { value: 'B2C', label: 'B2C (public)' },
  ];

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const v = this.form.getRawValue();
    const input = {
      name: v.name.trim(),
      organiserName: this.data.kind === 'external' ? v.organiserName.trim() : null,
      venueEventId: v.venueEventId.trim() || null,
      audience: v.audience,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      buildUpOn: v.buildUpOn || null,
      dismantleOn: v.dismantleOn || null,
    };
    try {
      const saved = await firstValueFrom(
        this.data.event
          ? this.api.update(this.data.slug, this.data.event.id, input)
          : this.api.create(this.data.slug, { ...input, kind: this.data.kind }),
      );
      this.ref.close(saved);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
