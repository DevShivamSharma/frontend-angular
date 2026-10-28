/** The kinds of event ITPO's internal events use. */
export type EventKind = 'B2B' | 'B2C' | 'B2B & B2C both';

export const EVENT_KINDS: readonly EventKind[] = ['B2B', 'B2C', 'B2B & B2C both'];

/** What creating or editing an internal event answers with. */
export interface InternalEvent {
  id: string;
  bookingId: string;
  name: string;
  startDate: string;
  endDate: string;
  visibilityStatus: boolean;
}

/** The optional fields of an event; the same for creating and editing one. */
export interface EventFields {
  eventType?: EventKind | null;
  eventFormat?: string | null;
  coOrganizerName?: string | null;
  description?: string | null;
  productProfile?: string | null;
  specificProductProfile?: string | null;
  productCategory?: string | null;
  exhibitionStartDate?: string | null;
  exhibitionEndDate?: string | null;
  startTimeOfEvent?: string | null;
  endTimeOfEvent?: string | null;
  expectedNumberOfVisitor?: number | null;
  expectedNumberOfExhibitors?: number | null;
  noOfStalls?: number | null;
  noOfFnbStalls?: number | null;
  maxCategoriesForRegistration?: number | null;
  specialRequest?: string | null;
  fileNumber?: string | null;
  remarks?: string | null;
  allowOverseasUser?: boolean | null;
  isMarqueeEnabled?: boolean | null;
  isSecondaryEnabled?: boolean | null;
  visibilityStatus?: boolean | null;
}

export interface CreateEventPayload extends EventFields {
  organisationId: string;
  name: string;
  startDate: string;
  endDate: string;
}

/** An edit: any field; a field sent as null is cleared. */
export interface UpdateEventPayload extends EventFields {
  name?: string;
  startDate?: string;
  endDate?: string;
}

/** A hall to add to an event: the hall alone. */
export interface AddHallPayload {
  hallId: number;
}

/** A hall the API added to or changed in an event. */
export interface EventHall {
  /** The hall's id in the event (the one to edit or remove it by). */
  id: string;
  hallId: number;
  name: string;
  forStallFnb: boolean;
}

export interface AddedHalls {
  eventId: string;
  halls: EventHall[];
}

/** Internal events are ITPO's own; external ones are booked by organisations. */
export type EventListKind = 'internal' | 'external';

/** An event as the list and the event page show it. */
export interface EventSummary {
  id: string;
  bookingId: string | null;
  name: string;
  kind: EventListKind;
  organisation: string | null;
  bookingStatus: string | null;
  approvalStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  eventType: string | null;
  /** Whether the event shows in the public list; null when ITPO did not say. */
  visible: boolean | null;
}

/** An event's own details, as ITPO's event detail gives them. */
export interface EventDetails extends EventSummary {
  eventFormat: string | null;
  coOrganizer: string | null;
  bookingDate: string | null;
  exhibitionStartDate: string | null;
  exhibitionEndDate: string | null;
  startTime: string | null;
  endTime: string | null;
  expectedVisitors: number | null;
  expectedExhibitors: number | null;
  businessGenerated: number | null;
  decidedBy: string | null;
  fileNumber: string | null;
  productProfile: string | null;
  specificProductProfile: string | null;
  specialRequest: string | null;
  description: string | null;
  remarks: string | null;
  productCategory: string | null;
  noOfStalls: number | null;
  maxCategoriesForRegistration: number | null;
  allowOverseasUser: boolean | null;
  isMarqueeEnabled: boolean | null;
  isSecondaryEnabled: boolean | null;
}

/** A hall in an event, as ITPO's event detail gives it. */
export interface ItpoEventHall {
  /** The hall's id in the event. */
  eventHallId: string;
  hallId: number;
  name: string;
  forStallFnb: boolean;
  forHorseShoe: boolean;
  stallCount: number;
  isPriceAdded: boolean;
  /** The hall's cover picture (its first image), when it has one. */
  coverImage: string | null;
  /** The event has a layout of its own for this hall. */
  hasLayout: boolean;
}

/** An event with its halls, as ITPO's event detail gives it. */
export interface ItpoEventDetail {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  halls: ItpoEventHall[];
}

export interface Organisation {
  id: string;
  name: string;
}

export interface EventListQuery {
  kind: EventListKind;
  page: number;
  size: number;
  keyword?: string;
}

/** A category as ITPO lists it for an event or one of its halls. */
export interface EventCategory {
  id: number;
  name: string;
}
