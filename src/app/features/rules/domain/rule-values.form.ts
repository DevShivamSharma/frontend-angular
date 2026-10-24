import { FormBuilder } from '@angular/forms';

import { RuleValues } from '../data/rules.models';

/** The utilisation is stored as a share (0.7) and edited as a percentage (70). */
const SHARE_TO_PERCENT = 100;

/** The form of the rules' values; the share is in percent here. */
export function createValuesForm(fb: FormBuilder, values: RuleValues) {
  return fb.nonNullable.group({
    passageWidth: fb.nonNullable.group({
      B2B: [values.passageWidth.B2B],
      B2C: [values.passageWidth.B2C],
    }),
    peripheralClearance: [values.peripheralClearance],
    curtainClearance: [values.curtainClearance],
    facilityClearance: [values.facilityClearance],
    partitionClearance: [values.partitionClearance],
    pillarClearance: [values.pillarClearance],
    emergencyExitClearance: [values.emergencyExitClearance],
    sizeStep: [values.sizeStep],
    maxUtilization: [Math.round(values.maxUtilization * SHARE_TO_PERCENT)],
    eventSeparation: [values.eventSeparation],
    foyerConstruction: [values.foyerConstruction],
  });
}

export type ValuesForm = ReturnType<typeof createValuesForm>;

/** The form's values as the API takes them (the percentage back to a share). */
export function toRuleValues(form: ValuesForm): RuleValues {
  const raw = form.getRawValue();
  return { ...raw, maxUtilization: raw.maxUtilization / SHARE_TO_PERCENT };
}

/** How a limit reads to the user: metres, or percent for a share. */
export function limitRange(unit: 'm' | 'share', min: number, max: number): string {
  return unit === 'share'
    ? `${Math.round(min * SHARE_TO_PERCENT)} to ${Math.round(max * SHARE_TO_PERCENT)} %`
    : `${min} to ${max} m`;
}
