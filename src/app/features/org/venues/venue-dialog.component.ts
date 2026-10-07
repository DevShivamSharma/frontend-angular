import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

import type { VenueView } from '../../../core/api/api.models';
import { errorMessage } from '../../../core/api/http-error';
import { VenuesApi } from '../../../core/venues/venues-api.service';

export interface VenueDialogData {
  slug: string;
  /** The venue to edit; absent to create one. */
  venue?: VenueView;
}

/** Creates or edits a venue. Closes with the saved venue. */
@Component({
  selector: 'app-venue-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.venue ? 'Edit venue' : 'New venue' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="stack">
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial maxlength="160" />
          <mat-error>2 to 160 characters</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Code</mat-label>
          <input matInput formControlName="code" maxlength="40" />
          <mat-hint>Optional short name, e.g. BM</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Address</mat-label>
          <textarea matInput formControlName="address" rows="2" maxlength="300"></textarea>
        </mat-form-field>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ data.venue ? 'Save' : 'Create venue' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class VenueDialogComponent {
  protected readonly data = inject<VenueDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(VenuesApi);
  private readonly ref = inject(MatDialogRef<VenueDialogComponent, VenueView>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.venue?.name ?? '', [Validators.required, Validators.minLength(2)]],
    code: [this.data.venue?.code ?? ''],
    address: [this.data.venue?.address ?? ''],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();
    const input = {
      name: value.name.trim(),
      code: value.code.trim() || null,
      address: value.address.trim() || null,
    };
    try {
      const saved = await firstValueFrom(
        this.data.venue
          ? this.api.updateVenue(this.data.slug, this.data.venue.id, input)
          : this.api.createVenue(this.data.slug, input),
      );
      this.ref.close(saved);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
