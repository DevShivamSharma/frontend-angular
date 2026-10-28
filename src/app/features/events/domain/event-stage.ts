import { EventSummary } from '../data/events.models';
import { statusSeverity } from './event-status';

/** Where an event is opened: under the menu item its kind belongs to. */
export const eventLink = (event: EventSummary): string[] => [
  event.kind === 'internal' ? '/events' : '/external-events',
  event.id,
];

/** Who runs the event and its kind, the line under its name: "ITPO · B2B". */
export function eventByline(event: EventSummary): string {
  const who = event.kind === 'internal' ? 'ITPO' : event.organisation;
  const type = event.eventType?.replace(/ both$/, '');
  return [who, type].filter(Boolean).join(' · ');
}

/** Where the event is: an internal one is a draft until it is published, an external one is its approval. */
export function eventStage(event: EventSummary): { label: string; severity: string } | null {
  if (event.kind === 'internal') {
    return event.visible
      ? { label: 'Published', severity: 'success' }
      : { label: 'Draft', severity: 'info' };
  }
  const status = event.approvalStatus ?? event.bookingStatus;
  return status ? { label: status, severity: statusSeverity(status) } : null;
}
