import { rupees } from '../plans/stall-price';
import type { BookingStatus, BookingView, MapStallView, StallState } from './bookings.models';

/**
 * What the booking pages show and offer, from the server's own rules (the server decides; these
 * only keep impossible actions off the screen): stalls are booked, confirmed and moved while the
 * event is scheduled; an active booking is cancelled while the event is a draft or scheduled.
 */

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const STALL_STATE_LABELS: Record<StallState, string> = {
  free: 'Free',
  held: 'Held',
  booked: 'Booked',
  not_for_sale: 'Not for sale',
};

export function isActive(status: BookingStatus): boolean {
  return status === 'held' || status === 'confirmed';
}

export function canConfirm(b: BookingView): boolean {
  return b.status === 'held' && b.event.status === 'scheduled';
}

export function canMove(b: BookingView): boolean {
  return isActive(b.status) && b.event.status === 'scheduled';
}

export function canCancel(b: BookingView): boolean {
  return isActive(b.status) && (b.event.status === 'draft' || b.event.status === 'scheduled');
}

/** Paise as whole rupees, grouped as India writes them: ₹1,00,000. */
export function paise(amount: number): string {
  return rupees(amount / 100);
}

/** The stall in words, for its accessible name and tooltip on the map. */
export function stallTitle(s: MapStallView): string {
  const who = s.booking?.exhibitor ?? 'an exhibitor';
  switch (s.state) {
    case 'free':
      return `Stall ${s.label}, free${s.price ? `, ${paise(s.price.amountPaise)}` : ''}`;
    case 'held':
      return `Stall ${s.label}, held for ${who}`;
    case 'booked':
      return `Stall ${s.label}, booked by ${who}`;
    case 'not_for_sale':
      return `Stall ${s.label}, not for sale`;
  }
}
