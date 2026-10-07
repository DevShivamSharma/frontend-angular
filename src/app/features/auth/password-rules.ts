import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';

export const PASSWORD_MIN = 10;

export const passwordValidators = [
  Validators.required,
  Validators.minLength(PASSWORD_MIN),
  Validators.maxLength(128),
];

/** On a group: `confirm` must equal `password`. */
export const passwordsMatch: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value as string | undefined;
  const confirm = group.get('confirm')?.value as string | undefined;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
};
