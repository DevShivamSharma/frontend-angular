import { FormBuilder } from '@angular/forms';

import { createEventForm, patchKnownFields, toCreatePayload, toUpdatePayload } from './event.form';

const fb = new FormBuilder();

describe('event form', () => {
  it('should need the organisation, a name and the dates to create', () => {
    const form = createEventForm(fb, 'create');

    expect(form.valid).toBe(false);
    form.patchValue({
      organisationId: 'org-1',
      name: 'IITF',
      startDate: new Date(2026, 10, 5),
      endDate: new Date(2026, 10, 29),
    });
    expect(form.valid).toBe(true);
  });

  it('should not need the organisation when editing', () => {
    const form = createEventForm(fb, 'edit');
    patchKnownFields(form, { name: 'IITF', startDate: '2026-11-05', endDate: '2026-11-29' });

    expect(form.valid).toBe(true);
  });

  it('should refuse an event that ends before it starts, and an exhibition too', () => {
    const form = createEventForm(fb, 'edit');
    patchKnownFields(form, { name: 'IITF', startDate: '2026-11-05', endDate: '2026-11-01' });
    expect(form.errors?.['eventDates']).toMatch(/cannot end before/);

    patchKnownFields(form, { name: 'IITF', startDate: '2026-11-05', endDate: '2026-11-29' });
    form.patchValue({
      exhibitionStartDate: new Date(2026, 10, 20),
      exhibitionEndDate: new Date(2026, 10, 10),
    });
    expect(form.errors?.['exhibitionDates']).toMatch(/exhibition/);
  });

  it('should build a create call from what was filled, with dates as text and hidden by default', () => {
    const form = createEventForm(fb, 'create');
    form.patchValue({
      organisationId: 'org-1',
      name: ' IITF 2026 ',
      startDate: new Date(2026, 10, 5),
      endDate: new Date(2026, 10, 29),
      description: 'The fair',
      expectedNumberOfVisitor: 1000,
    });

    expect(toCreatePayload(form)).toEqual({
      organisationId: 'org-1',
      name: 'IITF 2026',
      startDate: '2026-11-05',
      endDate: '2026-11-29',
      description: 'The fair',
      expectedNumberOfVisitor: 1000,
    });
  });

  it('should send the visibility only when it was shown', () => {
    const form = createEventForm(fb, 'create');
    form.patchValue({
      organisationId: 'o',
      name: 'n',
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 0, 2),
      visibility: 'show',
    });

    expect(toCreatePayload(form).visibilityStatus).toBe(true);
  });

  it('should build an edit call from what changed only, a cleared box as null and the visibility as a flag', () => {
    const form = createEventForm(fb, 'edit');
    patchKnownFields(form, { name: 'IITF', startDate: '2026-11-05', endDate: '2026-11-29' });
    form.markAsPristine();

    form.controls.description.setValue('New text');
    form.controls.description.markAsDirty();
    form.controls.specialRequest.setValue('');
    form.controls.specialRequest.markAsDirty();
    form.controls.visibility.setValue('hide');
    form.controls.visibility.markAsDirty();

    expect(toUpdatePayload(form)).toEqual({
      description: 'New text',
      specialRequest: null,
      visibilityStatus: false,
    });
  });

  it('should send nothing for a visibility left as it is', () => {
    const form = createEventForm(fb, 'edit');
    form.controls.visibility.markAsDirty();

    expect(toUpdatePayload(form)).toEqual({});
  });

  it('should fill the edit form with the event as it is, and send nothing until something changes', () => {
    const form = createEventForm(fb, 'edit');
    patchKnownFields(form, {
      name: 'IITF',
      startDate: '2026-11-05',
      endDate: '2026-11-29',
      eventType: 'B2B and B2C',
      description: '<p>The fair</p>',
      expectedVisitors: 5000,
      startTime: '10:00:00',
      visible: true,
    });
    form.markAsPristine();

    expect(form.controls.eventType.value).toBe('B2B & B2C both');
    expect(form.controls.description.value).toBe('The fair');
    expect(form.controls.expectedNumberOfVisitor.value).toBe(5000);
    expect(form.controls.visibility.value).toBe('show');
    expect(toUpdatePayload(form)).toEqual({});

    form.controls.name.setValue('IITF 2027');
    form.controls.name.markAsDirty();
    expect(toUpdatePayload(form)).toEqual({ name: 'IITF 2027' });
  });
});
