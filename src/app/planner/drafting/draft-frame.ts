import type { Point } from '../geometry/placement-rules';

/**
 * The drafting workspace speaks AutoCAD's language: X to the right, Y UP, origin at the hall's
 * lower-left corner, angles counter-clockwise from east (0° = east, 90° = north), metres.
 *
 * The planner's world is centre-origin metres with Z pointing DOWN the plan (posX / posZ). This
 * frame converts between the two, so every coordinate an architect types or reads is a CAD one,
 * while stalls stay stored exactly as before.
 */
export class DraftFrame {
  /**
   * @param originX world X of the hall's left edge
   * @param bottomZ world Z of the hall's bottom edge (its largest Z)
   */
  constructor(
    readonly originX: number,
    readonly bottomZ: number,
  ) {}

  toUser(p: Point): { x: number; y: number } {
    return { x: clean(p.x - this.originX), y: clean(this.bottomZ - p.z) };
  }

  toWorld(u: { x: number; y: number }): Point {
    return { x: clean(u.x + this.originX), z: clean(this.bottomZ - u.y) };
  }

  /** A CAD angle (degrees, counter-clockwise, 0 = east) as a world direction (Z down). */
  static direction(angleDeg: number): Point {
    const a = (angleDeg * Math.PI) / 180;
    return { x: clean(Math.cos(a)), z: clean(-Math.sin(a)) };
  }

  /** The CAD angle of the world vector from `a` to `b`, in [0, 360). */
  static angle(a: Point, b: Point): number {
    const deg = (Math.atan2(-(b.z - a.z), b.x - a.x) * 180) / Math.PI;
    return clean((deg + 360) % 360);
  }
}

/**
 * A point typed at a prompt, as AutoCAD reads it:
 *   `x,y`     absolute, in the hall frame
 *   `@dx,dy`  relative to the last point
 *   `@d<a`    polar: distance d at angle a (degrees, counter-clockwise from east)
 *   `d`       direct distance: d metres from the last point towards the cursor
 * Returns null when the text is not a point (it may be an option or a value instead).
 */
export function parsePoint(
  text: string,
  frame: DraftFrame,
  last: Point | null,
  cursor: Point | null,
): Point | null {
  const t = text.trim().replace(/\s+/g, '');
  const num = '(-?\\d+(?:\\.\\d+)?|-?\\.\\d+)';
  let m = new RegExp(`^${num},${num}$`).exec(t);
  if (m) return frame.toWorld({ x: Number(m[1]), y: Number(m[2]) });
  if (!last) return null;
  m = new RegExp(`^@${num},${num}$`).exec(t);
  if (m) return { x: clean(last.x + Number(m[1])), z: clean(last.z - Number(m[2])) };
  m = new RegExp(`^@${num}<${num}$`).exec(t);
  if (m) {
    const d = DraftFrame.direction(Number(m[2]));
    return { x: clean(last.x + d.x * Number(m[1])), z: clean(last.z + d.z * Number(m[1])) };
  }
  m = new RegExp(`^${num}$`).exec(t);
  if (m && cursor) {
    const dx = cursor.x - last.x;
    const dz = cursor.z - last.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return null;
    const d = Number(m[1]);
    return { x: clean(last.x + (dx / len) * d), z: clean(last.z + (dz / len) * d) };
  }
  return null;
}

/** `3x2`, `3 x 2`, `3*2`, `3,2` or `3` (square) -> [width, length] in metres; null otherwise. */
export function parseSize(text: string): [number, number] | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[x×*,]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(text);
  if (!m) return null;
  const w = Number(m[1]);
  const l = m[2] === undefined ? w : Number(m[2]);
  return w > 0 && l > 0 ? [w, l] : null;
}

/** Constrains `p` to horizontal or vertical from `base` (ORTHO). */
export function orthoPoint(base: Point, p: Point): Point {
  return Math.abs(p.x - base.x) >= Math.abs(p.z - base.z) ? { x: p.x, z: base.z } : { x: base.x, z: p.z };
}

/** Constrains `p` to the nearest multiple of `stepDeg` around `base` (POLAR tracking). */
export function polarPoint(base: Point, p: Point, stepDeg = 15): Point {
  const len = Math.hypot(p.x - base.x, p.z - base.z);
  if (len < 1e-9) return p;
  const a = Math.round(DraftFrame.angle(base, p) / stepDeg) * stepDeg;
  const d = DraftFrame.direction(a);
  return { x: clean(base.x + d.x * len), z: clean(base.z + d.z * len) };
}

export function fmt(v: number, digits = 2): string {
  return (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits);
}

export function clean(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}
