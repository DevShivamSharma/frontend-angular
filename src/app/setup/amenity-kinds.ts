/**
 * The amenity kinds the hall import recognises, and how the setup screens name and group them.
 * `kind` is also the icon's base name under `assets/images/`, exactly as the stall planner's
 * 3D annotations use it, so an imported hall looks the same in both places.
 */
export interface AmenityKindInfo {
  kind: string;
  label: string;
  group: AmenityGroup;
}

export type AmenityGroup = 'Toilets' | 'Lifts & stairs' | 'Entries & exits' | 'Facilities';

export const AMENITY_GROUPS: readonly AmenityGroup[] = ['Entries & exits', 'Toilets', 'Lifts & stairs', 'Facilities'];

export const AMENITY_KINDS: readonly AmenityKindInfo[] = [
  { kind: 'entry-up', label: 'Entry / gate', group: 'Entries & exits' },
  { kind: 'emergency-exit', label: 'Emergency exit', group: 'Entries & exits' },
  { kind: 'cargo-truck', label: 'Cargo / service entry', group: 'Entries & exits' },
  { kind: 'toilet-male', label: 'Toilet (Male)', group: 'Toilets' },
  { kind: 'toilet-female', label: 'Toilet (Female)', group: 'Toilets' },
  { kind: 'toilet', label: 'Toilets', group: 'Toilets' },
  { kind: 'lift', label: 'Lift', group: 'Lifts & stairs' },
  { kind: 'stairs', label: 'Stairs', group: 'Lifts & stairs' },
  { kind: 'drinking-water', label: 'Drinking water', group: 'Facilities' }
];

const BY_KIND = new Map(AMENITY_KINDS.map(k => [k.kind, k]));

export function amenityInfo(kind: string): AmenityKindInfo {
  return BY_KIND.get(kind) ?? { kind, label: kind.replace(/-/g, ' '), group: 'Facilities' };
}

/** Local icon only: an unexpected kind name can never make the page load another URL. */
export function amenityIcon(kind: string): string {
  return /^[a-z][a-z-]{0,40}$/.test(kind) ? `assets/images/${kind}.svg` : 'assets/images/info.svg';
}
