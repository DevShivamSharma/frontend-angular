/**
 * The search panel's history (venue-map.component.html): pinned shortcuts sit above recent entries, exactly as
 * Google Maps keeps Home/Work over recents. Entries resolve by label at click time, so nothing breaks if the
 * walks graph's node ids ever change. Routes are recorded by the explorer (home-page.component.ts) when a plan
 * is walked, places by the map itself on every pick; both share this one store.
 */

export interface HistoryEntry {
  kind: 'place' | 'route';
  /** The row's bold line: a place's label, or "Gate 9 → Hall 6" for a route. */
  label: string;
  /** The grey line under it. */
  sub: string;
  /** The place this row actually opens, when the bold line is wordier than a pin label ("Gate no. 9, ITPO Admin Block" → "ITPO Admin Block"). */
  ref?: string;
  /** Route legs, as labels ("Gate 9"), resolved against the map's places when clicked. */
  from?: string;
  to?: string;
  at: number;
}

const HISTORY_KEY = 'venue-explorer-history';
const MAX_ENTRIES = 12;

/** Shown until the visitor has searched or routed enough of their own; the Google screenshots' flavour. */
const SEED_ENTRIES: HistoryEntry[] = [
  { kind: 'place', label: 'Gate no. 9, ITPO Admin Block', sub: 'Saved in Favorites', ref: 'ITPO Admin Block', at: 4 },
  { kind: 'route', label: 'Gate 9 → Hall 6', sub: 'Walking route from Gate 9', from: 'Gate 9', to: 'Hall 6', at: 3 },
  { kind: 'route', label: 'Gate 9 → Convention Centre', sub: 'Walking route from Gate 9', from: 'Gate 9', to: 'Convention Centre', at: 2 },
  { kind: 'place', label: 'Bhairon Road Parking', sub: 'Parking', at: 1 },
];

export function loadHistory(): HistoryEntry[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
    if (Array.isArray(stored) && stored.length) return stored;
  } catch { /* storage blocked or unreadable: fall through to the seeds */ }
  return [...SEED_ENTRIES];
}

/** Newest first, one row per place/route; persisted for the next visit. */
export function loadSeedEntries(): HistoryEntry[] { return [...SEED_ENTRIES]; }

function save(entries: HistoryEntry[]): HistoryEntry[] {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* lasts this visit */ }
  return entries;
}

export function recordPlace(entries: HistoryEntry[], label: string, sub: string): HistoryEntry[] {
  const entry: HistoryEntry = { kind: 'place', label, sub, at: Date.now() };
  return save([entry, ...entries.filter(item => !(item.kind === 'place' && item.label === label))].slice(0, MAX_ENTRIES));
}

export function recordRoute(entries: HistoryEntry[], from: string, to: string): HistoryEntry[] {
  const entry: HistoryEntry = { kind: 'route', label: `${from} → ${to}`, sub: `Walking route from ${from}`, from, to, at: Date.now() };
  return save([entry, ...entries.filter(item => !(item.kind === 'route' && item.from === from && item.to === to))].slice(0, MAX_ENTRIES));
}
