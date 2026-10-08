/**
 * Mirrors the backend's bookings views (Module E): staff bookings, published stall maps, the
 * exhibitor portal, and the few event / exhibitor reads the booking pages need.
 */

import type { BookingMode, HallFloor } from '../api/api.models';
import type { EventType, StallSide } from '../rules/rules.models';
import type { StallType, StallView } from '../stall-plans/stall-plans.models';

export type EventStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';

/**
 * `internal`: booked by a member who manages bookings, for an exhibitor. `external`: held by
 * the exhibitor's own user through the portal.
 */
export type BookingChannel = 'internal' | 'external';

/** SelfCare's states in our words: `held` is its Pending, `expired` its Timeout. */
export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';
export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'held',
  'confirmed',
  'cancelled',
  'expired',
];

/**
 * Payment as the venue's own booking system reports it (`hybrid_hold` only). Null: not tracked
 * here — this platform takes no payment.
 */
export type PaymentStatus = 'pending' | 'completed' | 'timeout' | 'cancelled';

export interface BookingView {
  id: string;
  event: { id: string; name: string; status: EventStatus };
  hall: { id: string; name: string };
  stall: {
    id: string;
    number: string;
    area: number;
    openSides: StallSide[];
    stallType: StallType | null;
  };
  exhibitor: { id: string; name: string };
  channel: BookingChannel;
  status: BookingStatus;
  paymentStatus: PaymentStatus | null;
  note: string | null;
  externalRef: string | null;
  cancelReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

/** `free`: open for booking; `held` / `booked`: a held or confirmed booking has it. */
export type StallState = 'free' | 'held' | 'booked';

export interface MapStallView extends StallView {
  state: StallState;
  /**
   * The active booking on the stall. Staff see every booking and whose it is; an exhibitor sees
   * only its own (another exhibitor's stall shows as held or booked, without a name).
   */
  booking: { id: string; exhibitor: string; own: boolean } | null;
}

/** A published hall plan of an event, with which stalls are free. */
export interface StallMapView {
  event: { id: string; name: string; status: EventStatus; eventType: EventType };
  hall: { id: string; name: string; floorVersion: number };
  /** Bookable now: the event is scheduled (and, for exhibitors, the portal is open). */
  bookable: boolean;
  floor: HallFloor;
  stalls: MapStallView[];
}

/** What an exhibitor's user sees first: its company, its events, and whether it can book. */
export interface PortalView {
  exhibitor: { id: string; name: string };
  bookingMode: BookingMode;
  /** Null when exhibitors may hold stalls here; otherwise why they cannot. */
  closedReason: string | null;
  events: PortalEventView[];
}

export interface PortalEventView {
  id: string;
  name: string;
  status: EventStatus;
  startsOn: string;
  endsOn: string;
  venue: string;
  halls: Array<{ hallId: string; name: string; published: boolean; freeStalls: number }>;
}

export interface NewBookingInput {
  eventId: string;
  stallId: string;
  exhibitorId: string;
  note?: string | null;
  confirm?: boolean;
}

export interface PortalHoldInput {
  eventId: string;
  stallId: string;
  note?: string | null;
}

// ---- Reads of other modules, only the fields the booking pages use -------------------------

/** The event as `GET events/:eventId` returns it (EventDetailView), trimmed to what is used. */
export interface BookingEventView {
  id: string;
  name: string;
  status: EventStatus;
  startsOn: string;
  endsOn: string;
  venue: { id: string; name: string };
  halls: Array<{ hallId: string; name: string }>;
}

/** An exhibitor company (ExhibitorView), trimmed to what the booking pages use. */
export interface ExhibitorOption {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  eventIds: string[];
}

// ---- SelfCare export (ITPO's booking portal; same names as SelfCare's columns) -------------

export interface SelfcarePricingInput {
  bare_rate: number | null;
  shell_rate: number | null;
  two_side_open_rate_percent: number | null;
  three_side_open_rate_percent: number | null;
  four_side_open_rate_percent: number | null;
  /** Spelled as in the SelfCare table. */
  catlog_entry_charge: number | null;
  corner_charges_applicable: boolean;
}

export interface SelfcareTaxInput {
  cgst_percent: number | null;
  sgst_percent: number | null;
  igst_percent: number | null;
}

/** SelfCare's own ids and its price-master values for the stall, all optional. */
export interface SelfcareRowInput {
  user_id?: string | null;
  event_id?: string | null;
  event_hall_id?: string | null;
  hall_id?: number | null;
  stall_id?: string | null;
  product_category_id?: number | null;
  pricing?: SelfcarePricingInput | null;
  tax?: SelfcareTaxInput | null;
}

/** The booking as rows of SelfCare's tables, to be written there by the venue. */
export interface SelfcareBookingPayload {
  T_STALLS: {
    id: string | null;
    hall_id: number | null;
    island_number: string;
    stall_number: string | null;
    booking_status: 'In-Progress';
    no_of_open_sides: number;
  };
  T_STALL_BOOKING: {
    user_id: string | null;
    event_id: string | null;
    event_name: string | null;
    status: 'active';
    booking_status: 'Pending';
    payment_status: 'Pending';
    valid_till: string;
    is_active: true;
    is_marquee: false;
    is_fnb_stall: false;
    is_branding_stall: false;
    is_horse_shoe: false;
    is_overseas_booking: false;
    created_at: string;
    updated_at: string;
  };
  T_STALL_BOOKING_DETAIL: Array<{
    stall_id: string | null;
    hall_id: number | null;
    event_hall_id: string | null;
    event_id: string | null;
    user_id: string | null;
    product_category_id: number | null;
    stall_type: StallType | null;
    area: number;
    open_sides: number;
    rate: number | null;
    rental: number | null;
    corner_charge: number | null;
    catalog_charge: number | null;
    total: number | null;
    cgst_percent: number | null;
    cgst_amount: number | null;
    sgst_percent: number | null;
    sgst_amount: number | null;
    igst_percent: number | null;
    igst: number | null;
    total_gst_amount: number | null;
    net_payable_amount: number | null;
    status: 'In-Progress';
    valid_till: string;
    item_added_at: string;
    is_fnb_stall: false;
    is_branding_stall: false;
  }>;
}
