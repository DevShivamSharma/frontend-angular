import { normalizeStall } from '../geometry/planner-geometry';
import type { StallInput } from '../models/stall.model';
import {
  exhibitorStalls,
  matchesFilters,
  matchesQuery,
  stallLabel,
  toExhibitorStall,
  type StallFilters
} from './exhibitor-view';

const stall = (input: Partial<StallInput>) =>
  normalizeStall({ width: 3, length: 4, posX: 0, posZ: 0, openSides: ['FRONT'], ...input }, 'h1');

describe('exhibitor view', () => {
  it('offers every stall but the cancelled ones, in natural name order', () => {
    const list = exhibitorStalls([
      stall({ id: 1, name: '12A-10 A' }),
      stall({ id: 2, name: '12A-2 B', status: 'BOOKED' }),
      stall({ id: 3, name: '12A-2 A', status: 'CANCELLED' }),
      stall({ id: 4, name: '12A-2 A' })
    ]);
    expect(list.map(s => s.name)).toEqual(['12A-2 A', '12A-2 B', '12A-10 A']);
    expect(list.map(s => s.available)).toEqual([true, false, true]);
  });

  it('draws the saved outline, rotation included, and marks only the open sides open', () => {
    const s = toExhibitorStall(stall({ id: 1, name: 'A', posX: 10, posZ: 5, rotation: 90, openSides: ['FRONT'] }));
    // A 3 x 4 m stall turned a quarter covers 4 m along x and 3 m along z.
    expect(s.bounds.maxX - s.bounds.minX).toBeCloseTo(4);
    expect(s.bounds.maxZ - s.bounds.minZ).toBeCloseTo(3);
    expect(s.edges.map(e => e.open)).toEqual([false, false, true, false]);
    expect(s.area).toBe(12);
    expect(s.sizeText).toBe('3 × 4 m');
  });

  it('names the frontage from the saved open sides', () => {
    const frontage = (openSides: StallInput['openSides']) => toExhibitorStall(stall({ id: 1, name: 'A', openSides })).frontage;
    expect(frontage(['FRONT'])).toBe('Inline · 1 open side');
    expect(frontage(['FRONT', 'RIGHT'])).toBe('Corner · 2 open sides');
    expect(frontage(['FRONT', 'BACK'])).toBe('Open on opposite sides · 2 open sides');
    expect(frontage(['FRONT', 'BACK', 'LEFT'])).toBe('Peninsula · 3 open sides');
    expect(frontage(['FRONT', 'BACK', 'LEFT', 'RIGHT'])).toBe('Island · all sides open');
  });

  it('finds a stall by name or number, ignoring case and spaces', () => {
    const s = toExhibitorStall(stall({ id: 1, name: '12A-14 C', stallNumber: 'STALL-054' }));
    expect(matchesQuery(s, '12a-14c')).toBeTrue();
    expect(matchesQuery(s, 'stall-054')).toBeTrue();
    expect(matchesQuery(s, '12A-15')).toBeFalse();
    expect(matchesQuery(s, '  ')).toBeTrue();
  });

  it('filters by availability, size band and type together; an empty choice means all', () => {
    const small = toExhibitorStall(stall({ id: 1, name: 'S', openSides: ['FRONT'] }));
    const corner = toExhibitorStall(stall({ id: 2, name: 'C', width: 5, length: 5, openSides: ['FRONT', 'LEFT'] }));
    const island = toExhibitorStall(stall({ id: 3, name: 'I', width: 10, length: 5, openSides: ['FRONT', 'BACK', 'LEFT', 'RIGHT'], status: 'BOOKED' }));
    expect([small.size, corner.size, island.size]).toEqual(['SMALL', 'MEDIUM', 'LARGE']);
    expect([small.kind, corner.kind, island.kind]).toEqual(['INLINE', 'CORNER', 'ISLAND']);

    const all = [small, corner, island];
    const pick = (f: Partial<StallFilters>) => all
      .filter(s => matchesFilters(s, { query: '', onlyAvailable: false, sizes: new Set(), kinds: new Set(), ...f }))
      .map(s => s.name);
    expect(pick({})).toEqual(['S', 'C', 'I']);
    expect(pick({ sizes: new Set(['MEDIUM', 'LARGE']) })).toEqual(['C', 'I']);
    expect(pick({ kinds: new Set(['ISLAND']), onlyAvailable: true })).toEqual([]);
    expect(pick({ kinds: new Set(['INLINE', 'CORNER']), query: 'c' })).toEqual(['C']);
  });

  it('turns the name upright in a tall, narrow stall', () => {
    const outline = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 8 }, { x: 0, z: 8 }];
    const label = stallLabel('12A-11 A', outline, { minX: 0, maxX: 3, minZ: 0, maxZ: 8 });
    expect(label.vertical).toBeTrue();
    expect(label.at).toEqual({ x: 1.5, z: 4 });
  });
});
