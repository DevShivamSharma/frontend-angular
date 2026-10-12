/** Mirrors the backend's bookings views (docs/15 §5.3): staff bookings and the stall map. */

import type { HallFloor } from '../api/api.models';
import type { EventStatus } from '../events/events.models';
import type { StallScheme, StallSide } from '../plans/plans.models';

/** `internal`: made by staff. `external`: held by the exhibitor through the portal (M5). */
export type BookingChannel = 'internal' | 'external';
export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';

/** `created` until paid (`failed` can be paid again); `expired`: nobody paid; then the refund states. */
export type PaymentStatus =
  'created' | 'paid' | 'failed' | 'expired' | 'refunded' | 'partially_refunded';

/** What a booking's payment shows: the paid one, else the newest order. */
export interface BookingPaymentView {
  status: PaymentStatus;
  provider: 'razorpay' | 'log';
  orderId: string;
  paymentId: string | null;
  method: string | null;
  amountPaise: number;
  paidAt: string | null;
  /** Refunds that went through, in paise. */
  refundedPaise: number;
  /** Refunds asked for or being sent, not through yet, in paise. */
  refundPendingPaise: number;
}

export interface BookingView {
  id: string;
  event: { id: string; name: string; status: EventStatus };
  hall: { id: string; name: string };
  /** The stall's number as it was when booked. */
  stall: { id: string; label: string };
  exhibitor: { id: string; name: string };
  channel: BookingChannel;
  status: BookingStatus;
  /** While held: when the hold runs out unless confirmed. */
  holdExpiresAt: string | null;
  /** The published price when booked, in paise, before GST. */
  amountPaise: number;
  currency: string;
  priceReckoning: string;
  note: string | null;
  cancelReason: string | null;
  /** Null while no order was made (a stall priced 0, or a booking made by staff). */
  payment: BookingPaymentView | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

/** `not_for_sale`: blocked, inactive, or published without a price. */
export type StallState = 'free' | 'held' | 'booked' | 'not_for_sale';

/** A stall of the published plan, as published. */
export interface PublishedStallView {
  id: string;
  label: string;
  islandNumber: string | null;
  stallNumber: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  openSides: StallSide[];
  scheme: StallScheme;
  isPremium: boolean;
  isBlocked: boolean;
  isActive: boolean;
  price: { amountPaise: number; currency: string; reckoning: string } | null;
}

export interface MapStallView extends PublishedStallView {
  state: StallState;
  booking: { id: string; exhibitorId: string; exhibitor: string; status: BookingStatus } | null;
}

export interface StallMapView {
  event: { id: string; name: string; status: EventStatus };
  hall: { id: string; name: string; floorVersion: number };
  /** Null while no plan of the hall is published. */
  published: { revision: number; at: string } | null;
  bookable: boolean;
  /** Why stalls of this hall cannot be booked now; null while they can. */
  closedReason: string | null;
  floor: HallFloor;
  stalls: MapStallView[];
}

export interface NewBookingInput {
  eventId: string;
  hallId: string;
  stallId: string;
  exhibitorId: string;
  note: string | null;
  confirm: boolean;
}

/** What an exhibitor's own users see first: their company and the events they may book at. */
export interface PortalView {
  exhibitor: { id: string; name: string };
  /** Null while the organisation takes bookings online; otherwise why not. */
  closedReason: string | null;
  events: PortalEventView[];
}

export interface PortalEventView {
  id: string;
  name: string;
  status: EventStatus;
  startsOn: string;
  endsOn: string;
  organiserName: string | null;
  /** Null while its stalls can be held here; otherwise why not. */
  closedReason: string | null;
  halls: Array<{ hallId: string; name: string; published: boolean; freeStalls: number }>;
}

/** A hold the exhibitor asks for; the exhibitor comes from their access, not from here. */
export interface PortalHoldInput {
  eventId: string;
  hallId: string;
  stallId: string;
  note: string | null;
}

/** Razorpay Checkout's options from the server (M6). `keyId` null: the log transport. */
export interface CheckoutView {
  keyId: string | null;
  orderId: string;
  /** Paise, as Checkout takes it. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  holdExpiresAt: string;
}

export interface PortalHoldView {
  booking: BookingView;
  /** Null in M5, for a free stall, or when the order could not be made (`paymentError`). */
  checkout: CheckoutView | null;
  paymentError: string | null;
}

export interface PaymentResultView {
  booking: BookingView;
  outcome: 'confirmed' | 'revived' | 'already_paid' | 'refunding' | 'pending';
}
