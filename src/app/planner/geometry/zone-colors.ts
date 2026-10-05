import type { PlanningZone } from './planning-zones';

/** Display colours identify individual areas; zone kind still controls planning rules. */
export const ZONE_PALETTE = ['#2563eb', '#c2410c', '#7e22ce', '#047857', '#be185d', '#0e7490', '#854d0e', '#4338ca', '#a21caf', '#4d7c0f', '#b91c1c', '#475569'] as const;
export const validZoneColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function paletteColor(index: number): string {
  if (index < ZONE_PALETTE.length) return ZONE_PALETTE[index];
  const h = ((index - ZONE_PALETTE.length) * 137.508 + 17) % 360;
  const saturation = 0.62, lightness = 0.38 + (index % 3) * 0.06;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function planningZoneColor(zone: PlanningZone, index = 0): string {
  return validZoneColor(zone.color) ? zone.color.toLowerCase() : paletteColor(index);
}

export function nextPlanningZoneColor(zones: readonly PlanningZone[], ignoreId?: string): string {
  const used = new Set(zones.map((zone, index) => zone.id === ignoreId ? '' : planningZoneColor(zone, index)));
  for (let index = 0; ; index++) {
    const color = paletteColor(index);
    if (!used.has(color)) return color;
  }
}

/** Keep zone captions readable even when a user chooses a very light custom colour. */
export function zoneLabelColor(color: string): string {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179 ? '#000000' : '#ffffff';
}
