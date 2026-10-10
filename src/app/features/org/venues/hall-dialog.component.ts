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
import { TextareaModule } from 'primeng/textarea';

import type { Point } from '../../../core/venues/floor-plan.models';
import {
  cornersText,
  defaultParams,
  extent,
  HALL_SHAPES,
  HallShapeId,
  MAX_SIDE,
  outlineArea,
  outlineOf,
  parseCorners,
  shapeById,
} from './hall-shapes';

export interface HallDialogData {
  slug: string;
  venueId: string;
  /** The hall to edit; absent to draw a new, empty one. */
  hall?: HallView;
  floor?: HallFloor;
}

/** A custom outline is drawn on at least this much floor, metres. */
const DRAW_AREA = { width: 60, depth: 40 };
/** The sample outline the custom shape's button shows. */
const CUSTOM_SAMPLE: Point[] = [
  [0, 8],
  [14, 0],
  [40, 4],
  [36, 30],
  [8, 26],
];

/**
 * Creates an empty hall of any shape, all of it open for stalls: a rectangle by width and depth,
 * an L, a U, a fan or a round by their measurements, or any outline by its corners.
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
    TextareaModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ data.hall ? 'Edit hall' : 'New hall by size' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content">
        @if (!data.hall) {
          <p class="muted intro">
            Pick the hall's shape and give its measurements. It starts empty, with a 1 m grid, open
            for stalls.
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
          <div class="shapes" role="radiogroup" aria-label="Hall shape">
            @for (s of shapes; track s.id) {
              <button
                type="button"
                class="shape"
                role="radio"
                [attr.aria-checked]="shape() === s.id"
                [class.on]="shape() === s.id"
                (click)="shape.set(s.id)"
              >
                <svg viewBox="-2 -2 44 34" aria-hidden="true">
                  <polygon [attr.points]="thumbs[s.id]" />
                </svg>
                <span>{{ s.label }}</span>
              </button>
            }
          </div>
          <p class="muted example">{{ shapeInfo().example }}</p>
          @switch (shape()) {
            @case ('rectangle') {
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
            }
            @case ('custom') {
              <div class="custom">
                <svg
                  class="draw"
                  [attr.viewBox]="drawBox()"
                  (click)="addCorner($event)"
                  role="img"
                  aria-label="Click to add a corner of the hall"
                >
                  @for (g of gridLines(); track $index) {
                    <line [attr.x1]="g[0]" [attr.y1]="g[1]" [attr.x2]="g[2]" [attr.y2]="g[3]" />
                  }
                  @if (corners().length > 2) {
                    <polygon class="outline" [attr.points]="pointsAttr(corners())" />
                  } @else if (corners().length === 2) {
                    <polyline class="outline" [attr.points]="pointsAttr(corners())" />
                  }
                  @for (c of corners(); track $index) {
                    <circle [attr.cx]="c[0]" [attr.cy]="c[1]" [attr.r]="dotSize()" />
                  }
                </svg>
                <div class="corners">
                  <label for="hall-corners">Corners, in order: x, y in metres, one per line</label>
                  <textarea
                    id="hall-corners"
                    pTextarea
                    rows="7"
                    [value]="cornersText()"
                    (input)="typeCorners($any($event.target).value)"
                  ></textarea>
                  @if (cornersError()) {
                    <span class="error small">Write each corner as two numbers, e.g. 40, 30.</span>
                  }
                  <span class="row">
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="corners.set(corners().slice(0, -1))"
                      [disabled]="!corners().length"
                    >
                      Remove last corner
                    </button>
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="corners.set([])"
                      [disabled]="!corners().length"
                    >
                      Clear
                    </button>
                  </span>
                  <span class="muted small"
                    >Click on the grid to add corners; it snaps to 0.5 m.</span
                  >
                </div>
              </div>
            }
            @default {
              <div class="params">
                @for (q of shapeInfo().params; track q.key) {
                  <app-field
                    [label]="q.label"
                    [for]="'hall-shape-' + q.key"
                    [error]="q.min + ' to ' + q.max"
                  >
                    <p-inputgroup>
                      <input
                        [id]="'hall-shape-' + q.key"
                        pInputText
                        type="number"
                        [min]="q.min"
                        [max]="q.max"
                        [step]="q.step"
                        [value]="params()[q.key]"
                        (input)="setParam(q.key, $any($event.target).valueAsNumber)"
                      />
                      @if (q.unit) {
                        <p-inputgroup-addon>{{ q.unit }}</p-inputgroup-addon>
                      }
                    </p-inputgroup>
                  </app-field>
                }
              </div>
            }
          }
          @if (outline(); as o) {
            @if (o.ring) {
              <p class="muted area">
                {{ size().width | number: '1.0-2' }} × {{ size().depth | number: '1.0-2' }} m ·
                {{ area() | number: '1.0-0' }} m² of floor
              </p>
            } @else if (shape() !== 'rectangle') {
              <p class="error" role="alert">{{ o.error }}</p>
            }
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
        <button
          pButton
          type="submit"
          [disabled]="busy() || !annotationsValid() || (!data.hall && !outline()?.ring)"
        >
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
    .shapes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 8px;
      margin-bottom: 6px;
    }
    .shape {
      display: grid;
      justify-items: center;
      gap: 4px;
      padding: 8px 4px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      background: var(--app-surface-container-lowest);
      color: var(--app-on-surface);
      font: var(--app-label-medium);
      cursor: pointer;
    }
    .shape.on {
      border: 2px solid var(--app-primary);
      padding: 7px 3px;
      background: color-mix(in srgb, var(--app-primary) 8%, var(--app-surface-container-lowest));
    }
    .shape svg {
      width: 44px;
      height: 34px;
    }
    .shape polygon {
      fill: color-mix(in srgb, var(--app-primary) 18%, transparent);
      stroke: var(--app-primary);
      stroke-width: 1.5;
      stroke-linejoin: round;
    }
    .example {
      margin: 0 0 10px;
      font: var(--app-body-small);
    }
    .params {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }
    .custom {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 12px;
      margin-bottom: 8px;
    }
    .draw {
      width: 100%;
      aspect-ratio: 3 / 2;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
      background: var(--app-surface-container-lowest);
      cursor: crosshair;
    }
    .draw line {
      stroke: var(--app-outline-variant);
      stroke-width: 0.1;
    }
    .draw .outline {
      fill: color-mix(in srgb, var(--app-primary) 15%, transparent);
      stroke: var(--app-primary);
      stroke-width: 0.3;
    }
    .draw circle {
      fill: var(--app-primary);
    }
    .corners {
      display: grid;
      gap: 6px;
      align-content: start;
      font: var(--app-label-medium);
    }
    .corners textarea {
      width: 100%;
      font-family: ui-monospace, monospace;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .small {
      font: var(--app-body-small);
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
    @media (max-width: 560px) {
      .custom {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 480px) {
      .pair,
      .params {
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

  protected readonly shapes = HALL_SHAPES;
  /** A small picture of each shape, for its button. */
  protected readonly thumbs = Object.fromEntries(
    HALL_SHAPES.map((s) => [s.id, thumb(s.id)]),
  ) as Record<HallShapeId, string>;
  protected readonly shape = signal<HallShapeId>('rectangle');
  protected readonly shapeInfo = computed(() => shapeById(this.shape()));
  /** Each shape's measurements, kept while another shape is looked at. */
  private readonly allParams = signal<Record<string, Record<string, number>>>({});
  protected readonly params = computed(
    () => this.allParams()[this.shape()] ?? defaultParams(this.shape()),
  );
  /** The custom outline's corners, in order. */
  protected readonly corners = signal<Point[]>([]);
  protected readonly cornersError = signal(false);
  private readonly typed = signal<string | null>(null);
  protected readonly cornersText = computed(() => this.typed() ?? cornersText(this.corners()));

  /** The new hall's outline, or why its measurements make none. */
  protected readonly outline = computed(() => {
    if (this.data.hall) return null;
    if (this.shape() === 'rectangle') {
      const { width, depth } = this.value();
      return outlineOf('rectangle', { width: Number(width), depth: Number(depth) });
    }
    return outlineOf(this.shape(), this.params(), this.corners());
  });
  protected readonly size = computed(() => {
    const ring = this.outline()?.ring;
    return ring ? extent(ring) : { width: 0, depth: 0 };
  });
  protected readonly area = computed(() => {
    const ring = this.outline()?.ring;
    return ring ? outlineArea(ring) : 0;
  });

  /** The floor the custom outline is drawn on: at least {@link DRAW_AREA}, and all its corners. */
  private readonly drawSize = computed(() => {
    const c = this.corners();
    return {
      width: Math.max(DRAW_AREA.width, ...c.map((p) => p[0] + 5)),
      depth: Math.max(DRAW_AREA.depth, ...c.map((p) => p[1] + 5)),
    };
  });
  protected readonly drawBox = computed(() => {
    const { width, depth } = this.drawSize();
    return `-1 -1 ${width + 2} ${depth + 2}`;
  });
  protected readonly dotSize = computed(() => Math.max(0.4, this.drawSize().width / 120));
  protected readonly gridLines = computed(() => {
    const { width, depth } = this.drawSize();
    const lines: Array<[number, number, number, number]> = [];
    for (let x = 0; x <= width; x += 5) lines.push([x, 0, x, depth]);
    for (let y = 0; y <= depth; y += 5) lines.push([0, y, width, y]);
    return lines;
  });

  private readonly baseFloor = computed<HallFloor | null>(() => {
    if (this.data.hall && !this.data.floor) return null;
    if (this.data.floor?.geometry) return this.data.floor;
    let size: { w: number; d: number };
    let ring: Point[];
    if (this.data.floor) {
      size = { w: this.data.floor.width, d: this.data.floor.depth };
      ring = [
        [0, 0],
        [size.w, 0],
        [size.w, size.d],
        [0, size.d],
      ];
    } else {
      const outline = this.outline()?.ring;
      if (!outline) return null;
      const e = extent(outline);
      size = { w: e.width, d: e.depth };
      ring = outline;
    }
    const boundary: MultiPolygon = [[[...ring, ring[0]]]];
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

  protected setParam(key: string, value: number): void {
    const shape = this.shape();
    this.allParams.update((all) => ({
      ...all,
      [shape]: { ...(all[shape] ?? defaultParams(shape)), [key]: value },
    }));
  }

  /** A click on the grid adds a corner there, snapped to half a metre. */
  protected addCorner(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const snap = (n: number) => Math.max(0, Math.round(n * 2) / 2);
    this.typed.set(null);
    this.cornersError.set(false);
    this.corners.update((c) => [...c, [snap(at.x), snap(at.y)]]);
  }

  protected typeCorners(text: string): void {
    this.typed.set(text);
    const points = parseCorners(text);
    this.cornersError.set(points === null);
    if (points) this.corners.set(points);
  }

  protected pointsAttr(points: Point[]): string {
    return points.map((p) => p.join(',')).join(' ');
  }

  protected async submit(): Promise<void> {
    if (
      this.form.invalid ||
      !this.annotationsValid() ||
      (!this.data.hall && !this.outline()?.ring)
    ) {
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
              ...(this.shape() === 'rectangle'
                ? { width: value.width, depth: value.depth }
                : {
                    width: this.size().width,
                    depth: this.size().depth,
                    outline: this.outline()!.ring!,
                  }),
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

/** A shape's outline drawn into a 40 × 30 box, for its button. */
function thumb(id: HallShapeId): string {
  const ring = id === 'custom' ? CUSTOM_SAMPLE : outlineOf(id, defaultParams(id)).ring;
  if (!ring) return '';
  const { width, depth } = extent(ring);
  const k = Math.min(40 / width, 30 / depth);
  const dx = (40 - width * k) / 2;
  const dy = (30 - depth * k) / 2;
  return ring.map(([x, y]) => `${(dx + x * k).toFixed(1)},${(dy + y * k).toFixed(1)}`).join(' ');
}
