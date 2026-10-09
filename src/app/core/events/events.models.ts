/** Mirrors the backend's events, their halls and organisers (Module D). */
import type { CreatedInvitation, HallFloor, InvitationView, MemberView } from '../api/api.models';
import type { CategoryRef } from '../categories/categories.models';
import type { EventType, RuleId, RuleValues } from '../rules/rules.models';

export type EventKind = 'internal' | 'external';

export interface EventView {
  id: string;
  kind: EventKind;
  name: string;
  venueEventId: string | null;
  organiserName: string | null;
  audience: EventType;
  /** Dates are `YYYY-MM-DD`. */
  startsOn: string;
  endsOn: string;
  buildUpOn: string | null;
  dismantleOn: string | null;
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
  event: { id: string; name: string; kind: EventKind; audience: EventType };
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
