import type { PriceCard } from './stall-price';

/** The price types set in the portal. */
export const RATE_TYPES = ['General', 'Premium', 'Marquee'] as const;
export type RateType = (typeof RATE_TYPES)[number];

/**
 * One row of ITPO's rate card (the one SelfCare prices stall bookings from): the rates of a price
 * type for a stretch of time. The ends are instants (ISO 8601).
 */
export interface RatePeriod {
  id?: string;
  type: RateType;
  startAt: string;
  endAt: string;
  /** ₹ per m². */
  bareRate: number;
  shellRate: number;
  /** % more for 2, 3 and 4 open sides. */
  side2Percent: number;
  side3Percent: number;
  side4Percent: number;
  /** ₹ on every stall. */
  catalogueCharge: number;
  /** ₹ for a food and beverage stall, in place of the area rate; null: the area rate. */
  fnbPrice: number | null;
}

/** An event hall's rate card and who may change it. `card` is the rates as they stand today. */
export interface RateCardView {
  periods: RatePeriod[];
  card: PriceCard | null;
  canManage: boolean;
  readOnlyReason: string | null;
}

const IST = 'Asia/Kolkata';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: IST });

/** The day (India) an instant falls on, `YYYY-MM-DD`. */
export function dayOf(iso: string): string {
  return dayFormat.format(new Date(iso));
}

/** A day as a local date at midday, for a date picker (no zone can move it to another day). */
export function dateOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** A picked date as a day, `YYYY-MM-DD`. */
export function dayOfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** A day run from its start to its end in India. */
export const startOfDay = (day: string) => `${day}T00:00:00+05:30`;
export const endOfDay = (day: string) => `${day}T23:59:59+05:30`;
