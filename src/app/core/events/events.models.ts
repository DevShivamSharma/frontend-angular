import type { EventType } from '../rules/rules.models';
import type { StallPlanStatus } from '../stall-plans/stall-plans.models';

/* Mirrors the backend's events (Module D), the halls they book and their exhibitors. */

/** `internal`: the venue's own event. `external`: a third party organises it in the halls. */
export type EventKind = 'internal' | 'external';
export const EVENT_KINDS: readonly { value: EventKind; label: string; hint: string }[] = [
  { value: 'internal', label: 'Internal', hint: 'The venue’s own event' },
  { value: 'external', label: 'External', hint: 'A third party organises it in the halls' },
];

/**
 * Where an event is in its life. Stalls can be booked only while it is `scheduled`; a
 * cancelled event no longer reserves its halls. Completed and cancelled are final.
 */
export type EventStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';
export const EVENT_STATUSES: readonly EventStatus[] = [
  'draft',
  'scheduled',
  'completed',
  'cancelled',
];

export interface EventView {
  id: string;
  name: string;
  code: string | null;
  kind: EventKind;
  eventType: EventType;
  status: EventStatus;
  /** First and last day, `YYYY-MM-DD`; both included. */
  startsOn: string;
  endsOn: string;
  venue: { id: string; name: string };
  organiser: { name: string | null; email: string | null; phone: string | null };
  description: string | null;
  cancelledReason: string | null;
  hallCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A hall the event books. `floorVersion` is the floor its stalls are drawn on. */
export interface EventHallView {
  hallId: string;
  name: string;
  code: string | null;
  level: string | null;
  width: number;
  depth: number;
  floorArea: number;
  floorVersion: number;
  /** The hall's floor now; above `floorVersion` when the hall was re-imported since. */
  currentVersion: number;
}

export interface EventDetailView extends EventView {
  halls: EventHallView[];
}

/** A hall of the event's venue, and the other events that hold it on overlapping days. */
export interface HallOptionView {
  hallId: string;
  name: string;
  code: string | null;
  /** Already booked by this event. */
  booked: boolean;
  conflicts: { eventId: string; name: string; startsOn: string; endsOn: string }[];
}

/** What the event dialog sends; blanks are null. */
export interface EventInput {
  venueId: string;
  name: string;
  code: string | null;
  kind: EventKind;
  eventType: EventType;
  startsOn: string;
  endsOn: string;
  organiserName: string | null;
  organiserEmail: string | null;
  organiserPhone: string | null;
  description: string | null;
}

/** One hall of an event and its plan, for the event's overview. */
export interface EventPlanSummaryView {
  hallId: string;
  hallName: string;
  /** Null while no plan has been saved for the hall. */
  planId: string | null;
  status: StallPlanStatus | null;
  revision: number;
  stallCount: number;
  /** Held or confirmed bookings on its stalls. */
  activeBookings: number;
}

// ---- Exhibitors ------------------------------------------------------------------------------

/** A company that takes stalls, and the events it is registered for. */
export interface ExhibitorView {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  /** The events it is registered for, among those the viewer may see. */
  eventIds: string[];
  createdAt: string;
}

/** What the exhibitor dialog sends; blanks are null. */
export interface ExhibitorInput {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
}

/** A new exhibitor, optionally registered for one event at once. */
export interface NewExhibitorInput extends ExhibitorInput {
  eventId?: string;
}
