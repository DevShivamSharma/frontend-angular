import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { firstValueFrom } from 'rxjs';

import type { EventView, ExhibitorInput, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

/** GSTIN, as the server checks it: state code, PAN, entity number, `Z`, checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface ExhibitorDialogData {
  slug: string;
  /** The exhibitor to edit; absent to create one. */
  exhibitor?: ExhibitorView;
  /** Events a new exhibitor can be registered for at once: drafts and scheduled ones. */
  events: EventView[];
  /** Organisers add exhibitors to one of their events, so the event is required. */
  eventRequired: boolean;
}

/** Creates or edits an exhibitor (ported from `@feature/rules`). Closes with the saved one. */
@Component({
  selector: 'app-exhibitor-dialog',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, SelectModule, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ x ? 'Edit ' + x.name : 'New exhibitor' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content form-grid">
        <app-field label="Company" for="exhibitor-name" error="2 to 160 characters">
          <input id="exhibitor-name" pInputText formControlName="name" maxlength="160" />
        </app-field>
        <app-field label="Contact name" for="exhibitor-contact">
          <input id="exhibitor-contact" pInputText formControlName="contactName" maxlength="120" />
        </app-field>
        <app-field label="Email" for="exhibitor-email" error="A valid email address">
          <input
            id="exhibitor-email"
            pInputText
            type="email"
            formControlName="email"
            maxlength="254"
          />
        </app-field>
        <app-field label="Phone" for="exhibitor-phone">
          <input id="exhibitor-phone" pInputText formControlName="phone" maxlength="32" />
        </app-field>
        <app-field
          label="GSTIN"
          for="exhibitor-gstin"
          hint="15 characters, e.g. 07AABCU9603R1ZX"
          error="A 15-character GSTIN"
        >
          <input id="exhibitor-gstin" pInputText formControlName="gstin" maxlength="15" />
        </app-field>
        <app-field label="Address" for="exhibitor-address">
          <input id="exhibitor-address" pInputText formControlName="address" maxlength="300" />
        </app-field>
        @if (!x) {
          <app-field
            label="Register for"
            for="exhibitor-event"
            [hint]="data.eventRequired ? 'One of your events' : 'Optional; or later, on the event page'"
            error="Choose the event"
          >
            <p-select
              inputId="exhibitor-event"
              ariaLabel="Register for"
              formControlName="eventId"
              [options]="data.events"
              optionLabel="name"
              optionValue="id"
              placeholder="No event yet"
              [showClear]="!data.eventRequired"
            />
          </app-field>
        }
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy()">
          {{ x ? 'Save' : 'Create exhibitor' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .form-grid {
      min-width: min(560px, 84vw);
    }
  `,
})
export class ExhibitorDialogComponent {
  protected readonly data = dialogData<ExhibitorDialogData>();
  private readonly api = inject(ExhibitorsApi);
  protected readonly ref = inject(DialogRef);
  protected readonly x = this.data.exhibitor;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [
      this.x?.name ?? '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(160)],
    ],
    contactName: [this.x?.contactName ?? ''],
    email: [this.x?.email ?? '', [Validators.email]],
    phone: [this.x?.phone ?? ''],
    gstin: [this.x?.gstin ?? '', [Validators.pattern(GSTIN)]],
    address: [this.x?.address ?? ''],
    eventId: ['', this.data.eventRequired ? [Validators.required] : []],
  });
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input: ExhibitorInput = {
      name: v.name.trim(),
      contactName: v.contactName.trim() || null,
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
      gstin: v.gstin.trim() || null,
      address: v.address.trim() || null,
    };
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.x
          ? this.api.update(this.data.slug, this.x.id, input)
          : this.api.create(this.data.slug, {
              ...input,
              name: v.name.trim(),
              ...(v.eventId ? { eventId: v.eventId } : {}),
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
