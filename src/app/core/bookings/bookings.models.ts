/** Mirrors the backend's bookings views (docs/15 §5.3): staff bookings and the stall map. */

import type { HallFloor } from '../api/api.models';
import type { EventStatus } from '../events/events.models';
import type { StallScheme, StallSide } from '../plans/plans.models';

/** `internal`: made by staff. `external`: held by the exhibitor through the portal (M5). */
export type BookingChannel = 'internal' | 'external';
export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';

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
  booking: { id: string; exhibitor: string; status: BookingStatus } | null;
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
