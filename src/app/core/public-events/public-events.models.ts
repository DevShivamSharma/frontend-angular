/** Mirrors the backend's public event views: what anyone with the link may see. */

import type { HallFloor, OrganisationBranding } from '../api/api.models';
import type { EventStatus } from '../events/events.models';
import type { PublishedStallView } from '../bookings/bookings.models';

export interface PublicEventView {
  organisation: { slug: string; name: string; branding: OrganisationBranding };
  event: {
    id: string;
    name: string;
    status: EventStatus;
    startsOn: string;
    endsOn: string;
    organiserName: string | null;
  };
  /** Halls whose plan is published, with their stalls for sale and how many are still free. */
  halls: Array<{
    hallId: string;
    name: string;
    width: number;
    depth: number;
    floorArea: number;
    totalStalls: number;
    freeStalls: number;
  }>;
  bookingOpen: boolean;
  /** Null while bookings are open; otherwise why not. */
  closedReason: string | null;
  /** Where to write to be invited; null when the organisation gave none. */
  contactEmail: string | null;
}

/** `unavailable`: held or booked, the public cannot tell which. */
export type PublicStallState = 'free' | 'unavailable' | 'not_for_sale';

export interface PublicStallView extends PublishedStallView {
  state: PublicStallState;
}

export interface PublicStallMapView {
  event: { id: string; name: string; status: EventStatus };
  hall: { id: string; name: string; floorVersion: number };
  bookingOpen: boolean;
  closedReason: string | null;
  floor: HallFloor;
  stalls: PublicStallView[];
}
