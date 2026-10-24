import {
  AbstractControl,
  FormBuilder,
  FormControl,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { fromIsoDate } from '../../../shared/utils/date.util';
import { changedValues, filledValues } from '../../../shared/utils/form.util';
import { plainText } from '../../../shared/utils/text.util';
import {
  CreateEventPayload,
  EventDetails,
  EventKind,
  UpdateEventPayload,
} from '../data/events.models';

export type VisibilityChoice = 'keep' | 'show' | 'hide';

const text = (max: number) =>
  new FormControl('', { nonNullable: true, validators: [Validators.maxLength(max)] });
const count = (max: number) =>
  new FormControl<number | null>(null, [Validators.min(0), Validators.max(max)]);

/**
 * The form of an internal event. When creating, the organisation, name and dates are required and
 * the visibility starts hidden; when editing, nothing is required of what is already saved and the
 * visibility starts as "leave as it is" (the portal does not know the current one).
 */
export function createEventForm(fb: FormBuilder, mode: 'create' | 'edit') {
  return fb.group(
    {
      organisationId: new FormControl<string | null>(
        null,
        mode === 'create' ? [Validators.required] : [],
      ),
      name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(200)],
      }),
      startDate: new FormControl<Date | null>(null, [Validators.required]),
      endDate: new FormControl<Date | null>(null, [Validators.required]),
      eventType: new FormControl<EventKind | null>(null),
      eventFormat: text(70),
      coOrganizerName: text(500),
      productCategory: text(100),
      description: text(5000),
      productProfile: text(2000),
      specificProductProfile: text(2000),
      specialRequest: text(2000),
      remarks: text(2000),
      fileNumber: text(150),
      exhibitionStartDate: new FormControl<Date | null>(null),
      exhibitionEndDate: new FormControl<Date | null>(null),
      startTimeOfEvent: text(20),
      endTimeOfEvent: text(20),
      expectedNumberOfVisitor: count(100_000_000),
      expectedNumberOfExhibitors: count(100_000_000),
      noOfStalls: count(1_000_000),
      noOfFnbStalls: count(1_000_000),
      maxCategoriesForRegistration: count(1000),
      allowOverseasUser: [false],
      isMarqueeEnabled: [false],
      isSecondaryEnabled: [false],
      visibility: new FormControl<VisibilityChoice>(mode === 'create' ? 'hide' : 'keep', {
        nonNullable: true,
      }),
    },
    {
      validators: [
        datesInOrder(
          'startDate',
          'endDate',
          'eventDates',
          'The event cannot end before it starts.',
        ),
        datesInOrder(
          'exhibitionStartDate',
          'exhibitionEndDate',
          'exhibitionDates',
          'The exhibition cannot end before it starts.',
        ),
      ],
    },
  );
}

export type EventForm = ReturnType<typeof createEventForm>;

/** A pair of dates runs forwards (an empty one is not this validator's concern). */
function datesInOrder(startName: string, endName: string, errorKey: string, message: string) {
  return (group: AbstractControl): ValidationErrors | null => {
    const start = group.get(startName)?.value as Date | null;
    const end = group.get(endName)?.value as Date | null;
    return start && end && end < start ? { [errorKey]: message } : null;
  };
}

/** The create call for a filled form. */
export function toCreatePayload(form: EventForm): CreateEventPayload {
  const { visibility, ...rest } = filledValues(form);
  const payload = rest as unknown as CreateEventPayload;
  if (visibility === 'show') payload.visibilityStatus = true;
  return payload;
}

/** The edit call for what the user changed, and only that. */
export function toUpdatePayload(form: EventForm): UpdateEventPayload {
  const { visibility, organisationId: _organisation, ...changed } = changedValues(form);
  const payload = changed as UpdateEventPayload;
  if (visibility === 'show') payload.visibilityStatus = true;
  if (visibility === 'hide') payload.visibilityStatus = false;
  return payload;
}

/** What the form is filled with: the event as ITPO has it (only the name and dates are certain). */
export type KnownEvent = {
  name: string;
  startDate: string | null;
  endDate: string | null;
} & Partial<Omit<EventDetails, 'name' | 'startDate' | 'endDate'>>;

/** ITPO has older events with their own spellings of the type; the form offers three kinds. */
function kindOf(type: string | null | undefined): EventKind | null {
  const text = type?.toUpperCase() ?? '';
  if (text.includes('B2B') && text.includes('B2C')) return 'B2B & B2C both';
  if (text.includes('B2B')) return 'B2B';
  if (text.includes('B2C')) return 'B2C';
  return null;
}

/** Fills the edit form with the event as it is, so the user changes only what they mean to. */
export function patchKnownFields(form: EventForm, known: KnownEvent): void {
  form.patchValue({
    name: known.name,
    startDate: fromIsoDate(known.startDate),
    endDate: fromIsoDate(known.endDate),
    eventType: kindOf(known.eventType),
    eventFormat: known.eventFormat ?? '',
    coOrganizerName: known.coOrganizer ?? '',
    description: plainText(known.description),
    productProfile: plainText(known.productProfile),
    specificProductProfile: plainText(known.specificProductProfile),
    productCategory: known.productCategory ?? '',
    specialRequest: plainText(known.specialRequest),
    remarks: plainText(known.remarks),
    fileNumber: known.fileNumber ?? '',
    exhibitionStartDate: fromIsoDate(known.exhibitionStartDate),
    exhibitionEndDate: fromIsoDate(known.exhibitionEndDate),
    startTimeOfEvent: known.startTime ?? '',
    endTimeOfEvent: known.endTime ?? '',
    expectedNumberOfVisitor: known.expectedVisitors ?? null,
    expectedNumberOfExhibitors: known.expectedExhibitors ?? null,
    noOfStalls: known.noOfStalls ?? null,
    maxCategoriesForRegistration: known.maxCategoriesForRegistration ?? null,
    allowOverseasUser: known.allowOverseasUser ?? false,
    isMarqueeEnabled: known.isMarqueeEnabled ?? false,
    isSecondaryEnabled: known.isSecondaryEnabled ?? false,
    visibility: known.visible === true ? 'show' : known.visible === false ? 'hide' : 'keep',
  });
}
