import { FormControl, FormGroup } from '@angular/forms';

import { ApiError } from '../../core/http/api-error';
import { applyServerErrors, changedValues, filledValues, toApiValue } from './form.util';

describe('form util', () => {
  it('should send a date as YYYY-MM-DD, trim text and turn an empty box into null', () => {
    expect(toApiValue(new Date(2026, 10, 5))).toBe('2026-11-05');
    expect(toApiValue('  hi ')).toBe('hi');
    expect(toApiValue('   ')).toBeNull();
    expect(toApiValue(0)).toBe(0);
    expect(toApiValue(undefined)).toBeNull();
  });

  it('should return only the controls the user changed, an emptied box as null', () => {
    const form = new FormGroup({
      name: new FormControl('A'),
      note: new FormControl('x'),
      days: new FormControl(2),
    });
    form.controls.note.setValue('');
    form.controls.note.markAsDirty();
    form.controls.days.setValue(3);
    form.controls.days.markAsDirty();

    expect(changedValues(form)).toEqual({ note: null, days: 3 });
  });

  it('should return the filled values for a create, leaving out empty boxes and switches left off', () => {
    const form = new FormGroup({
      name: new FormControl('Hall'),
      note: new FormControl(''),
      count: new FormControl(0),
      on: new FormControl(true),
      off: new FormControl(false),
      none: new FormControl(null),
    });

    expect(filledValues(form)).toEqual({ name: 'Hall', count: 0, on: true });
  });

  it('should put the fields an API refused on their controls and say whether any matched', () => {
    const form = new FormGroup({ name: new FormControl('') });
    const matched = applyServerErrors(
      form,
      new ApiError('Validation failed', 422, {
        errors: { name: 'name should not be empty', other: 'x' },
      }),
    );

    expect(matched).toBe(true);
    expect(form.controls.name.errors).toEqual({ server: 'name should not be empty' });
    expect(applyServerErrors(form, new ApiError('Nope', 409))).toBe(false);
  });
});
