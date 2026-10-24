import { Corner, Outline } from './hall-shape.model';

/** The longest side of a hall, in metres; the same limit as the API's. */
export const MAX_SIDE = 2000;
/** Most corners an outline may have. */
export const MAX_CORNERS = 200;

/** Width and depth of an outline's bounding box. */
export function extent(ring: readonly Corner[]): { width: number; depth: number } {
  return {
    width: cm(Math.max(...ring.map((q) => q[0])) - Math.min(...ring.map((q) => q[0]))),
    depth: cm(Math.max(...ring.map((q) => q[1])) - Math.min(...ring.map((q) => q[1]))),
  };
}

/** Floor inside an outline, in square metres. */
export function outlineArea(ring: readonly Corner[]): number {
  return Math.abs(signedArea(ring));
}

/**
 * A raw outline made ready: moved to the origin, rounded to the centimetre, drawn clockwise, and
 * checked (it has a floor, fits the limit, and does not cross itself).
 */
export function finishOutline(raw: readonly Corner[]): Outline {
  const minX = Math.min(...raw.map((q) => q[0]));
  const minY = Math.min(...raw.map((q) => q[1]));
  let ring = raw
    .map(([x, y]): Corner => [cm(x - minX), cm(y - minY)])
    .filter((q, i, all) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1]);
  if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return bad('Give at least three corners.');

  const area = signedArea(ring);
  if (Math.abs(area) < 1) return bad('The outline has no floor.');
  // Clockwise on screen (y down) is a positive area here.
  if (area < 0) ring = [ring[0], ...ring.slice(1).reverse()];

  const { width, depth } = extent(ring);
  if (width > MAX_SIDE || depth > MAX_SIDE) return bad(`At most ${MAX_SIDE} m a side.`);
  if (crossesItself(ring)) return bad('The outline crosses itself.');
  return { ring, error: null };
}

/** A rectangle's four corners. */
export function box(width: number, depth: number): Corner[] {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ];
}

/** An ellipse as a many-cornered outline. */
export function ellipse(width: number, depth: number, steps: number): Corner[] {
  return Array.from({ length: steps }, (_, i): Corner => {
    const a = (2 * Math.PI * i) / steps;
    return [(width / 2) * (1 + Math.cos(a)), (depth / 2) * (1 + Math.sin(a))];
  });
}

/**
 * Corners typed as text: "x, y" pairs separated by new lines or semicolons, e.g.
 * "0,0; 40,0; 40,30; 0,30". Null when a pair cannot be read.
 */
export function parseCorners(text: string): Corner[] | null {
  const pairs = text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const points: Corner[] = [];
  for (const pair of pairs) {
    const match = /^\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(pair);
    if (!match) return null;
    points.push([Number(match[1]), Number(match[2])]);
  }
  return points;
}

function signedArea(ring: readonly Corner[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function crossesItself(ring: readonly Corner[]): boolean {
  const n = ring.length;
  const cross = (a: Corner, b: Corner, c: Corner) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Rounded to the centimetre (and never -0). */
const cm = (n: number) => Math.round(n * 100) / 100 + 0;
const same = (a: Corner, b: Corner) => a[0] === b[0] && a[1] === b[1];
const bad = (error: string): Outline => ({ ring: null, error });
