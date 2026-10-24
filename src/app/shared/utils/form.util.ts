import { AbstractControl, FormGroup } from '@angular/forms';

import { ApiError } from '../../core/http/api-error';
import { toIsoDate } from './date.util';

/** An empty text box means "nothing": the API stores null, not an empty string. */
export function emptyToNull<T>(value: T): T | null {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

/** A control's value as an API takes it: a date as YYYY-MM-DD, text trimmed, an empty box as null. */
export function toApiValue(value: unknown): unknown {
  if (value instanceof Date) return toIsoDate(value);
  if (typeof value === 'string') return emptyToNull(value.trim());
  return value ?? null;
}

/**
 * The values of the controls the user changed, and only those: an edit sends what changed, so what
 * is not sent stays as it is. A text box emptied on purpose is sent as null (clear it).
 */
export function changedValues(form: FormGroup): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [name, control] of Object.entries(form.controls)) {
    if (control.dirty) {
      changed[name] = toApiValue(control.value);
    }
  }
  return changed;
}

/**
 * The values the user filled in, for creating something: what is empty (null, an empty box, or a
 * switch left off) is left out, so the API's own defaults apply.
 */
export function filledValues(form: FormGroup): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const [name, control] of Object.entries(form.controls)) {
    const value = toApiValue(control.value);
    if (value !== null && value !== false) {
      filled[name] = value;
    }
  }
  return filled;
}

/** Puts the fields an API refused on their controls, each with the API's own words. True if any matched. */
export function applyServerErrors(form: FormGroup, error: ApiError): boolean {
  let matched = false;
  for (const [name, message] of Object.entries(error.fieldErrors)) {
    const control: AbstractControl | null = form.get(name);
    if (control) {
      control.setErrors({ server: message });
      control.markAsTouched();
      matched = true;
    }
  }
  return matched;
}

/** Shows every error at once, on the controls that have one. */
export function touchAll(form: FormGroup): void {
  form.markAllAsTouched();
}
