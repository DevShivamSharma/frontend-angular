/** Venue time always uses New Delhi (UTC+05:30), regardless of the viewer's timezone. */
export function delhiTime(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(11, 16);
}

/** Keep the venue's established daily lighting schedule: 06:30–18:30 IST. */
export function isVenueDaylight(time: string): boolean {
  return time >= '06:30' && time < '18:30';
}

export function isValidVenueTime(time: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}
