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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { catchError, map, Observable, of, switchMap, timer } from 'rxjs';

import {
  BOOKING_MODES,
  BookingMode,
  FEATURE_LABELS,
  OrganisationFeatures,
  OrganisationLimits,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';

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
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container [formGroup]="group()">
      <h2 class="section-title">Booking</h2>
      <mat-form-field class="full-width">
        <mat-label>How exhibitors book</mat-label>
        <mat-select formControlName="bookingMode">
          @for (mode of modes; track mode.value) {
            <mat-option [value]="mode.value">{{ mode.label }} — {{ mode.hint }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <h2 class="section-title">Features</h2>
      <div class="toggles" formGroupName="features">
        @for (feature of features; track feature.key) {
          <mat-slide-toggle [formControlName]="feature.key">{{ feature.label }}</mat-slide-toggle>
        }
      </div>

      <h2 class="section-title">Limits</h2>
      <div class="form-grid" formGroupName="limits">
        <mat-form-field>
          <mat-label>Venues</mat-label>
          <input matInput type="number" formControlName="venues" min="1" />
          <mat-error>1 to 1000</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>People (members and open invitations)</mat-label>
          <input matInput type="number" formControlName="users" min="1" />
          <mat-error>1 to 100000</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Storage (MB)</mat-label>
          <input matInput type="number" formControlName="storageMb" min="100" />
          <mat-error>At least 100</mat-error>
        </mat-form-field>
      </div>
    </ng-container>
  `,
  styles: `
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

  protected readonly modes = BOOKING_MODES;
  protected readonly features = (Object.keys(FEATURE_LABELS) as (keyof OrganisationFeatures)[]).map(
    (key) => ({ key, label: FEATURE_LABELS[key] }),
  );
}
