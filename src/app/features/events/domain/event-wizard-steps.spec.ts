import { FormBuilder } from '@angular/forms';

import { createEventForm } from './event.form';
import {
  WIZARD_STEPS,
  firstInvalidStepIndex,
  wizardCompletedCount,
  wizardStepStatus,
} from './event-wizard-steps';

describe('wizardStepStatus', () => {
  it('returns current for the step at currentIndex regardless of validity', () => {
    const step = WIZARD_STEPS[0];
    expect(wizardStepStatus(step, 0, 0, () => false)).toBe('current');
  });

  it('returns upcoming for a step after currentIndex', () => {
    const step = WIZARD_STEPS[2];
    expect(wizardStepStatus(step, 2, 0, () => true)).toBe('upcoming');
  });

  it('returns upcoming for a passed step whose required controls are still invalid', () => {
    const step = WIZARD_STEPS[0]; // 'event', has requiredControls
    expect(wizardStepStatus(step, 0, 1, () => false)).toBe('upcoming');
  });

  it('returns done for a passed step with no required controls', () => {
    const step = WIZARD_STEPS[1]; // 'description', no requiredControls
    expect(wizardStepStatus(step, 1, 2, () => false)).toBe('done');
  });

  it('returns done for a passed step whose required controls are valid', () => {
    const step = WIZARD_STEPS[0];
    expect(wizardStepStatus(step, 0, 1, () => true)).toBe('done');
  });
});

describe('wizardCompletedCount', () => {
  it('counts all six pre-creation steps as done once the event step is valid', () => {
    expect(wizardCompletedCount(WIZARD_STEPS, 5, () => true)).toEqual({ done: 6, total: 6 });
  });

  it('excludes the event step while it is still invalid, even after it has been passed', () => {
    const isValid = (controls: readonly string[]) => controls.length === 0;
    expect(wizardCompletedCount(WIZARD_STEPS, 5, isValid)).toEqual({ done: 5, total: 6 });
  });
});

describe('firstInvalidStepIndex', () => {
  const none = () => false;

  it('returns -1 when nothing is invalid', () => {
    expect(firstInvalidStepIndex(WIZARD_STEPS, none, none)).toBe(-1);
  });

  it('returns 2 when only fileNumber is invalid', () => {
    expect(firstInvalidStepIndex(WIZARD_STEPS, (name) => name === 'fileNumber', none)).toBe(2);
  });

  it('returns 3 when only the exhibitionDates group error is present', () => {
    expect(firstInvalidStepIndex(WIZARD_STEPS, none, (key) => key === 'exhibitionDates')).toBe(3);
  });

  it('returns 0 when both name and fileNumber are invalid', () => {
    expect(
      firstInvalidStepIndex(WIZARD_STEPS, (name) => name === 'name' || name === 'fileNumber', none),
    ).toBe(0);
  });

  it('lists every control of the create form on exactly one step', () => {
    const form = createEventForm(new FormBuilder(), 'create');
    const listed = WIZARD_STEPS.flatMap((step) => step.controls ?? []);
    expect([...listed].sort()).toEqual(Object.keys(form.controls).sort());
  });
});
