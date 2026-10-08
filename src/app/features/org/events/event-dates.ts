const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const FULL = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const at = (d: string) => new Date(`${d}T00:00:00Z`);

/** One date, `YYYY-MM-DD` → "14 Nov 2026". */
export function formatDay(d: string): string {
  return FULL.format(at(d));
}

/** A span of days, shortened where the month or year repeat: "14–27 Nov 2026". */
export function formatDays(from: string, to: string): string {
  if (from === to) return formatDay(from);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${DAY.format(at(from))}–${FULL.format(at(to))}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${DAY_MONTH.format(at(from))} – ${FULL.format(at(to))}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}
