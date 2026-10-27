import { WIZARD_STEPS, wizardCompletedCount, wizardStepStatus } from './event-wizard-steps';

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
