import { priceBandsOf } from './price-bands';
import type { StallPrice } from './stall-price';

const price = (n: number): StallPrice => ({
  price: n,
  from: 'card',
  type: 'general',
  reckoning: '',
});

describe('priceBandsOf', () => {
  it('should cut the prices into bands of about as many stalls, cheapest palest', () => {
    const prices = new Map<string, StallPrice | null>(
      Array.from({ length: 10 }, (_, i) => [`s${i}`, price((i + 1) * 1000)]),
    );
    const { bands, colors } = priceBandsOf(prices);
    expect(bands.length).toBe(5);
    expect(bands.map((b) => b.count)).toEqual([2, 2, 2, 2, 2]);
    expect(new Map(colors).get('s0')).toBe(bands[0].color);
    expect(new Map(colors).get('s9')).toBe(bands[4].color);
    expect(bands[0].label).toBe('Up to ₹2,000');
  });

  it('should leave a stall with no price out, and give few prices few bands', () => {
    const { bands, colors } = priceBandsOf(
      new Map<string, StallPrice | null>([
        ['a', price(5000)],
        ['b', price(5000)],
        ['c', null],
      ]),
    );
    expect(bands.length).toBe(1);
    expect(colors.map(([id]) => id)).toEqual(['a', 'b']);
    expect(priceBandsOf(new Map()).bands).toEqual([]);
  });
});
