import { scopeLines } from './scope-lines';

describe('scopeLines', () => {
  const events = new Map([
    ['e1', 'Book Fair'],
    ['e2', 'Trade Fair'],
  ]);
  const exhibitors = new Map([['x1', 'Acme Books']]);

  it('has no lines for the whole organisation', () => {
    expect(scopeLines({}, events, exhibitors)).toEqual([]);
  });

  it('names the events and the exhibitor', () => {
    expect(scopeLines({ eventIds: ['e1'] }, events, exhibitors)).toEqual(['Event: Book Fair']);
    expect(scopeLines({ eventIds: ['e1', 'e2'], exhibitorId: 'x1' }, events, exhibitors)).toEqual([
      'Events: Book Fair, Trade Fair',
      'Exhibitor: Acme Books',
    ]);
  });

  it('counts what the viewer cannot name', () => {
    expect(scopeLines({ eventIds: ['e1', 'e9'] }, events, exhibitors)).toEqual([
      'Events: Book Fair and 1 other',
    ]);
    expect(scopeLines({ eventIds: ['e8', 'e9'], exhibitorId: 'x9' }, new Map(), new Map())).toEqual(
      ['2 events', 'Books for an exhibitor'],
    );
  });

  it('says so when an event role lists no event', () => {
    expect(scopeLines({ eventIds: [] }, events, exhibitors)).toEqual(['No events']);
  });
});
