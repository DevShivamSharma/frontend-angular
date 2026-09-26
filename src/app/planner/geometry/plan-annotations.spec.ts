import { cardLayout, planCards } from './plan-annotations';

describe('plan annotations', () => {
  it('lays out one card row the size measured on the reference plan', () => {
    const layout = cardLayout(['Emergency Exit', 'Stairs/Elevators']);
    // ~16 x 4.3 m for this pair on the Hall 14GF plan.
    expect(layout.width).toBeGreaterThan(15);
    expect(layout.width).toBeLessThan(17.5);
    expect(layout.height).toBeCloseTo(4.2, 1);
    expect(layout.slots[0].iconX).toBeLessThan(layout.slots[1].iconX);
  });

  it('groups anchored icons by card, in slot order', () => {
    const anchor = { x: 1, z: 2 };
    const cards = planCards([
      { position: { x: 9, z: 3 }, anchor, slot: 1, kind: 'b' },
      { position: { x: 4, z: 3 }, anchor, slot: 0, kind: 'a' },
      { position: { x: 30, z: 3 }, anchor: { x: 28, z: 2 }, slot: 0, kind: 'c' },
    ]);
    expect(cards.length).toBe(2);
    expect(cards[0].items.map((i) => i.kind)).toEqual(['a', 'b']);
    expect(cards[0].anchor).toEqual(anchor);
  });

  it('recovers the card of older seed data, whose icons were spread 5 m around the anchor', () => {
    // Hall 1GF as seeded before: one row at x -62, -57, (-52 dropped: unsupported icon), -47.
    const cards = planCards([
      { position: { x: -57, z: 42 }, kind: 'toilet-female' },
      { position: { x: -62, z: 42 }, kind: 'toilet-male' },
      { position: { x: -47, z: 42 }, kind: 'stairs' },
      { position: { x: 18, z: 42 }, kind: 'toilet-male' },
    ]);
    expect(cards.length).toBe(2);
    expect(cards[0].items.map((i) => i.kind)).toEqual(['toilet-male', 'toilet-female', 'stairs']);
    expect(cards[0].anchor).toEqual({ x: -54.5, z: 42 });
    expect(cards[1].anchor).toEqual({ x: 18, z: 42 });
  });
});
