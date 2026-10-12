/** Mirrors the backend's events, their halls and organisers (Module D). */
import type { CreatedInvitation, HallFloor, InvitationView, MemberView } from '../api/api.models';
import type { PaymentStatus } from '../bookings/bookings.models';
import type { CategoryRef } from '../categories/categories.models';
import type { EventType, RuleId, RuleValues } from '../rules/rules.models';

export type EventKind = 'internal' | 'external';
export type EventStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';
/** Where the event's stalls are sold; every event sells on the platform until M1. */
export type EventBookingChannel = 'venue_system' | 'platform_portal';

export interface EventView {
  id: string;
  kind: EventKind;
  status: EventStatus;
  bookingChannel: EventBookingChannel;
  name: string;
  venueEventId: string | null;
  organiserName: string | null;
  audience: EventType;
  /** Dates are `YYYY-MM-DD`. */
  startsOn: string;
  endsOn: string;
  buildUpOn: string | null;
  dismantleOn: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  hallCount: number;
  updatedAt: string;
}

export interface EventInput {
  kind?: EventKind;
  name?: string;
  venueEventId?: string | null;
  organiserName?: string | null;
  audience?: EventType;
  startsOn?: string;
  endsOn?: string;
  buildUpOn?: string | null;
  dismantleOn?: string | null;
}

export interface EventHallOverlap {
  eventId: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

export interface EventHallView {
  hallId: string;
  name: string;
  code: string | null;
  level: string | null;
  venue: { id: string; name: string };
  width: number;
  depth: number;
  floorArea: number;
  floorVersion: number;
  latestFloorVersion: number;
  rulesOn: number;
  drawingProfile: string;
  overlaps: EventHallOverlap[];
}

export interface EventDetailView extends EventView {
  halls: EventHallView[];
}

export interface EventHallRules {
  switches: Record<RuleId, boolean>;
  values: RuleValues;
  drawingProfile: string;
}

export interface EventHallDetailView {
  event: {
    id: string;
    name: string;
    kind: EventKind;
    status: EventStatus;
    audience: EventType;
    /** The company that booked the halls; external events only. */
    organiserName: string | null;
  };
  hall: EventHallView;
  floor: HallFloor;
  rules: EventHallRules;
  /** The categories this hall sells; the planner offers only these. */
  categories: CategoryRef[];
  /** Stalls and seats on the hall's plan; revision 0 before the first save. */
  plan: { stalls: number; seats: number; revision: number };
}

export interface EventPeople {
  members: MemberView[];
  invitations: InvitationView[];
}

export interface EventInviteResult {
  /** Already organising other events here: this one was added to their access. */
  added: boolean;
  invitation: CreatedInvitation | null;
}

/** A company that takes stalls (backend `ExhibitorView`). */
export interface ExhibitorView {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  /** The events it is registered for, among those this member sees. */
  eventIds: string[];
  createdAt: string;
}

export interface ExhibitorInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  address?: string | null;
}

export interface NewExhibitorInput extends ExhibitorInput {
  name: string;
  /** Registers it for this event at once; organisers must give one. */
  eventId?: string;
}

/** The people who book stalls for an exhibitor, and the open invitations to do so. */
export interface ExhibitorPeople {
  members: MemberView[];
  invitations: InvitationView[];
}

/** Open until the settlement is closed (live figures); then it waits for the payout, then it is settled. */
export type SettlementStatus = 'open' | 'closing' | 'settled';

/** The money of an event, in paise (backend `SettlementFigures`). */
export interface SettlementFigures {
  grossPaise: number;
  refundedPaise: number;
  gatewayFeePaise: number;
  platformFeePercent: number;
  platformFeePaise: number;
  netPayablePaise: number;
}

/** One captured payment of the event, as the ledger lists it. */
export interface SettlementPaymentView {
  id: string;
  bookingId: string;
  stallLabel: string;
  exhibitorName: string;
  status: PaymentStatus;
  method: string | null;
  paidAt: string;
  amountPaise: number;
  /** Razorpay's fee; null when it was never reported. */
  feePaise: number | null;
  refundedPaise: number;
  pendingRefundPaise: number;
}

/** An event's settlement (backend `SettlementView`). */
export interface SettlementView {
  eventId: string;
  status: SettlementStatus;
  /** Live while open; frozen at close. */
  figures: SettlementFigures;
  /** Payments whose gateway fee is unknown and counted as 0. */
  feeUnknown: number;
  /** Why it cannot be closed now; null when it can. */
  closeRefusal: string | null;
  closedAt: string | null;
  payout: { payeeName: string; bankDetails: string; reference: string; settledAt: string } | null;
  settledAt: string | null;
  payments: SettlementPaymentView[];
}

/** The bank transfer to the payee, recorded by hand. */
export interface PayoutInput {
  payeeName: string;
  bankDetails: string;
  reference: string;
}