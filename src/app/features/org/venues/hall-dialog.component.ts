import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

import type { HallView } from '../../../core/api/api.models';
import { errorMessage } from '../../../core/api/http-error';
import { VenuesApi } from '../../../core/venues/venues-api.service';

export interface HallDialogData {
  slug: string;
  venueId: string;
  /** The hall to edit; absent to draw a new, empty one. */
  hall?: HallView;
}

/** Mirrors the server's limit on one side of a hall. */
const MAX_SIDE = 2000;

/**
 * Creates a hall by hand, without a floor plan: an empty floor of the given width and depth,
 * all of it open for stalls. Also edits a hall's name and details (its floor is changed by
 * importing or editing the plan, not here).
 */
@Component({
  selector: 'app-hall-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.hall ? 'Edit hall' : 'New hall without a floor plan' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        @if (!data.hall) {
          <p class="muted intro">
            The hall starts as an empty rectangle with a 1 m grid. You can import its floor plan
            later; the import becomes a new version of this hall.
          </p>
        }
        <mat-form-field class="full-width">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial maxlength="120" />
          <mat-error>Give the hall a name</mat-error>
        </mat-form-field>
        <div class="pair">
          <mat-form-field>
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" maxlength="40" />
            <mat-hint>e.g. H6</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Level</mat-label>
            <input matInput formControlName="level" maxlength="40" />
            <mat-hint>e.g. Ground floor</mat-hint>
          </mat-form-field>
        </div>
        @if (!data.hall) {
          <div class="pair">
            <mat-form-field>
              <mat-label>Width</mat-label>
              <input
                matInput
                type="number"
                formControlName="width"
                min="1"
                [max]="maxSide"
                step="0.5"
              />
              <span matTextSuffix>m</span>
              <mat-error>1 to {{ maxSide }} m</mat-error>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Depth</mat-label>
              <input
                matInput
                type="number"
                formControlName="depth"
                min="1"
                [max]="maxSide"
                step="0.5"
              />
              <span matTextSuffix>m</span>
              <mat-error>1 to {{ maxSide }} m</mat-error>
            </mat-form-field>
          </div>
          @if (preview(); as p) {
            <div class="preview" aria-hidden="true">
              <svg [attr.viewBox]="'0 0 ' + p.w + ' ' + p.d" preserveAspectRatio="xMidYMid meet">
                <rect [attr.width]="p.w" [attr.height]="p.d" class="floor" />
              </svg>
            </div>
            <p class="muted area">
              {{ p.w | number: '1.0-2' }} × {{ p.d | number: '1.0-2' }} m ·
              {{ p.w * p.d | number: '1.0-0' }} m² of floor
            </p>
          }
        }
        <fieldset formGroupName="uses">
          <legend class="muted">This hall is also used for</legend>
          <mat-checkbox formControlName="fnb">Food &amp; beverage</mat-checkbox>
          <mat-checkbox formControlName="branding">Branding</mat-checkbox>
          <mat-checkbox formControlName="horseshoe">Horseshoe stalls</mat-checkbox>
          <mat-checkbox formControlName="openArea">Open area</mat-checkbox>
        </fieldset>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ data.hall ? 'Save' : 'Create hall' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content {
      min-width: min(480px, 80vw);
    }
    .intro {
      margin: 0 0 16px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    .preview {
      height: 120px;
      padding: 8px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container);
    }
    .preview svg {
      width: 100%;
      height: 100%;
    }
    .preview .floor {
      fill: var(--mat-sys-primary-container);
      stroke: var(--mat-sys-primary);
      vector-effect: non-scaling-stroke;
      stroke-width: 2;
    }
    .area {
      margin: 6px 0 12px;
      font-variant-numeric: tabular-nums;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0 8px;
    }
    legend {
      padding: 0;
      margin-bottom: 4px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    @media (max-width: 480px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class HallDialogComponent {
  protected readonly data = inject<HallDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(VenuesApi);
  private readonly ref = inject(MatDialogRef<HallDialogComponent, HallView>);
  protected readonly maxSide = MAX_SIDE;

  private readonly side = [Validators.required, Validators.min(1), Validators.max(MAX_SIDE)];
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.hall?.name ?? '', Validators.required],
    code: [this.data.hall?.code ?? ''],
    level: [this.data.hall?.level ?? ''],
    width: [60, this.side],
    depth: [40, this.side],
    uses: inject(NonNullableFormBuilder).group({
      fnb: [this.data.hall?.uses.fnb ?? false],
      branding: [this.data.hall?.uses.branding ?? false],
      horseshoe: [this.data.hall?.uses.horseshoe ?? false],
      openArea: [this.data.hall?.uses.openArea ?? false],
    }),
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  protected readonly preview = computed(() => {
    const { width, depth } = this.value();
    const ok = (n: unknown): n is number => typeof n === 'number' && n >= 1 && n <= MAX_SIDE;
    return ok(width) && ok(depth) ? { w: width, d: depth } : null;
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.data.hall) {
      this.form.controls.width.disable();
      this.form.controls.depth.disable();
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();
    const details = {
      name: value.name.trim(),
      code: value.code.trim() || null,
      level: value.level.trim() || null,
      uses: value.uses,
    };
    try {
      const saved = await firstValueFrom(
        this.data.hall
          ? this.api.updateHall(this.data.slug, this.data.hall.id, details)
          : this.api.createHall(this.data.slug, this.data.venueId, {
              ...details,
              width: value.width,
              depth: value.depth,
            }),
      );
      this.ref.close(saved);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
