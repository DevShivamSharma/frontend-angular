import type { EventKind } from './events.models';

/** An event of ITPO's (T_HALL_BOOKING), as ITPO's event lists show it. */
export interface ItpoEventView {
  /** ITPO's id of the event. */
  id: string;
  /** ITPO's booking number, e.g. H-20261100272. */
  code: string | null;
  name: string;
  kind: EventKind;
  organiserName: string | null;
  /** `YYYY-MM-DD`; null when ITPO has no dates yet. */
  startsOn: string | null;
  endsOn: string | null;
  approvalStatus: string | null;
  bookingStatus: string | null;
  halls: number;
  /** Our event for it, once it was opened here. */
  eventId: string | null;
}

/** One hall of an ITPO event. */
export interface ItpoEventHallView {
  /** ITPO's id of the event hall. */
  id: string;
  /** ITPO's id of the hall. */
  hallId: string;
  name: string;
  /** ITPO has the hall's floor, so it can be planned. */
  hasLayout: boolean;
  ourHallId: string | null;
}

export interface ItpoEventDetailView extends ItpoEventView {
  eventHalls: ItpoEventHallView[];
}

/** A hall of ITPO's an internal event can be given. */
export interface ItpoHallView {
  id: string;
  name: string;
  forStallFnb: boolean;
}
