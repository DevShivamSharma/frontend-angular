import { SelfcareRowForm, selfcareRowInput } from './selfcare-row';

function empty(): SelfcareRowForm {
  return {
    user_id: '',
    event_id: '',
    event_hall_id: '',
    hall_id: null,
    stall_id: '',
    product_category_id: null,
    bare_rate: null,
    shell_rate: null,
    two_side_open_rate_percent: null,
    three_side_open_rate_percent: null,
    four_side_open_rate_percent: null,
    catlog_entry_charge: null,
    corner_charges_applicable: '',
    cgst_percent: null,
    sgst_percent: null,
    igst_percent: null,
  };
}

describe('selfcareRowInput', () => {
  it('sends nothing when nothing is entered', () => {
    expect(selfcareRowInput(empty())).toEqual({ ok: true, input: {} });
  });

  it('sends only the ids entered, trimmed, and whole-number ids as numbers', () => {
    const result = selfcareRowInput({
      ...empty(),
      user_id: ' 3f1c2b9a-1111-4222-8333-944445555666 ',
      hall_id: '12',
    });
    expect(result).toEqual({
      ok: true,
      input: { user_id: '3f1c2b9a-1111-4222-8333-944445555666', hall_id: 12 },
    });
  });

  it('asks whether corner charges apply once a price is entered', () => {
    const result = selfcareRowInput({ ...empty(), shell_rate: 9000 });
    expect(result.ok).toBeFalse();
  });

  it('sends prices with the rest null, and the corner choice as given', () => {
    const result = selfcareRowInput({
      ...empty(),
      shell_rate: 9000,
      corner_charges_applicable: 'no',
    });
    expect(result).toEqual({
      ok: true,
      input: {
        pricing: {
          bare_rate: null,
          shell_rate: 9000,
          two_side_open_rate_percent: null,
          three_side_open_rate_percent: null,
          four_side_open_rate_percent: null,
          catlog_entry_charge: null,
          corner_charges_applicable: false,
        },
      },
    });
  });

  it('sends tax only when a rate is entered, zero included', () => {
    expect(selfcareRowInput({ ...empty(), igst_percent: 0 })).toEqual({
      ok: true,
      input: { tax: { cgst_percent: null, sgst_percent: null, igst_percent: 0 } },
    });
  });
});
