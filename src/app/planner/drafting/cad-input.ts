import type { Point } from '../geometry/placement-rules';
import { CadFrame, cadDirection, StallSize } from './cad-geometry';

/**
 * What an architect can type at a point prompt, as in AutoCAD:
 *   `42,18.5`   absolute CAD coordinates
 *   `@3,0`      relative to the last point
 *   `@36<0`     relative polar: distance < angle (degrees, counter-clockwise)
 *   `12<90`     absolute polar, from the drawing origin
 *   `36`        direct distance, along the cursor direction from the last point
 */
export type PointEntry =
  | { kind: 'absolute'; x: number; y: number }
  | { kind: 'relative'; dx: number; dy: number }
  | { kind: 'polar'; distance: number; angle: number; relative: boolean }
  | { kind: 'distance'; distance: number };

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const PAIR = new RegExp(`^(@)?\\s*(${NUM})\\s*,\\s*(${NUM})$`);
const POLAR = new RegExp(`^(@)?\\s*(${NUM})\\s*<\\s*(${NUM})$`);
const SINGLE = new RegExp(`^${NUM}$`);
const SIZE = new RegExp(`^(${NUM})\\s*[x×*]\\s*(${NUM})$`, 'i');

export function parseNumber(text: string): number | null {
  const t = text.trim();
  return SINGLE.test(t) ? Number(t) : null;
}

export function parsePointEntry(text: string): PointEntry | null {
  const t = text.trim();
  let m = PAIR.exec(t);
  if (m) {
    const a = Number(m[2]), b = Number(m[3]);
    return m[1] ? { kind: 'relative', dx: a, dy: b } : { kind: 'absolute', x: a, y: b };
  }
  m = POLAR.exec(t);
  if (m) return { kind: 'polar', distance: Number(m[2]), angle: Number(m[3]), relative: !!m[1] };
  if (t === '@') return { kind: 'relative', dx: 0, dy: 0 };
  const n = parseNumber(t);
  return n === null ? null : { kind: 'distance', distance: n };
}

/**
 * The world point an entry names. `last` is the previous point of the command (the base of
 * relative input), `direction` the world unit vector from it towards the cursor (direct distance).
 * Returns null when the entry needs a last point and there is none.
 */
export function resolvePointEntry(
  entry: PointEntry,
  frame: CadFrame,
  last: Point | null,
  direction: Point | null
): Point | null {
  switch (entry.kind) {
    case 'absolute':
      return frame.toWorld({ x: entry.x, y: entry.y });
    case 'relative':
      return last ? { x: last.x + entry.dx, z: last.z - entry.dy } : null;
    case 'polar': {
      const u = cadDirection(entry.angle);
      const from = entry.relative ? last : frame.toWorld({ x: 0, y: 0 });
      return from ? { x: from.x + u.x * entry.distance, z: from.z + u.z * entry.distance } : null;
    }
    case 'distance':
      return last && direction ? { x: last.x + direction.x * entry.distance, z: last.z + direction.z * entry.distance } : null;
  }
}

/** `3x2`, `3 × 2`, `6*3`: frontage x depth in metres. */
export function parseSize(text: string): StallSize | null {
  const m = SIZE.exec(text.trim());
  if (!m) return null;
  const width = Number(m[1]), depth = Number(m[2]);
  return width > 0 && depth > 0 && width <= 200 && depth <= 200 ? { width, depth } : null;
}

export function formatSize(size: StallSize): string {
  return `${trim(size.width)}x${trim(size.depth)}`;
}

export function trim(v: number, digits = 2): string {
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

/**
 * AutoCAD keyword input: the capital letters of an option are its shortcut (`Size` -> S,
 * `Back-to-back` -> B), and any unambiguous prefix of the whole word works too.
 */
export function matchKeyword(text: string, keywords: readonly string[]): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const exact = keywords.find(k => k.toLowerCase() === t);
  if (exact) return exact;
  const byShortcut = keywords.filter(k => shortcutOf(k).toLowerCase() === t);
  if (byShortcut.length === 1) return byShortcut[0];
  const byPrefix = keywords.filter(k => k.toLowerCase().startsWith(t));
  return byPrefix.length === 1 ? byPrefix[0] : null;
}

export function shortcutOf(keyword: string): string {
  const caps = keyword.replace(/[^A-Z]/g, '');
  return caps || keyword.charAt(0).toUpperCase();
}
