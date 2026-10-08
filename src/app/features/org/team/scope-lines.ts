import type { MembershipScope } from '../../../core/api/api.models';

/**
 * What an event role is given for, in a line or two: its events and the exhibitor it books
 * for. Ids the viewer cannot name (it cannot see those events or exhibitors) are counted.
 * A whole-organisation scope has no lines.
 */
export function scopeLines(
  scope: MembershipScope,
  eventNames: ReadonlyMap<string, string>,
  exhibitorNames: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  if (scope.eventIds) {
    lines.push(eventsLine(scope.eventIds, eventNames));
  }
  if (scope.exhibitorId) {
    const name = exhibitorNames.get(scope.exhibitorId);
    lines.push(name ? `Exhibitor: ${name}` : 'Books for an exhibitor');
  }
  return lines;
}

function eventsLine(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  if (!ids.length) return 'No events';
  const named = ids.flatMap((id) => names.get(id) ?? []);
  const others = ids.length - named.length;
  if (!named.length) return `${others} ${others === 1 ? 'event' : 'events'}`;
  const label = ids.length === 1 ? 'Event' : 'Events';
  const rest = others ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : '';
  return `${label}: ${named.join(', ')}${rest}`;
}
