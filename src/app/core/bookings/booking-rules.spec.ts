import {
  bookingClosedReason,
  canCancel,
  canCancelOwn,
  canConfirm,
  canExportToSelfcare,
  canMove,
  paymentLabel,
  stallLabel,
  stallLook,
} from './booking-rules';
import type {
  BookingStatus,
  BookingView,
  EventStatus,
  MapStallView,
  StallState,
} from './bookings.models';

function booking(status: BookingStatus, eventStatus: EventStatus = 'scheduled'): BookingView {
  return {
    id: 'b1',
    event: { id: 'e1', name: 'Expo', status: eventStatus },
    hall: { id: 'h1', name: 'Hall 1' },
    stall: { id: 's1', number: 'A1', area: 9, openSides: ['bottom'], stallType: null },
    exhibitor: { id: 'x1', name: 'Acme' },
    channel: 'internal',
    status,
    paymentStatus: null,
    note: null,
    externalRef: null,
    cancelReason: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    confirmedAt: null,
    cancelledAt: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

describe('booking rules', () => {
  it('never claims a payment this platform did not take', () => {
    expect(paymentLabel(null)).toBe('Not tracked here');
    expect(paymentLabel('pending')).toBe('Awaiting venue payment');
    expect(paymentLabel('completed')).toBe('Paid (venue system)');
    expect(paymentLabel('timeout')).toContain('venue system');
    expect(paymentLabel('cancelled')).toContain('venue system');
  });

  it('confirms only a held booking of a scheduled event', () => {
    expect(canConfirm(booking('held'))).toBeTrue();
    expect(canConfirm(booking('confirmed'))).toBeFalse();
    expect(canConfirm(booking('held', 'draft'))).toBeFalse();
  });

  it('moves an active booking only while the event is scheduled', () => {
    expect(canMove(booking('held'))).toBeTrue();
    expect(canMove(booking('confirmed'))).toBeTrue();
    expect(canMove(booking('cancelled'))).toBeFalse();
    expect(canMove(booking('confirmed', 'draft'))).toBeFalse();
  });

  it('cancels an active booking of a draft or scheduled event', () => {
    expect(canCancel(booking('confirmed'))).toBeTrue();
    expect(canCancel(booking('held', 'draft'))).toBeTrue();
    expect(canCancel(booking('expired'))).toBeFalse();
    expect(canCancel(booking('held', 'completed'))).toBeFalse();
  });

  it('exports only a held booking to SelfCare', () => {
    expect(canExportToSelfcare(booking('held'))).toBeTrue();
    expect(canExportToSelfcare(booking('confirmed'))).toBeFalse();
  });

  it('lets an exhibitor cancel only its held booking', () => {
    expect(canCancelOwn(booking('held'))).toBeTrue();
    expect(canCancelOwn(booking('confirmed'))).toBeFalse();
    expect(canCancelOwn(booking('held', 'cancelled'))).toBeFalse();
  });

  it('says why stalls of an event cannot be booked', () => {
    expect(bookingClosedReason({ name: 'Expo', status: 'scheduled' })).toBeNull();
    expect(bookingClosedReason({ name: 'Expo', status: 'draft' })).toContain('scheduled');
    expect(bookingClosedReason({ name: 'Expo', status: 'cancelled' })).toContain('cancelled');
  });
});

describe('stall looks', () => {
  function stall(state: StallState, booking: MapStallView['booking']): MapStallView {
    return {
      id: 's1',
      number: 'A1',
      x: 0,
      y: 0,
      width: 3,
      depth: 3,
      area: 9,
      openSides: [],
      stallType: null,
      state,
      booking,
    };
  }

  it('shows staff whose stall it is', () => {
    const held = stall('held', { id: 'b1', exhibitor: 'Acme', own: false });
    expect(stallLook(held, 'staff')).toBe('held');
    expect(stallLabel(held, 'staff')).toBe('Stall A1, held by Acme');
    expect(stallLabel(stall('free', null), 'staff')).toBe('Stall A1, free');
  });

  it("shows an exhibitor its own stalls, and others' only as taken", () => {
    const own = stall('booked', { id: 'b1', exhibitor: 'Acme', own: true });
    const other = stall('held', null);
    expect(stallLook(own, 'exhibitor')).toBe('own');
    expect(stallLabel(own, 'exhibitor')).toBe('Stall A1, yours (booked)');
    expect(stallLook(other, 'exhibitor')).toBe('taken');
    expect(stallLabel(other, 'exhibitor')).toBe('Stall A1, taken');
  });
});
