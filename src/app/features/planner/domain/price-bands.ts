import type { StallPrice } from './stall-price';
import { rupees } from './stall-price';

/** The two schemes a stall is built in. */
export const SCHEME_COLORS = { shell: '#2563eb', raw: '#f59e0b' } as const;

/** Light to dark: cheaper stalls are paler. */
const BAND_COLORS = ['#bbf7d0', '#86efac', '#facc15', '#fb923c', '#ef4444'];

export interface PriceBand {
  color: string;
  label: string;
  count: number;
}

/**
 * The stalls' prices cut into up to five bands of about as many stalls each, cheapest first, with
 * a colour per stall; stalls with no price are left out (they keep their usual colour).
 */
export function priceBandsOf(prices: ReadonlyMap<string, StallPrice | null>): {
  bands: PriceBand[];
  colors: Array<[string, string]>;
} {
  const priced = [...prices]
    .filter((e): e is [string, StallPrice] => !!e[1])
    .sort((a, b) => a[1].price - b[1].price);
  if (!priced.length) return { bands: [], colors: [] };
  const distinct = [...new Set(priced.map(([, p]) => p.price))];
  const count = Math.min(BAND_COLORS.length, distinct.length);
  const bounds = Array.from(
    { length: count },
    (_, i) =>
      distinct[Math.min(distinct.length - 1, Math.ceil(((i + 1) * distinct.length) / count) - 1)],
  );
  const bandOf = (price: number) => bounds.findIndex((b) => price <= b);
  const bands: PriceBand[] = bounds.map((upper, i) => {
    const lower = i === 0 ? distinct[0] : bounds[i - 1];
    return {
      color: BAND_COLORS[Math.round((i * (BAND_COLORS.length - 1)) / Math.max(1, count - 1))],
      label: i === 0 ? `Up to ${rupees(upper)}` : `${rupees(lower)} to ${rupees(upper)}`,
      count: 0,
    };
  });
  const colors: Array<[string, string]> = [];
  for (const [id, p] of priced) {
    const band = bands[bandOf(p.price)];
    band.count++;
    colors.push([id, band.color]);
  }
  return { bands, colors };
}
