import type { RoleScopeKind } from '../api/api.models';
import type { ExhibitorView } from './events.models';
import {
  canMove,
  completeBlockedReason,
  eventScoped,
  exhibitorsForEvents,
  isOpen,
  today,
} from './event-rules';

describe('event rules', () => {
  it('moves an event as the server does', () => {
    expect(canMove('draft', 'scheduled')).toBeTrue();
    expect(canMove('draft', 'cancelled')).toBeTrue();
    expect(canMove('draft', 'completed')).toBeFalse();
    expect(canMove('scheduled', 'draft')).toBeTrue();
    expect(canMove('scheduled', 'completed')).toBeTrue();
    expect(canMove('scheduled', 'cancelled')).toBeTrue();
    expect(canMove('completed', 'draft')).toBeFalse();
    expect(canMove('cancelled', 'scheduled')).toBeFalse();
  });

  it('keeps only draft and scheduled events open', () => {
    expect(isOpen('draft')).toBeTrue();
    expect(isOpen('scheduled')).toBeTrue();
    expect(isOpen('completed')).toBeFalse();
    expect(isOpen('cancelled')).toBeFalse();
  });

  it('completes an event only after its last day, counted in UTC', () => {
    expect(today(new Date('2026-10-09T23:30:00Z'))).toBe('2026-10-09');
    expect(completeBlockedReason('2026-10-08', '2026-10-09')).toBeNull();
    expect(completeBlockedReason('2026-10-09', '2026-10-09')).toBe(
      'An event can be completed after its last day (2026-10-09).',
    );
  });

  it('tells event-scoped members by their role', () => {
    const member = (scopeKind: RoleScopeKind) => ({
      id: 'm',
      role: { id: 'r', key: 'k', name: 'Role', scopeKind },
      scope: {},
    });
    expect(eventScoped(member('organisation'))).toBeFalse();
    expect(eventScoped(member('event'))).toBeTrue();
  });

  it('offers exhibitors registered for every chosen event', () => {
    const exhibitor = (id: string, eventIds: string[]) => ({ id, eventIds }) as ExhibitorView;
    const all = [exhibitor('a', ['e1', 'e2']), exhibitor('b', ['e1']), exhibitor('c', [])];
    expect(exhibitorsForEvents(all, []).map((x) => x.id)).toEqual([]);
    expect(exhibitorsForEvents(all, ['e1']).map((x) => x.id)).toEqual(['a', 'b']);
    expect(exhibitorsForEvents(all, ['e1', 'e2']).map((x) => x.id)).toEqual(['a']);
  });
});
