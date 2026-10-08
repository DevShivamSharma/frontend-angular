import type { OrgContext } from '../api/api.models';
import type { EventStatus, ExhibitorView } from './events.models';

/**
 * The event rules the pages need, mirrored from the server (`event-rules.ts`). The server
 * decides; these only keep actions it would refuse off the screen.
 */

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Moves an event may make. Completed and cancelled are final. */
const NEXT: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['draft', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canMove(from: EventStatus, to: EventStatus): boolean {
  return NEXT[from].includes(to);
}

/** Draft and scheduled events can still change; completed and cancelled ones cannot. */
export function isOpen(status: EventStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

/** Today in UTC, `YYYY-MM-DD`, as the server counts days. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Null when the event may be completed today; otherwise the server's reason. */
export function completeBlockedReason(endsOn: string, day: string = today()): string | null {
  return endsOn >= day ? `An event can be completed after its last day (${endsOn}).` : null;
}

/** Whether the signed-in member works on the events of its scope only (an event role). */
export function eventScoped(membership: OrgContext['membership']): boolean {
  return membership.role.scopeKind === 'event';
}

/** The exhibitors registered for every one of the events; none while no event is chosen. */
export function exhibitorsForEvents(
  exhibitors: readonly ExhibitorView[],
  eventIds: readonly string[],
): ExhibitorView[] {
  if (!eventIds.length) return [];
  return exhibitors.filter((e) => eventIds.every((id) => e.eventIds.includes(id)));
}
