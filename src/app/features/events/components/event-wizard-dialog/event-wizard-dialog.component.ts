import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { catchError, map, of } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { applyServerErrors } from '../../../../shared/utils/form.util';
import { CategoriesApiService } from '../../../categories/data/categories-api.service';
import { categoryGroups as onlyCategoryGroups } from '../../../categories/domain/category-groups';
import { CreateEventPayload, EVENT_KINDS, Organisation } from '../../data/events.models';
import { createEventForm, toCreatePayload } from '../../domain/event.form';
import {
  WizardStepId,
  WIZARD_STEPS,
  firstInvalidStepIndex,
  wizardCompletedCount,
  wizardStepStatus,
} from '../../domain/event-wizard-steps';

/** Step-by-step dialog for creating an internal event. */
@Component({
  selector: 'app-event-wizard-dialog',
  imports: [
    ReactiveFormsModule,
    DialogModule,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    TextareaModule,
    ToggleSwitchModule,
    FormFieldComponent,
    EmptyStateComponent,
    DatePipe,
    DecimalPipe,
  ],
  templateUrl: './event-wizard-dialog.component.html',
  styleUrl: './event-wizard-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class EventWizardDialogComponent {
  readonly visible = model(false);
  readonly organisations = input<Organisation[]>([]);
  readonly organisationsLoading = input(false);
  readonly submitting = input(false);
  readonly failure = input<string | null>(null);
  readonly created = output<CreateEventPayload>();
  readonly cancelled = output<void>();

  private readonly fb = inject(FormBuilder);
  protected readonly form = createEventForm(this.fb, 'create');
  protected readonly steps = WIZARD_STEPS;
  protected readonly stepIndex = signal(0);
  protected readonly kinds = EVENT_KINDS.map((kind) => ({ label: kind, value: kind }));
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
  protected readonly subtitles: Partial<Record<WizardStepId, string>> = {
    event: 'The event’s name, the organisation it is booked under, and its tenancy dates.',
    description: 'Background on the event, for ITPO’s own records.',
    organiser: 'How the event runs, who co-organises it, and its file reference.',
    schedule: 'When the exhibition is open to visitors, and its daily hours.',
    numbers: 'The visitors, exhibitors and stalls the event expects.',
    settings: 'Who may register, and whether the event shows in the public list.',
    review: 'Check the details before you create the event.',
  };
  protected readonly visibilityOptions = [
    { label: 'Hidden', value: 'hide' },
    { label: 'Show in the public list', value: 'show' },
  ];

  // FormControl.valid is not a signal; reading this makes every caller re-evaluate on form changes.
  private readonly formEvents = toSignal(this.form.events);
  protected readonly isValid = (controls: readonly string[]): boolean => {
    this.formEvents();
    return controls.every((name) => this.form.get(name)?.valid ?? true);
  };
  protected readonly completed = computed(() =>
    wizardCompletedCount(this.steps, this.stepIndex(), this.isValid),
  );
  protected status(index: number) {
    return wizardStepStatus(this.steps[index], index, this.stepIndex(), this.isValid);
  }
  protected readonly eventStepValid = computed(() =>
    this.isValid(this.steps[0].requiredControls ?? []),
  );

  /** The chosen organisation's name, for the Review step; an em dash if none is chosen yet. */
  protected organisationName(id: string | null): string {
    return this.organisations().find((org) => org.id === id)?.name ?? '—';
  }

  /** The visibility choice's label, for the Review step. */
  protected visibilityLabel(value: string): string {
    return this.visibilityOptions.find((option) => option.value === value)?.label ?? '—';
  }

  /** Opens the dialog for a fresh event: empty form, back at the first step. */
  open(): void {
    this.form.reset();
    this.stepIndex.set(0);
    this.visible.set(true);
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  /** Puts the fields an API refused on their controls; true if any matched. */
  applyError(error: ApiError): boolean {
    const matched = applyServerErrors(this.form, error);
    if (matched) this.showFirstInvalidStep();
    return matched;
  }

  /** Moves to the first step that shows an error (not gated: the error is the reason to go there). */
  private showFirstInvalidStep(): void {
    const index = firstInvalidStepIndex(
      this.steps,
      (name) => this.form.get(name)?.invalid ?? false,
      (key) => !!this.form.errors?.[key],
    );
    this.stepIndex.set(Math.max(0, index));
  }

  /** Jumps to a step; every step past the Event one is locked until that one is valid. */
  protected goTo(index: number): void {
    if (index > 0 && !this.eventStepValid()) return;
    this.stepIndex.set(index);
  }

  protected back(): void {
    this.stepIndex.update((i) => Math.max(0, i - 1));
  }

  protected next(): void {
    if (this.stepIndex() === 0 && !this.eventStepValid()) {
      for (const name of this.steps[0].requiredControls ?? []) {
        this.form.get(name)?.markAsTouched();
      }
      return;
    }
    this.stepIndex.update((i) => Math.min(this.steps.length - 1, i + 1));
  }

  /** Only asks to leave; the page decides, so the dialog stays if the user chooses to stay. */
  protected cancel(): void {
    this.cancelled.emit();
  }

  /** PrimeNG overlays (select, datepicker) preventDefault when Escape closes their panel; leave those alone. */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented) return;
    if (this.visible() && !this.submitting()) this.cancel();
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.showFirstInvalidStep();
      return;
    }
    this.created.emit(toCreatePayload(this.form));
  }
}
