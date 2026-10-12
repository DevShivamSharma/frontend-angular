import type { EventStatus } from '../events/events.models';
import { rupees } from '../plans/stall-price';
import type {
  BookingStatus,
  BookingView,
  MapStallView,
  PaymentStatus,
  StallState,
} from './bookings.models';

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

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  created: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Payment failed',
  expired: 'Order expired',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
};

export const STALL_STATE_LABELS: Record<StallState, string> = {
  free: 'Free',
  held: 'Held',
  booked: 'Booked',
  not_for_sale: 'Not for sale',
};

/** Stall colours on the portal's hall plan; `mine` is the exhibitor's own stalls. */
export const STALL_STATE_COLORS: Record<StallState, string> = {
  free: '#16a34a',
  held: '#f59e0b',
  booked: '#dc2626',
  not_for_sale: '#94a3b8',
};
export const MINE_COLOR = '#2563eb';

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
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

/** An exhibitor lets go of a hold while the event is a draft or scheduled. */
export function canLetGo(b: BookingView): boolean {
  return b.status === 'held' && (b.event.status === 'draft' || b.event.status === 'scheduled');
}

/** Money has arrived for the booking (and maybe partly or wholly gone back). */
export function isPaid(b: BookingView): boolean {
  const s = b.payment?.status;
  return s === 'paid' || s === 'refunded' || s === 'partially_refunded';
}

/**
 * What is left to refund, in paise, as the server works it out. The server refunds from the
 * latest paid payment with something left, which need not be the payment the booking shows, so
 * the amount is never worked out here.
 */
export function refundable(b: BookingView): number {
  return b.payment?.refundablePaise ?? 0;
}

/** The server counts only paid and partly refunded payments, so anything left can be refunded. */
export function canRefund(b: BookingView): boolean {
  return refundable(b) > 0;
}

/** The payment in a few words, for the bookings tables. */
export function paymentLabel(b: BookingView): string {
  const p = b.payment;
  if (!p) return '—';
  if (p.status !== 'paid' && p.status !== 'partially_refunded' && p.status !== 'refunded') {
    return PAYMENT_STATUS_LABELS[p.status];
  }
  const parts = p.status === 'refunded' ? [] : [`Paid ${paise(p.amountPaise)}`];
  if (p.refundedPaise > 0) parts.push(`${paise(p.refundedPaise)} refunded`);
  if (p.refundPendingPaise > 0) parts.push(`refund ${paise(p.refundPendingPaise)} on the way`);
  return parts.length ? parts.join(' · ') : `Paid ${paise(p.amountPaise)}`;
}

/** When a hold runs out, as HH:mm. */
export function holdUntil(b: BookingView): string {
  if (!b.holdExpiresAt) return '';
  return new Date(b.holdExpiresAt).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Paise as rupees, grouped as India writes them: ₹1,00,000 for whole rupees, ₹10.50 otherwise.
 * Refunds can be part of a rupee, and rounding them would show a sum that was never paid back.
 */
export function paise(amount: number): string {
  if (amount % 100 === 0) return rupees(amount / 100);
  return `₹${(amount / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
