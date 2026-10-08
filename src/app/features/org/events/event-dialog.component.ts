import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
import type { EventKind, EventView } from '../../../core/events/events.models';

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
    <h2 mat-dialog-title>
      {{
        data.event
          ? 'Edit event'
          : data.kind === 'external'
            ? 'New external event'
            : 'New internal event'
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="stack">
        <mat-form-field>
          <mat-label>Event name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial maxlength="160" />
          <mat-error>2 to 160 characters</mat-error>
        </mat-form-field>
        @if (data.kind === 'external') {
          <mat-form-field>
            <mat-label>Organiser</mat-label>
            <input matInput formControlName="organiserName" maxlength="160" />
            <mat-hint>The company that booked the halls</mat-hint>
            <mat-error>Name the organiser</mat-error>
          </mat-form-field>
        }
        <div class="row2">
          <mat-form-field>
            <mat-label>Event id in your system</mat-label>
            <input matInput formControlName="venueEventId" maxlength="80" />
            <mat-hint>Optional, e.g. the hall booking number</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Visitors</mat-label>
            <mat-select formControlName="audience">
              <mat-option value="B2B">B2B (trade)</mat-option>
              <mat-option value="B2C">B2C (public)</mat-option>
            </mat-select>
            <mat-hint>Sets the passage width the rules ask for</mat-hint>
          </mat-form-field>
        </div>
        <div class="row2">
          <mat-form-field>
            <mat-label>Starts</mat-label>
            <input matInput type="date" formControlName="startsOn" />
            <mat-error>Choose the first day</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Ends</mat-label>
            <input matInput type="date" formControlName="endsOn" />
            <mat-error>Choose the last day</mat-error>
          </mat-form-field>
        </div>
        <div class="row2">
          <mat-form-field>
            <mat-label>Build-up from</mat-label>
            <input matInput type="date" formControlName="buildUpOn" />
            <mat-hint>Optional</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Dismantling until</mat-label>
            <input matInput type="date" formControlName="dismantleOn" />
            <mat-hint>Optional</mat-hint>
          </mat-form-field>
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
      color: var(--mat-sys-error);
    }
  `,
})
export class EventDialogComponent {
  protected readonly data = inject<EventDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(EventsApi);
  private readonly ref = inject(MatDialogRef<EventDialogComponent, EventView>);

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
