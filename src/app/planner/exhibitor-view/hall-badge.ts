/**
 * What the hall badge shows, read from the hall's saved name only: "Hall 14GF" is hall "14" on
 * the ground floor, "Hall 12A" is hall "12A" with no floor given. A name that is not "Hall …"
 * (e.g. "Hangar 7A") is shown whole. Nothing is shown that the name does not say.
 */
export interface HallBadge {
  /** "HALL" when the name says so, else null. */
  kicker: string | null;
  code: string;
  /** e.g. "GF · Ground floor", or null when the name gives no floor. */
  floor: string | null;
}

const FLOORS: Record<string, string> = {
  GF: 'Ground floor',
  FF: 'First floor',
  SF: 'Second floor',
  TF: 'Third floor'
};

export function hallBadge(name: string | null | undefined): HallBadge {
  const text = String(name ?? '').trim();
  const hall = /^hall\s+(.+)$/i.exec(text);
  if (!hall) return { kicker: null, code: text || 'Hall', floor: null };

  const floor = /^(.*\d)\s*(GF|FF|SF|TF)$/i.exec(hall[1]);
  if (!floor) return { kicker: 'HALL', code: hall[1], floor: null };
  const tag = floor[2].toUpperCase();
  return { kicker: 'HALL', code: floor[1], floor: `${tag} · ${FLOORS[tag]}` };
}
