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
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: 'event',
    label: 'Event',
    requiredControls: ['organisationId', 'name', 'startDate', 'endDate'],
  },
  { id: 'description', label: 'Description and notes' },
  { id: 'organiser', label: 'Format and organiser' },
  { id: 'schedule', label: 'Exhibition days and timings' },
  { id: 'numbers', label: 'Expected numbers' },
  { id: 'settings', label: 'Settings' },
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
