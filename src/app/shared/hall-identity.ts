export function parseHallIdentity(value: unknown): { halls: string[]; floor: 'GF' | 'FF' | null } | null {
  const match = /^hall[\s_-]*(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)*)\s*(GF|FF)?$/i.exec(String(value).trim());
  return match ? { halls: match[1].toUpperCase().split(/\s*[-–]\s*/), floor: match[2]?.toUpperCase() as 'GF' | 'FF' || null } : null;
}

/** Match venue hall numbers to planner records, including combined halls and floor suffixes. */
export function findVenueHall<T extends { name: string }>(halls: readonly T[], number: string, floor: string | null): T | undefined {
  const requested = number.trim().toUpperCase();
  const candidates = halls.flatMap(hall => {
    const identity = parseHallIdentity(hall.name);
    return identity?.halls.includes(requested) ? [{ hall, identity }] : [];
  });
  const wantedFloor = floor?.toUpperCase();
  if (wantedFloor && wantedFloor !== 'GF' && wantedFloor !== 'FF') return undefined;
  const eligible = candidates.filter(({ identity }) => !wantedFloor || !identity.floor || identity.floor === wantedFloor);
  eligible.sort((a, b) => {
    const rank = (item: typeof a) => (item.identity.floor === (wantedFloor || 'GF') ? 0 : item.identity.floor === null ? 1 : 2) * 10 + item.identity.halls.length;
    return rank(a) - rank(b);
  });
  return eligible[0]?.hall;
}
