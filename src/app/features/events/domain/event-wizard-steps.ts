export type WizardStepId =
  | 'event'
  | 'description'
  | 'organiser'
  | 'schedule'
  | 'numbers'
  | 'settings'
  | 'halls'
  | 'booking'
  | 'review';

export interface WizardStep {
  id: WizardStepId;
  label: string;
  note?: string;
  requiredControls?: readonly string[];
  /** Every form control shown on this step. */
  controls?: readonly string[];
  /** The form-group error keys shown on this step. */
  groupErrors?: readonly string[];
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: 'event',
    label: 'Event',
    requiredControls: ['organisationId', 'name', 'startDate', 'endDate'],
    controls: ['organisationId', 'name', 'startDate', 'endDate', 'eventType'],
    groupErrors: ['eventDates'],
  },
  {
    id: 'description',
    label: 'Description and notes',
    controls: ['description', 'productProfile', 'specificProductProfile', 'specialRequest', 'remarks'],
  },
  {
    id: 'organiser',
    label: 'Format and organiser',
    controls: ['eventFormat', 'coOrganizerName', 'productCategory', 'fileNumber'],
  },
  {
    id: 'schedule',
    label: 'Exhibition days and timings',
    controls: ['exhibitionStartDate', 'exhibitionEndDate', 'startTimeOfEvent', 'endTimeOfEvent'],
    groupErrors: ['exhibitionDates'],
  },
  {
    id: 'numbers',
    label: 'Expected numbers',
    controls: [
      'expectedNumberOfVisitor',
      'expectedNumberOfExhibitors',
      'noOfStalls',
      'noOfFnbStalls',
      'maxCategoriesForRegistration',
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    controls: ['allowOverseasUser', 'isMarqueeEnabled', 'isSecondaryEnabled', 'visibility'],
  },
  { id: 'halls', label: 'Halls', note: 'Added after the event is created' },
  { id: 'booking', label: 'Booking setup', note: 'Optional now' },
  { id: 'review', label: 'Review' },
];

export type WizardStepStatus = 'done' | 'current' | 'upcoming';

/** The steps before the event exists; the halls, booking and review steps come after creation. */
const PRE_CREATION_STEP_COUNT = 6;

/** A passed step is done only once its required controls are valid. */
export function wizardStepStatus(
  step: WizardStep,
  index: number,
  currentIndex: number,
  isValid: (controls: readonly string[]) => boolean,
): WizardStepStatus {
  if (index === currentIndex) return 'current';
  if (index > currentIndex) return 'upcoming';
  if (
    step.requiredControls &&
    step.requiredControls.length > 0 &&
    !isValid(step.requiredControls)
  ) {
    return 'upcoming';
  }
  return 'done';
}

export function wizardCompletedCount(
  steps: readonly WizardStep[],
  currentIndex: number,
  isValid: (controls: readonly string[]) => boolean,
): { done: number; total: number } {
  const done = steps
    .slice(0, PRE_CREATION_STEP_COUNT)
    .filter((step) => isValid(step.requiredControls ?? [])).length;
  return { done, total: PRE_CREATION_STEP_COUNT };
}

/** The first step showing an invalid control or a group error, so the user lands where it is visible; -1 if none. */
export function firstInvalidStepIndex(
  steps: readonly WizardStep[],
  isControlInvalid: (name: string) => boolean,
  hasGroupError: (key: string) => boolean,
): number {
  return steps.findIndex(
    (step) =>
      (step.controls ?? []).some(isControlInvalid) || (step.groupErrors ?? []).some(hasGroupError),
  );
}
