import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { startWith } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { HasUnsavedChanges } from '../../../../shared/guards/unsaved-changes.guard';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { applyServerErrors } from '../../../../shared/utils/form.util';
import { HallNotesEditorComponent } from '../../components/hall-notes-editor/hall-notes-editor.component';
import { HallImagesEditorComponent } from '../../components/hall-images-editor/hall-images-editor.component';
import { CornerEditorComponent } from '../../components/corner-editor/corner-editor.component';
import { HallCanvasComponent } from '../../components/hall-canvas/hall-canvas.component';
import { ShapePickerComponent } from '../../components/shape-picker/shape-picker.component';
import { HallsApiService } from '../../data/halls-api.service';
import { HallCategory } from '../../data/halls.models';
import { ItpoHallsApiService } from '../../data/itpo-halls-api.service';
import { isNtaCategory } from '../../domain/hall-category';
import { createImageGroup, ImageGroup, toImagePayloads } from '../../domain/hall-images.form';
import { HallNotes, NO_NOTES, notesProblem, toNotesPayload } from '../../domain/hall-notes';
import { buildHallPayload } from '../../domain/hall-payload';
import { Corner } from '../../domain/hall-shape.model';
import { defaultParams, HALL_SHAPES, outlineOf, shapeById } from '../../domain/hall-shapes';
import { extent, outlineArea } from '../../domain/outline-geometry';

type CategoriesState = 'loading' | 'ready' | 'failed';

