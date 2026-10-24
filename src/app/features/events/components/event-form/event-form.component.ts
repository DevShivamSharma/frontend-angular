import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { catchError, map, of } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { CategoriesApiService } from '../../../categories/data/categories-api.service';
import { categoryGroups as onlyCategoryGroups } from '../../../categories/domain/category-groups';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { applyServerErrors } from '../../../../shared/utils/form.util';
import {
  CreateEventPayload,
  EVENT_KINDS,
  Organisation,
  UpdateEventPayload,
} from '../../data/events.models';
import {
  createEventForm,
  KnownEvent,
  patchKnownFields,
  toCreatePayload,
  toUpdatePayload,
} from '../../domain/event.form';

/** The fields of an internal event, for creating one or editing one; the page decides what saving does. */
@Component({
  selector: 'app-event-form',
  imports: [
    ReactiveFormsModule,
    AccordionModule,
    ButtonModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
    ToggleSwitchModule,
    FormFieldComponent,
  ],
  templateUrl: './event-form.component.html',
  styleUrl: './event-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFormComponent {
  readonly mode = input.required<'create' | 'edit'>();
  /** Create: the organisations to book the event under. */
  readonly organisations = input<Organisation[]>([]);
  readonly organisationsLoading = input(false);
  /** Edit: what the portal already knows of the event. */
  readonly known = input<KnownEvent | null>(null);
  readonly submitting = input(false);
  readonly failure = input<string | null>(null);

  readonly created = output<CreateEventPayload>();
  readonly edited = output<UpdateEventPayload>();
  readonly cancelled = output<void>();

  private readonly fb = inject(FormBuilder);
  /** The groups of categories an event can take its product category from. */
  protected readonly categoryGroups = toSignal(
    inject(CategoriesApiService)
      .groups()
      .pipe(
        map(onlyCategoryGroups),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );
  // Built once per mode, which a page never changes.
  protected readonly form = createEventForm(this.fb, 'create');
  protected readonly editForm = createEventForm(this.fb, 'edit');

  protected readonly kinds = EVENT_KINDS.map((kind) => ({ label: kind, value: kind }));

  constructor() {
    effect(() => {
      const known = this.known();
      untracked(() => {
        if (known && this.mode() === 'edit') {
          patchKnownFields(this.editForm, known);
          this.editForm.markAsPristine();
        }
      });
    });
  }

  /** The form in use. */
  protected get active() {
    return this.mode() === 'create' ? this.form : this.editForm;
  }

  protected get visibilityOptions() {
    return this.mode() === 'create'
      ? [
          { label: 'Hidden', value: 'hide' },
          { label: 'Show in the public list', value: 'show' },
        ]
      : [
          { label: 'Leave as it is', value: 'keep' },
          { label: 'Show in the public list', value: 'show' },
          { label: 'Hide from the public list', value: 'hide' },
        ];
  }

  hasUnsavedChanges(): boolean {
    return this.active.dirty;
  }

  /** Puts the fields an API refused on their inputs; false if none of them is here. */
  applyError(error: ApiError): boolean {
    return applyServerErrors(this.active, error);
  }

  protected submit(): void {
    const form = this.active;
    form.markAllAsTouched();
    if (form.invalid) {
      return;
    }
    if (this.mode() === 'create') {
      this.created.emit(toCreatePayload(this.form));
    } else {
      this.edited.emit(toUpdatePayload(this.editForm));
    }
  }
}
