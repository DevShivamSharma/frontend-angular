import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  AbstractControl,
  AsyncValidatorFn,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { catchError, map, Observable, of, switchMap, timer } from 'rxjs';

import {
  BOOKING_MODES,
  BookingMode,
  FEATURE_LABELS,
  OrganisationFeatures,
  OrganisationLimits,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

/** "Bharat Mandapam (ITPO)" → "bharat-mandapam-itpo". */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Asks the server whether the slug is free, after the user pauses typing. */
export function slugAvailable(
  api: AdminApi,
  organisationId?: () => string | undefined,
): AsyncValidatorFn {
  return (control: AbstractControl<string>): Observable<ValidationErrors | null> => {
    if (!control.value || !SLUG_PATTERN.test(control.value)) {
      return of(null);
    }
    return timer(300).pipe(
      switchMap(() => api.slugCheck(control.value, organisationId?.())),
      map((check) => (check.available ? null : { slugTaken: check.reason })),
      catchError(() => of(null)),
    );
  };
}

/** The platform's contract with an organisation: booking mode, features and limits. */
export function planForm(fb: NonNullableFormBuilder) {
  return fb.group({
    bookingMode: fb.control<BookingMode>('own_portal'),
    features: fb.group({
      aiAssist: false,
      pdfPlot: true,
      exhibitorPortal: false,
      wayfinding: false,
    }),
    limits: fb.group({
      venues: [1, [Validators.required, Validators.min(1), Validators.max(1000)]],
      users: [25, [Validators.required, Validators.min(1), Validators.max(100_000)]],
      storageMb: [1024, [Validators.required, Validators.min(100), Validators.max(10_000_000)]],
    }),
  });
}

export type PlanForm = ReturnType<typeof planForm>;

export interface PlanValue {
  bookingMode: BookingMode;
  features: OrganisationFeatures;
  limits: OrganisationLimits;
}

@Component({
  selector: 'app-plan-fields',
  imports: [ReactiveFormsModule, FieldComponent, InputTextModule, SelectModule, ToggleSwitchModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container [formGroup]="group()">
      <h2 class="section-title">Booking</h2>
      <app-field label="How exhibitors book" for="plan-booking-mode">
        <p-select
          inputId="plan-booking-mode"
          formControlName="bookingMode"
          [options]="modes"
          optionLabel="label"
          optionValue="value"
        >
          <ng-template #item let-mode>
            <span class="mode"
              ><b>{{ mode.label }}</b
              ><span class="muted">{{ mode.hint }}</span></span
            >
          </ng-template>
        </p-select>
      </app-field>

      <h2 class="section-title">Features</h2>
      <div class="toggles" formGroupName="features">
        @for (feature of features; track feature.key) {
          <span class="check">
            <p-toggleswitch [formControlName]="feature.key" [inputId]="'plan-' + feature.key" />
            <label [for]="'plan-' + feature.key">{{ feature.label }}</label>
          </span>
        }
      </div>

      <h2 class="section-title">Limits</h2>
      <div class="form-grid" formGroupName="limits">
        <app-field label="Venues" error="1 to 1000" for="plan-fields-venues">
          <input
            id="plan-fields-venues"
            pInputText
            type="number"
            formControlName="venues"
            min="1"
          />
        </app-field>
        <app-field
          label="People (members and open invitations)"
          error="1 to 100000"
          for="plan-fields-users"
        >
          <input id="plan-fields-users" pInputText type="number" formControlName="users" min="1" />
        </app-field>
        <app-field label="Storage (MB)" error="At least 100" for="plan-fields-storage-mb">
          <input
            id="plan-fields-storage-mb"
            pInputText
            type="number"
            formControlName="storageMb"
            min="100"
          />
        </app-field>
      </div>
    </ng-container>
  `,
  styles: `
    .mode {
      display: grid;
      white-space: normal;
    }
    .mode .muted {
      font: var(--app-body-small);
    }
    .toggles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
  `,
})
export class PlanFieldsComponent {
  readonly group = input.required<FormGroup>();

  protected readonly modes = [...BOOKING_MODES];
  protected readonly features = (Object.keys(FEATURE_LABELS) as (keyof OrganisationFeatures)[]).map(
    (key) => ({ key, label: FEATURE_LABELS[key] }),
  );
}
