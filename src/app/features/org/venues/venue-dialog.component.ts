import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import type { VenueView } from '../../../core/api/api.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';

export interface VenueDialogData {
  slug: string;
  /** The venue to edit; absent to create one. */
  venue?: VenueView;
}

/** Creates or edits a venue. Closes with the saved venue. */
@Component({
  selector: 'app-venue-dialog',
  imports: [ReactiveFormsModule, ButtonModule, FieldComponent, InputTextModule, TextareaModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ data.venue ? 'Edit venue' : 'New venue' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content stack">
        <app-field label="Name" error="2 to 160 characters" for="venue-dialog-name">
          <input
            id="venue-dialog-name"
            pInputText
            formControlName="name"
            cdkFocusInitial
            maxlength="160"
          />
        </app-field>
        <app-field label="Code" hint="Optional short name, e.g. BM" for="venue-dialog-code">
          <input id="venue-dialog-code" pInputText formControlName="code" maxlength="40" />
        </app-field>
        <app-field label="Address" for="venue-dialog-address">
          <textarea
            id="venue-dialog-address"
            pTextarea
            formControlName="address"
            rows="2"
            maxlength="300"
          ></textarea>
        </app-field>
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy()">
          {{ data.venue ? 'Save' : 'Create venue' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
  `,
})
export class VenueDialogComponent {
  protected readonly data = dialogData<VenueDialogData>();
  private readonly api = inject(VenuesApi);
  protected readonly ref = inject(DialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.venue?.name ?? '', [Validators.required, Validators.minLength(2)]],
    code: [this.data.venue?.code ?? ''],
    address: [this.data.venue?.address ?? ''],
  });
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
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
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
