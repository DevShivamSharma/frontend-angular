import type { SelfcarePricingInput, SelfcareRowInput, SelfcareTaxInput } from './bookings.models';

/** A form value: text, a number from a number field, or nothing entered. */
type Entered = string | number | null | undefined;

/** The SelfCare export form, every field as entered; nothing has a default. */
export interface SelfcareRowForm {
  user_id: Entered;
  event_id: Entered;
  event_hall_id: Entered;
  hall_id: Entered;
  stall_id: Entered;
  product_category_id: Entered;
  bare_rate: Entered;
  shell_rate: Entered;
  two_side_open_rate_percent: Entered;
  three_side_open_rate_percent: Entered;
  four_side_open_rate_percent: Entered;
  catlog_entry_charge: Entered;
  /** '' until chosen. */
  corner_charges_applicable: '' | 'yes' | 'no';
  cgst_percent: Entered;
  sgst_percent: Entered;
  igst_percent: Entered;
}

const ID_FIELDS = ['user_id', 'event_id', 'event_hall_id', 'stall_id'] as const;
const NUMBER_ID_FIELDS = ['hall_id', 'product_category_id'] as const;
const PRICE_FIELDS = [
  'bare_rate',
  'shell_rate',
  'two_side_open_rate_percent',
  'three_side_open_rate_percent',
  'four_side_open_rate_percent',
  'catlog_entry_charge',
] as const;
const TAX_FIELDS = ['cgst_percent', 'sgst_percent', 'igst_percent'] as const;

export type SelfcareRowResult =
  { ok: true; input: SelfcareRowInput } | { ok: false; error: string };

/**
 * The request body for a SelfCare row: only what was entered is sent. Prices go only when one is
 * entered, and then SelfCare needs to know whether corner charges apply (no default is assumed);
 * tax goes only when a rate is entered. Without prices the server computes no amount.
 */
export function selfcareRowInput(form: SelfcareRowForm): SelfcareRowResult {
  const input: SelfcareRowInput = {};
  for (const key of ID_FIELDS) {
    const text = asText(form[key]);
    if (text) input[key] = text;
  }
  for (const key of NUMBER_ID_FIELDS) {
    const n = asNumber(form[key]);
    if (n !== null) input[key] = n;
  }

  const anyPrice = PRICE_FIELDS.some((key) => asNumber(form[key]) !== null);
  if (anyPrice || form.corner_charges_applicable) {
    if (!form.corner_charges_applicable) {
      return { ok: false, error: 'Choose whether corner charges apply to these prices.' };
    }
    const pricing = {
      corner_charges_applicable: form.corner_charges_applicable === 'yes',
    } as SelfcarePricingInput;
    for (const key of PRICE_FIELDS) pricing[key] = asNumber(form[key]);
    input.pricing = pricing;
  }

  if (TAX_FIELDS.some((key) => asNumber(form[key]) !== null)) {
    const tax = {} as SelfcareTaxInput;
    for (const key of TAX_FIELDS) tax[key] = asNumber(form[key]);
    input.tax = tax;
  }
  return { ok: true, input };
}

function asText(value: Entered): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** A number, or null when nothing (or nothing numeric) was entered. */
function asNumber(value: Entered): number | null {
  const text = asText(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
