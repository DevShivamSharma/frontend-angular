import type {
  BookingChannel,
  BookingStatus,
  BookingView,
  EventStatus,
  MapStallView,
  PaymentStatus,
  StallState,
} from './bookings.models';

/**
 * What the booking pages show and offer, from the server's own rules (the server decides; these
 * only keep impossible actions off the screen):
 *  - stalls are booked, confirmed and moved only while the event is scheduled;
 *  - a held or confirmed booking is active; only an active booking is cancelled or moved, and
 *    only while the event is a draft or scheduled;
 *  - only a held booking is confirmed, or exported to SelfCare;
 *  - an exhibitor cancels only its own held booking.
 */

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const CHANNEL_LABELS: Record<BookingChannel, string> = {
  internal: 'Internal',
  external: 'External',
};

export const STALL_STATE_LABELS: Record<StallState, string> = {
  free: 'Free',
  held: 'Held',
  booked: 'Booked',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Payment, honestly: this platform takes none. Only in `hybrid_hold` does the venue's own system
 * report it; everywhere else it is null.
 */
export function paymentLabel(status: PaymentStatus | null): string {
  switch (status) {
    case null:
      return 'Not tracked here';
    case 'pending':
      return 'Awaiting venue payment';
    case 'completed':
      return 'Paid (venue system)';
    case 'timeout':
      return 'Payment timed out (venue system)';
    case 'cancelled':
      return 'Payment cancelled (venue system)';
  }
}

export function isActive(status: BookingStatus): boolean {
  return status === 'held' || status === 'confirmed';
}

/** Draft or scheduled: its bookings can still be cancelled. */
export function isOpenEvent(status: EventStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

/** Null while stalls of the event can be booked; otherwise why not, in a sentence. */
export function bookingClosedReason(event: { name: string; status: EventStatus }): string | null {
  switch (event.status) {
    case 'scheduled':
      return null;
    case 'draft':
      return `Stalls are booked once the event is scheduled; ${event.name} is still a draft. Existing bookings can only be cancelled.`;
    case 'completed':
      return `${event.name} is completed; its bookings no longer change.`;
    case 'cancelled':
      return `${event.name} is cancelled; its bookings no longer change.`;
  }
}

export function canConfirm(booking: BookingView): boolean {
  return booking.status === 'held' && booking.event.status === 'scheduled';
}

export function canMove(booking: BookingView): boolean {
  return isActive(booking.status) && booking.event.status === 'scheduled';
}

export function canCancel(booking: BookingView): boolean {
  return isActive(booking.status) && isOpenEvent(booking.event.status);
}

/** SelfCare takes only a held booking, in its pre-payment state. */
export function canExportToSelfcare(booking: BookingView): boolean {
  return booking.status === 'held';
}

/** An exhibitor lets go of its own hold; a confirmed booking is the organiser's to cancel. */
export function canCancelOwn(booking: BookingView): boolean {
  return booking.status === 'held' && isOpenEvent(booking.event.status);
}

/** Who looks at a stall map: staff see every booking, an exhibitor only its own. */
export type StallMapViewer = 'staff' | 'exhibitor';

/**
 * How a stall is drawn. Staff see free, held and booked; an exhibitor sees free, its own, and
 * taken (another exhibitor's, held or booked alike, without a name).
 */
export type StallLook = 'free' | 'held' | 'booked' | 'own' | 'taken';

export function stallLook(stall: MapStallView, viewer: StallMapViewer): StallLook {
  if (stall.state === 'free') return 'free';
  if (viewer === 'staff') return stall.state;
  return stall.booking?.own ? 'own' : 'taken';
}

/** The stall in words, for its accessible name and tooltip. */
export function stallLabel(stall: MapStallView, viewer: StallMapViewer): string {
  const look = stallLook(stall, viewer);
  switch (look) {
    case 'free':
      return `Stall ${stall.number}, free`;
    case 'own':
      return `Stall ${stall.number}, yours (${STALL_STATE_LABELS[stall.state].toLowerCase()})`;
    case 'taken':
      return `Stall ${stall.number}, taken`;
    default:
      return stall.booking
        ? `Stall ${stall.number}, ${look} by ${stall.booking.exhibitor}`
        : `Stall ${stall.number}, ${look}`;
  }
}
