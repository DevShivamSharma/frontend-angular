import type { RuleValues } from '../../rules/data/rules.models';
import type { HallFloor } from './floor.models';

export type EventKind = 'internal' | 'external';
/** The audience of an event: the rules' passage widths differ for B2B and B2C. */
export type EventType = 'B2B' | 'B2C';

/** A category the hall sells; its id is ITPO's code-master id, as text. */
export interface CategoryRef {
  id: string;
  name: string;
  /** The planner offers only the active ones. */
  status: 'active' | 'inactive';
}

/** The event hall the planner is open on. */
export interface EventHallView {
  /** The event hall's id. */
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
  overlaps: unknown[];
}

/** The rules that apply to the event hall. */
export interface EventHallRules {
  switches: Record<string, boolean>;
  values: RuleValues;
  drawingProfile: string;
}

export interface EventHallDetailView {
  event: {
    id: string;
    name: string;
    kind: EventKind;
    status: string;
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
