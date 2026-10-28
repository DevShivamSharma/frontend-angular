import { DatePipe, DecimalPipe, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { catchError, map, of } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { ImageFallbackDirective } from '../../../../shared/ui/placeholder-image/image-fallback.directive';
import { PLACEHOLDER_IMAGE } from '../../../../shared/ui/placeholder-image/placeholder-image';
import { applyServerErrors } from '../../../../shared/utils/form.util';
import { CategoriesApiService } from '../../../categories/data/categories-api.service';
import { categoryGroups as onlyCategoryGroups } from '../../../categories/domain/category-groups';
import { ItpoHall } from '../../../halls/data/halls.models';
import { ItpoHallsApiService } from '../../../halls/data/itpo-halls-api.service';
import { EventConfigBody } from '../../data/event-config-api.service';
import { CreateEventPayload, EVENT_KINDS, Organisation } from '../../data/events.models';
import { createEventForm, toCreatePayload } from '../../domain/event.form';
import { EventConfigTabComponent } from '../event-config-tab/event-config-tab.component';
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
    FormsModule,
    DialogModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    TextareaModule,
    ToggleSwitchModule,
    FormFieldComponent,
    EmptyStateComponent,
    ImageFallbackDirective,
    EventConfigTabComponent,
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
  /** The organisations could not be loaded: said under the field, with a retry. */
  readonly organisationsFailed = input(false);
  readonly retryOrganisations = output<void>();
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
    halls: 'The ITPO halls the event uses. They are added as soon as the event is created.',
    booking:
      'How stalls are booked: dates, marquee, food and beverage. Optional now; it is saved with the event once complete.',
    review: 'Check each section. Open any section to see it in full.',
  };

  private readonly hallsApi = inject(ItpoHallsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  protected readonly placeholder = PLACEHOLDER_IMAGE;
  /** ITPO's active halls, to choose the event's from (as the Add halls dialog lists them). */
  protected readonly halls = signal<ItpoHall[]>([]);
  protected readonly hallsLoading = signal(false);
  protected readonly hallsFailed = signal(false);
  protected readonly chosenHalls = signal<number[]>([]);
  private readonly booking = viewChild(EventConfigTabComponent);
  /** Fields of the booking setup left to fill; it is optional, so these only show on Review. */
  protected readonly bookingIncomplete = signal(0);
  protected readonly chosenArea = computed(() =>
    this.halls()
      .filter((hall) => this.chosenHalls().includes(hall.id))
      .reduce((sum, hall) => sum + (hall.hallAreaCapacity ?? 0), 0),
  );

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

  /** The required fields still empty or wrong, across the steps. */
  protected readonly reviewProblems = computed(() => {
    this.formEvents();
    return this.steps.reduce((n, step) => n + this.invalidCount(step.requiredControls ?? []), 0);
  });

  /** Each section once, with what it holds, for the Review step. */
  protected readonly reviewRows = computed(() => {
    this.formEvents();
    const v = this.form.getRawValue();
    const day = (d: Date | string | null) => (d ? formatDate(d, 'd MMM y', this.locale) : '');
    const join = (parts: unknown[]) => parts.filter(Boolean).join(' · ');
    const chosen = this.halls().filter((hall) => this.chosenHalls().includes(hall.id));
    const summaries: Partial<Record<WizardStepId, string>> = {
      event: join([
        this.organisationName(v.organisationId) === '—' ? '' : this.organisationName(v.organisationId),
        v.name,
        v.startDate && v.endDate ? `${day(v.startDate)} to ${day(v.endDate)}` : '',
        v.eventType,
      ]),
      description: join([v.productProfile, v.specificProductProfile]),
      organiser: join([
        v.eventFormat,
        v.coOrganizerName && `Co-organiser: ${v.coOrganizerName}`,
        v.fileNumber,
      ]),
      schedule:
        v.exhibitionStartDate && v.exhibitionEndDate
          ? `${day(v.exhibitionStartDate)} to ${day(v.exhibitionEndDate)}` +
            (v.startTimeOfEvent ? ` · ${v.startTimeOfEvent}–${v.endTimeOfEvent ?? ''}` : '')
          : '',
      numbers: join([
        v.expectedNumberOfVisitor !== null && `${v.expectedNumberOfVisitor} visitors`,
        v.expectedNumberOfExhibitors !== null && `${v.expectedNumberOfExhibitors} exhibitors`,
        v.noOfStalls !== null && `${v.noOfStalls} stalls`,
      ]),
      settings: join([
        v.allowOverseasUser && 'Overseas exhibitors',
        v.visibility === 'show' ? 'In the public list' : 'Not in the public list',
      ]),
      halls: chosen.map((hall) => hall.name).join(', '),
      booking: this.bookingIncomplete()
        ? `${this.bookingIncomplete()} incomplete; can be completed after the event is created`
        : 'Complete',
    };
    return this.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.id !== 'review')
      .map(({ step, index }) => {
        const missing = this.invalidCount(step.requiredControls ?? []);
        return {
          index,
          label: step.label,
          state: missing ? 'todo' : step.id === 'booking' ? 'optional' : 'done',
          summary: missing
            ? `${missing} ${missing === 1 ? 'field' : 'fields'} to complete`
            : (summaries[step.id] ?? ''),
        };
      });
  });

  private invalidCount(controls: readonly string[]): number {
    return controls.filter((name) => this.form.get(name)?.invalid).length;
  }

  /** The public-list switch stands for the visibility choice. */
  protected setPublic(on: boolean): void {
    this.form.controls.visibility.setValue(on ? 'show' : 'hide');
    this.form.controls.visibility.markAsDirty();
  }

  constructor() {
    this.loadHalls();
  }

  protected loadHalls(): void {
    this.hallsLoading.set(true);
    this.hallsFailed.set(false);
    this.hallsApi
      .halls({ page: 1, size: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.halls.set(page.items.filter((hall) => hall.isActive));
          this.hallsLoading.set(false);
        },
        error: () => {
          this.hallsLoading.set(false);
          this.hallsFailed.set(true);
        },
      });
  }

  protected toggleHall(id: number): void {
    this.chosenHalls.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  protected thumbnail(hall: ItpoHall): string | null {
    return (hall.images.find((image) => image.kind === 'cover') ?? hall.images[0])?.url ?? null;
  }

  /** The booking setup filled in on its step, for the page to save once the event exists. */
  bookingBody(): Omit<EventConfigBody, 'eventId'> | null {
    return this.booking()?.draftBody() ?? null;
  }

  /** The halls chosen on the Halls step, for the page to add once the event exists. */
  chosenHallIds(): number[] {
    return this.chosenHalls();
  }

  /** Opens the dialog for a fresh event: empty form, back at the first step. */
  open(): void {
    this.form.reset();
    this.chosenHalls.set([]);
    this.stepIndex.set(0);
    this.visible.set(true);
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty || this.chosenHalls().length > 0;
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
