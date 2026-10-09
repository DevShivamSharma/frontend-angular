import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import type { HallFloor, HallView } from '../../../core/api/api.models';
import type { MultiPolygon } from '../../../core/venues/floor-plan.models';
import {
  HallAnnotations,
  HallAnnotationsEditorComponent,
} from '../../../shared/floor/hall-annotations-editor.component';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { CheckboxModule } from 'primeng/checkbox';

export interface HallDialogData {
  slug: string;
  venueId: string;
  /** The hall to edit; absent to draw a new, empty one. */
  hall?: HallView;
  floor?: HallFloor;
}

/** Mirrors the server's limit on one side of a hall. */
const MAX_SIDE = 2000;

/**
 * Creates an empty hall of the given width and depth, all of it open for stalls.
 * Also edits an existing hall's name and details, without changing its floor.
 */
@Component({
  selector: 'app-hall-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    ButtonModule,
    HallAnnotationsEditorComponent,
    FieldComponent,
    InputTextModule,
    InputGroupModule,
    InputGroupAddonModule,
    CheckboxModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ data.hall ? 'Edit hall' : 'New hall by size' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content">
        @if (!data.hall) {
          <p class="muted intro">
            The hall starts as an empty rectangle with a 1 m grid, open for stalls.
          </p>
        }
        <app-field
          class="full-width"
          label="Name"
          error="Give the hall a name"
          for="hall-dialog-name"
        >
          <input
            id="hall-dialog-name"
            pInputText
            formControlName="name"
            cdkFocusInitial
            maxlength="120"
          />
        </app-field>
        <div class="pair">
          <app-field label="Code" hint="e.g. H6" for="hall-dialog-code">
            <input id="hall-dialog-code" pInputText formControlName="code" maxlength="40" />
          </app-field>
          <app-field label="Level" hint="e.g. Ground floor" for="hall-dialog-level">
            <input id="hall-dialog-level" pInputText formControlName="level" maxlength="40" />
          </app-field>
        </div>
        @if (!data.hall) {
          <div class="pair">
            <app-field label="Width" for="hall-width" [error]="'1 to ' + maxSide + ' m'">
              <p-inputgroup>
                <input
                  id="hall-width"
                  pInputText
                  type="number"
                  formControlName="width"
                  min="1"
                  [max]="maxSide"
                  step="0.5"
                />
                <p-inputgroup-addon>m</p-inputgroup-addon>
              </p-inputgroup>
            </app-field>
            <app-field label="Depth" for="hall-depth" [error]="'1 to ' + maxSide + ' m'">
              <p-inputgroup>
                <input
                  id="hall-depth"
                  pInputText
                  type="number"
                  formControlName="depth"
                  min="1"
                  [max]="maxSide"
                  step="0.5"
                />
                <p-inputgroup-addon>m</p-inputgroup-addon>
              </p-inputgroup>
            </app-field>
          </div>
          @if (preview(); as p) {
            <p class="muted area">
              {{ p.w | number: '1.0-2' }} × {{ p.d | number: '1.0-2' }} m ·
              {{ p.w * p.d | number: '1.0-0' }} m² of floor
            </p>
          }
        }
        @if (floorPreview(); as floor) {
          <app-hall-annotations-editor
            [floor]="floor"
            (annotationsChange)="annotations.set($event)"
          />
          @if (!annotationsValid()) {
            <p class="error" role="alert">Give each helper and legend a name before saving.</p>
          }
        }
        <fieldset formGroupName="uses">
          <legend class="muted">This hall is also used for</legend>
          <span class="check"
            ><p-checkbox formControlName="fnb" [binary]="true" inputId="hall-use-fnb" /><label
              for="hall-use-fnb"
              >Food &amp; beverage</label
            ></span
          >
          <span class="check"
            ><p-checkbox
              formControlName="branding"
              [binary]="true"
              inputId="hall-use-branding"
            /><label for="hall-use-branding">Branding</label></span
          >
          <span class="check"
            ><p-checkbox
              formControlName="horseshoe"
              [binary]="true"
              inputId="hall-use-horseshoe"
            /><label for="hall-use-horseshoe">Horseshoe stalls</label></span
          >
          <span class="check"
            ><p-checkbox
              formControlName="openArea"
              [binary]="true"
              inputId="hall-use-openArea"
            /><label for="hall-use-openArea">Open area</label></span
          >
        </fieldset>
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy() || !annotationsValid()">
          {{ data.hall ? 'Save' : 'Create hall' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .dialog-content {
      min-width: 0;
    }
    .intro {
      margin: 0 0 16px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
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
      color: var(--app-error);
    }
    @media (max-width: 480px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class HallDialogComponent {
  protected readonly data = dialogData<HallDialogData>();
  private readonly api = inject(VenuesApi);
  protected readonly ref = inject(DialogRef);
  protected readonly maxSide = MAX_SIDE;
  protected readonly annotations = signal<HallAnnotations>(
    structuredClone({
      labels: this.data.floor?.labels ?? [],
      iconGroups: this.data.floor?.iconGroups ?? [],
      legend: this.data.floor?.legend ?? [],
    }),
  );
  protected readonly annotationsValid = computed(() => {
    const a = this.annotations();
    return (
      a.labels.every((l) => !!l.text.trim()) &&
      a.iconGroups.every((g) => g.icons.every((i) => !!i.label.trim())) &&
      a.legend.every((l) => !!l.label.trim())
    );
  });

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
  private readonly baseFloor = computed<HallFloor | null>(() => {
    if (this.data.hall && !this.data.floor) return null;
    if (this.data.floor?.geometry) return this.data.floor;
    const size = this.data.floor
      ? { w: this.data.floor.width, d: this.data.floor.depth }
      : this.preview();
    if (!size) return null;
    const boundary: MultiPolygon = [
      [
        [
          [0, 0],
          [size.w, 0],
          [size.w, size.d],
          [0, size.d],
          [0, 0],
        ],
      ],
    ];
    return {
      ...(this.data.floor ?? {
        schema: 'floor/1',
        areas: [],
        labels: [],
        iconGroups: [],
        north: null,
        legend: [],
      }),
      width: size.w,
      depth: size.d,
      geometry: {
        schema: 'geometry/1',
        unit: 'm',
        boundary,
        hallBoundary: boundary,
        grid: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
        objects: [],
        zones: [],
        source: {
          documentId: 'manual',
          page: 1,
          regionId: 'hall',
          origin: [0, 0],
          metresPerUnit: 1,
        },
        review: { revision: 1, checks: [], acknowledgements: [] },
      },
    };
  });
  protected readonly floorPreview = computed(() => {
    const floor = this.baseFloor();
    return floor ? { ...floor, ...this.annotations() } : null;
  });
  protected readonly busy = signal(false);

  constructor() {
    if (this.data.hall) {
      this.form.controls.width.disable();
      this.form.controls.depth.disable();
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || !this.annotationsValid()) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const value = this.form.getRawValue();
    const details = {
      name: value.name.trim(),
      code: value.code.trim() || null,
      level: value.level.trim() || null,
      uses: value.uses,
      ...(this.floorPreview()
        ? {
            annotations: this.annotations(),
            ...(this.data.hall ? { expectedVersion: this.data.hall.currentVersion } : {}),
          }
        : {}),
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
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
