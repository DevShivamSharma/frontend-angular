import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';

export interface ExhibitorDialogData {
  slug: string;
  /** The exhibitor to edit; absent to create one. */
  exhibitor?: ExhibitorView;
  /** Events a new exhibitor can be registered for at once (draft or scheduled ones). */
  events: { id: string; name: string }[];
  /** Preselects the event of a new exhibitor. */
  eventId?: string;
  /**
   * Why a new exhibitor must be registered for an event, when it must (an event-scoped member
   * adds exhibitors to its own events only).
   */
  eventRequired?: string;
}

/** GSTIN: state code, PAN, entity number, `Z`, checksum (as the server checks it). */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Creates or edits an exhibitor company. Closes with the saved exhibitor. */
@Component({
  selector: 'app-exhibitor-dialog',
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
    <h2 mat-dialog-title>{{ data.exhibitor ? 'Edit exhibitor' : 'New exhibitor' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        <mat-form-field class="full-width">
          <mat-label>Company name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial maxlength="160" />
          <mat-error>2 to 160 characters</mat-error>
        </mat-form-field>
        <div class="pair">
          <mat-form-field>
            <mat-label>Contact name</mat-label>
            <input matInput formControlName="contactName" maxlength="120" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Phone</mat-label>
            <input matInput type="tel" formControlName="phone" maxlength="32" />
          </mat-form-field>
        </div>
        <div class="pair">
          <mat-form-field>
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" maxlength="254" />
            <mat-error>A valid email address</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>GSTIN</mat-label>
            <input matInput formControlName="gstin" placeholder="07AAACI1681G1ZN" maxlength="15" />
            <mat-error>15 characters, as on the GST certificate</mat-error>
          </mat-form-field>
        </div>
        <mat-form-field class="full-width">
          <mat-label>Address</mat-label>
          <textarea matInput formControlName="address" rows="2" maxlength="300"></textarea>
        </mat-form-field>
        @if (!data.exhibitor) {
          <mat-form-field class="full-width">
            <mat-label>Register for event</mat-label>
            <mat-select formControlName="eventId">
              @if (!data.eventRequired) {
                <mat-option value="">Not now</mat-option>
              }
              @for (event of data.events; track event.id) {
                <mat-option [value]="event.id">{{ event.name }}</mat-option>
              }
            </mat-select>
            @if (data.eventRequired) {
              <mat-hint>{{ data.eventRequired }}</mat-hint>
            } @else {
              <mat-hint>Optional; it can be registered for events later</mat-hint>
            }
            <mat-error>Choose the event it takes part in</mat-error>
          </mat-form-field>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ data.exhibitor ? 'Save' : 'Create exhibitor' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content {
      min-width: min(520px, 80vw);
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      gap: 0 12px;
    }
    @media (max-width: 480px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ExhibitorDialogComponent {
  protected readonly data = inject<ExhibitorDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(ExhibitorsApi);
  private readonly ref = inject(MatDialogRef<ExhibitorDialogComponent, ExhibitorView>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [
      this.data.exhibitor?.name ?? '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(160)],
    ],
    contactName: [this.data.exhibitor?.contactName ?? '', Validators.maxLength(120)],
    email: [this.data.exhibitor?.email ?? '', [Validators.email, Validators.maxLength(254)]],
    phone: [this.data.exhibitor?.phone ?? '', Validators.maxLength(32)],
    gstin: [this.data.exhibitor?.gstin ?? '', Validators.pattern(GSTIN)],
    address: [this.data.exhibitor?.address ?? '', Validators.maxLength(300)],
    eventId: [this.data.eventId ?? '', this.data.eventRequired ? Validators.required : []],
  });
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const value = this.form.getRawValue();
    const blank = (text: string): string | null => text.trim() || null;
    const input = {
      name: value.name.trim(),
      contactName: blank(value.contactName),
      email: blank(value.email),
      phone: blank(value.phone),
      gstin: blank(value.gstin.toUpperCase()),
      address: blank(value.address),
    };
    try {
      const saved = await firstValueFrom(
        this.data.exhibitor
          ? this.api.updateExhibitor(this.data.slug, this.data.exhibitor.id, input)
          : this.api.createExhibitor(this.data.slug, {
              ...input,
              ...(value.eventId ? { eventId: value.eventId } : {}),
            }),
      );
      this.ref.close(saved);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
