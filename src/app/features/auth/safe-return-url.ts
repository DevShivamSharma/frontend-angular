/**
 * A return URL from the query string, only if it stays inside the app under `base`. Anything
 * else (another site, another organisation) falls back to `base` itself.
 */
export function safeReturnUrl(candidate: string | null, base: string): string {
  if (candidate && candidate.startsWith(base) && !candidate.startsWith('//')) {
    return candidate;
  }
  return base;
}