/** Creating a hall by drawing it by size: its shape and measurements, and the details ITPO keeps. */
@Component({
  selector: 'app-hall-create-page',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    SelectButtonModule,
    ToggleSwitchModule,
    FormFieldComponent,
    PageHeaderComponent,
    ShapePickerComponent,
    HallCanvasComponent,
    CornerEditorComponent,
    HallImagesEditorComponent,
    HallNotesEditorComponent,
  ],
  templateUrl: './hall-create-page.component.html',
  styleUrl: './hall-create-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallCreatePageComponent implements HasUnsavedChanges {
  private readonly hallsApi = inject(HallsApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly itpoApi = inject(ItpoHallsApiService);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly shapes = HALL_SHAPES;
  protected readonly complimentaryOptions = [
    { label: 'None', value: 0 },
    { label: '1 day', value: 1 },
  ];

  protected readonly form = inject(FormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    categoryId: [null as number | null],
    capacity: [null as number | null, [Validators.min(0)]],
    isPopular: [false],
    isVipLounge: [false],
    isAvailableForFnB: [false],
    complimentaryDays: [0 as 0 | 1],
    sortOrder: [null as number | null, [Validators.min(0), Validators.max(20)]],
    images: new FormArray<ImageGroup>([]),
  });

  // The shape: which one, its measurements, and (for a custom one) its corners.
  protected readonly shapeId = signal('rectangle');
  protected readonly params = signal<Record<string, number>>(defaultParams('rectangle'));
  protected readonly corners = signal<Corner[]>([]);

  protected readonly shape = computed(() => shapeById(this.shapeId()));
  protected readonly outline = computed(() =>
    outlineOf(this.shapeId(), this.params(), this.corners()),
  );
  protected readonly isCustom = computed(() => this.shapeId() === 'custom');

  /** A custom outline with no corners yet is not an error, only not started. */
  protected readonly outlineMessage = computed(() => {
    const { error } = this.outline();
    return error && !(this.isCustom() && this.corners().length === 0) ? error : null;
  });

  protected readonly stats = computed(() => {
    const ring = this.outline().ring;
    if (!ring) return null;
    const { width, depth } = extent(ring);
    return {
      width,
      depth,
      footprint: Math.round(width * depth * 100) / 100,
      floor: Math.round(outlineArea(ring) * 100) / 100,
    };
  });

  /** The helpers, text labels and legend put on the hall. */
  protected readonly notes = signal<HallNotes>(NO_NOTES);
  protected readonly notesProblem = computed(() => notesProblem(this.notes()));
  /** The grid the outline fits in, in whole metres: what a note's place is measured on. */
  protected readonly grid = computed(() => {
    const ring = this.outline().ring;
    if (!ring) return { columns: 1, rows: 1 };
    const { width, depth } = extent(ring);
    return { columns: Math.max(1, Math.ceil(width)), rows: Math.max(1, Math.ceil(depth)) };
  });

  protected readonly categories = signal<HallCategory[]>([]);
  protected readonly categoriesState = signal<CategoriesState>('loading');
  protected readonly submitting = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly categoryId = toSignal(
    this.form.controls.categoryId.valueChanges.pipe(startWith(null)),
    { initialValue: null },
  );
  /** As in SelfCare: an NTA hall has no VIP lounge, F&B, complementary days or order. */
  protected readonly isNta = computed(() =>
    isNtaCategory(this.categories().find((c) => c.id === this.categoryId())?.name),
  );

  private submitted = false;

  constructor() {
    this.loadCategories();
    effect(() => this.applyNtaRule(this.isNta()));
  }

  hasUnsavedChanges(): boolean {
    return (
      !this.submitted && (this.form.dirty || this.corners().length > 0 || this.notes() !== NO_NOTES)
    );
  }

  protected loadCategories(): void {
    this.categoriesState.set('loading');
    this.itpoApi
      .categories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
          this.categoriesState.set('ready');
        },
        error: () => this.categoriesState.set('failed'),
      });
  }

  protected selectShape(id: string): void {
    // Going custom from a shape starts from its outline, so it can be adjusted rather than redrawn.
    if (id === 'custom' && this.corners().length === 0) {
      const ring = this.outline().ring;
      if (ring) this.corners.set(ring.map(([x, y]): Corner => [x, y]));
    }
    this.shapeId.set(id);
    this.params.set(defaultParams(id));
  }

  protected setParam(key: string, value: number | null): void {
    this.params.update((current) => ({ ...current, [key]: value ?? Number.NaN }));
  }

  protected addCorner(corner: Corner): void {
    this.corners.update((corners) => [...corners, corner]);
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const ring = this.outline().ring;
    if (this.form.invalid || !ring || this.notesProblem()) {
      return;
    }

    const value = this.form.getRawValue();
    const payload = buildHallPayload(
      {
        name: value.name ?? '',
        hallCategoryId: value.categoryId,
        hallAreaCapacity: value.capacity,
        isPopular: value.isPopular ?? false,
        isVipLounge: value.isVipLounge ?? false,
        isAvailableForFnB: value.isAvailableForFnB ?? false,
        complimentaryDays: value.complimentaryDays ?? 0,
        sortOrder: value.sortOrder,
      },
      ring,
      this.isNta(),
      toImagePayloads(this.form.controls.images.controls),
      toNotesPayload(this.notes()),
    );

    const go = await this.confirm.ask({
      header: 'Create hall',
      message: `Create the hall "${payload.name}"? It is saved with ITPO's halls.`,
      acceptLabel: 'Create',
    });
    if (!go) {
      return;
    }

    this.submitting.set(true);
    this.failure.set(null);
    this.hallsApi
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hall) => {
          this.submitted = true;
          this.notifier.success(
            `${hall.name} created`,
            `Hall ${hall.hallId}, ${hall.area} m² of floor.`,
          );
          void this.router.navigate(['/halls', hall.hallId]);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.showFailure(error);
        },
      });
  }

  private showFailure(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.failure.set('Something went wrong. Please try again.');
      return;
    }
    if (error.code === 409) {
      // The only conflict a hall has is its name.
      this.form.controls.name.setErrors({ server: error.message });
      this.form.controls.name.markAsTouched();
      return;
    }
    if (!applyServerErrors(this.form, error)) {
      this.failure.set(error.message);
    }
  }

  private applyNtaRule(isNta: boolean): void {
    untracked(() => {
      const { isVipLounge, isAvailableForFnB, complimentaryDays, sortOrder } = this.form.controls;
      if (isNta) {
        isVipLounge.reset(false, { emitEvent: false });
        isAvailableForFnB.reset(false, { emitEvent: false });
        complimentaryDays.reset(0, { emitEvent: false });
        sortOrder.reset(null, { emitEvent: false });
        [isVipLounge, isAvailableForFnB, complimentaryDays, sortOrder].forEach((control) =>
          control.disable({ emitEvent: false }),
        );
      } else {
        [isVipLounge, isAvailableForFnB, complimentaryDays, sortOrder].forEach((control) =>
          control.enable({ emitEvent: false }),
        );
      }
    });
  }
}
