import type { Point } from '../../../core/venues/floor-plan.models';

/**
 * Hall outlines drawn by size: the shapes halls are built in, from the common rectangle to the
 * fan of a cinema or the round of a rotunda. Each shape makes the hall's outline from a few
 * measurements, in floor metres (origin top-left, y down), as an open ring going clockwise.
 */

export type HallShapeId =
  | 'rectangle'
  | 'l'
  | 'u'
  | 't'
  | 'wedge'
  | 'fan'
  | 'round'
  | 'oval'
  | 'stadium'
  | 'polygon'
  | 'custom';

export interface ShapeParam {
  key: string;
  label: string;
  unit: 'm' | '°' | '';
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface HallShape {
  id: HallShapeId;
  label: string;
  /** Where such halls are found. */
  example: string;
  params: ShapeParam[];
}

/** An outline, or why the measurements make none. */
export type Outline = { ring: Point[]; error: null } | { ring: null; error: string };

/** Mirrors the server's limit on one side of a hall. */
export const MAX_SIDE = 2000;
/** Most corners a typed or clicked outline may have. */
export const MAX_CORNERS = 200;

const side = (key: string, label: string, value: number): ShapeParam => ({
  key,
  label,
  unit: 'm',
  min: 1,
  max: MAX_SIDE,
  step: 0.5,
  value,
});

export const HALL_SHAPES: HallShape[] = [
  {
    id: 'rectangle',
    label: 'Rectangle',
    example: 'Most exhibition halls, e.g. a pillar-free hall of a trade fair ground',
    params: [side('width', 'Width', 60), side('depth', 'Depth', 40)],
  },
  {
    id: 'l',
    label: 'L-shape',
    example: 'A hall with an annex, or one built round a corner block',
    params: [
      side('width', 'Width', 60),
      side('depth', 'Depth', 40),
      side('cutWidth', 'Corner cut-out width', 20),
      side('cutDepth', 'Corner cut-out depth', 15),
    ],
  },
  {
    id: 'u',
    label: 'U-shape',
    example: 'Wings round a courtyard or a forecourt',
    params: [
      side('width', 'Width', 80),
      side('depth', 'Depth', 50),
      side('gapWidth', 'Courtyard width', 30),
      side('gapDepth', 'Courtyard depth', 20),
    ],
  },
  {
    id: 't',
    label: 'T-shape',
    example: 'A wide front hall with a wing behind it',
    params: [
      side('width', 'Front width', 80),
      side('barDepth', 'Front depth', 20),
      side('stemWidth', 'Wing width', 30),
      side('depth', 'Total depth', 60),
    ],
  },
  {
    id: 'wedge',
    label: 'Wedge',
    example: 'A hall that widens from its entrance, as many convention halls do',
    params: [
      side('front', 'Front (top) width', 40),
      side('back', 'Back (bottom) width', 70),
      side('depth', 'Depth', 50),
    ],
  },
  {
    id: 'fan',
    label: 'Cinema / auditorium',
    example: 'A fan widening from the screen or stage, with a curved back wall',
    params: [
      side('stage', 'Screen / stage width', 16),
      side('depth', 'Depth', 30),
      { key: 'angle', label: 'Fan angle', unit: '°', min: 10, max: 150, step: 5, value: 60 },
    ],
  },
  {
    id: 'round',
    label: 'Round',
    example: 'A rotunda or a domed pavilion',
    params: [side('diameter', 'Diameter', 40)],
  },
  {
    id: 'oval',
    label: 'Oval',
    example: 'An oval arena or a garden pavilion',
    params: [side('width', 'Width', 80), side('depth', 'Depth', 50)],
  },
  {
    id: 'stadium',
    label: 'Arena',
    example: 'An indoor stadium: straight sides with round ends',
    params: [side('length', 'Length', 100), side('width', 'Width', 50)],
  },
  {
    id: 'polygon',
    label: 'Hexagon / octagon',
    example: 'A many-sided pavilion',
    params: [
      { key: 'sides', label: 'Sides', unit: '', min: 5, max: 12, step: 1, value: 6 },
      side('across', 'Across corners', 40),
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    example: 'Any other outline: type its corners, or click them on the grid',
    params: [],
  },
];

export function shapeById(id: HallShapeId): HallShape {
  return HALL_SHAPES.find((s) => s.id === id) ?? HALL_SHAPES[0];
}

/** The default measurements of a shape. */
export function defaultParams(id: HallShapeId): Record<string, number> {
  return Object.fromEntries(shapeById(id).params.map((p) => [p.key, p.value]));
}

/** The outline a shape makes with these measurements; `points` is for the custom shape. */
export function outlineOf(
  id: HallShapeId,
  p: Record<string, number>,
  points: Point[] = [],
): Outline {
  for (const param of shapeById(id).params) {
    const v = p[param.key];
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= param.min && v <= param.max)) {
      return bad(
        `${param.label}: ${param.min} to ${param.max}${param.unit ? ' ' + param.unit : ''}.`,
      );
    }
  }
  const ring = make(id, p, points);
  if (typeof ring === 'string') return bad(ring);
  return finish(ring);
}

function make(id: HallShapeId, p: Record<string, number>, points: Point[]): Point[] | string {
  switch (id) {
    case 'rectangle':
      return box(p['width'], p['depth']);
    case 'l': {
      const { width: w, depth: d, cutWidth: cw, cutDepth: cd } = p;
      if (cw >= w || cd >= d) return 'The cut-out must be smaller than the hall.';
      return [
        [0, 0],
        [w - cw, 0],
        [w - cw, cd],
        [w, cd],
        [w, d],
        [0, d],
      ];
    }
    case 'u': {
      const { width: w, depth: d, gapWidth: gw, gapDepth: gd } = p;
      if (gw >= w - 2 || gd >= d - 1)
        return 'The courtyard must leave wings and a back to the hall.';
      const a = (w - gw) / 2;
      return [
        [0, 0],
        [a, 0],
        [a, gd],
        [a + gw, gd],
        [a + gw, 0],
        [w, 0],
        [w, d],
        [0, d],
      ];
    }
    case 't': {
      const { width: w, barDepth: bd, stemWidth: sw, depth: d } = p;
      if (sw >= w) return 'The wing must be narrower than the front.';
      if (bd >= d) return 'The total depth must be more than the front depth.';
      const a = (w - sw) / 2;
      return [
        [0, 0],
        [w, 0],
        [w, bd],
        [a + sw, bd],
        [a + sw, d],
        [a, d],
        [a, bd],
        [0, bd],
      ];
    }
    case 'wedge': {
      const { front: f, back: b, depth: d } = p;
      const w = Math.max(f, b);
      return [
        [(w - f) / 2, 0],
        [(w + f) / 2, 0],
        [(w + b) / 2, d],
        [(w - b) / 2, d],
      ];
    }
    case 'fan': {
      const { stage, depth, angle } = p;
      const half = (angle * Math.PI) / 360;
      const r1 = stage / (2 * Math.sin(half));
      const r2 = r1 + depth;
      const steps = Math.max(8, Math.ceil(angle / 3));
      const at = (r: number, a: number): Point => [r * Math.sin(a), r * Math.cos(a)];
      const back: Point[] = [];
      for (let i = 0; i <= steps; i++) back.push(at(r2, -half + (2 * half * i) / steps));
      // The screen wall straight along the top, left to right; the back wall right to left.
      return [at(r1, -half), at(r1, half), ...back.reverse()];
    }
    case 'round':
      return ellipse(p['diameter'], p['diameter'], 64);
    case 'oval':
      return ellipse(p['width'], p['depth'], 72);
    case 'stadium': {
      const { length: l, width: w } = p;
      if (l <= w) return 'An arena is longer than it is wide.';
      const r = w / 2;
      const ring: Point[] = [];
      const steps = 24;
      // Right end, top to bottom; then the left end, bottom to top.
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / steps;
        ring.push([l - r + r * Math.cos(a), r + r * Math.sin(a)]);
      }
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / steps;
        ring.push([r + r * Math.cos(a), r + r * Math.sin(a)]);
      }
      return ring;
    }
    case 'polygon': {
      const n = Math.round(p['sides']);
      const r = p['across'] / 2;
      // A flat side along the top, where the entrance usually is.
      const start = -Math.PI / 2 + Math.PI / n;
      return Array.from({ length: n }, (_, i): Point => {
        const a = start + (2 * Math.PI * i) / n;
        return [r * Math.cos(a), r * Math.sin(a)];
      });
    }
    case 'custom':
      if (points.length < 3) return 'Give at least three corners.';
      if (points.length > MAX_CORNERS) return `At most ${MAX_CORNERS} corners.`;
      return points;
  }
}

/** Moved to the origin, rounded to the centimetre, clockwise, and checked. */
function finish(raw: Point[]): Outline {
  const minX = Math.min(...raw.map((q) => q[0]));
  const minY = Math.min(...raw.map((q) => q[1]));
  let ring = raw
    .map(([x, y]): Point => [cm(x - minX), cm(y - minY)])
    .filter((q, i, all) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1]);
  if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
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

/** Width and depth of an outline's box. */
export function extent(ring: Point[]): { width: number; depth: number } {
  return {
    width: cm(Math.max(...ring.map((q) => q[0])) - Math.min(...ring.map((q) => q[0]))),
    depth: cm(Math.max(...ring.map((q) => q[1])) - Math.min(...ring.map((q) => q[1]))),
  };
}

/** Floor inside an outline, m². */
export function outlineArea(ring: Point[]): number {
  return Math.abs(signedArea(ring));
}

/**
 * Corners typed as text: "x, y" pairs separated by new lines or semicolons, e.g.
 * "0,0; 40,0; 40,30; 0,30". Null when a pair cannot be read.
 */
export function parseCorners(text: string): Point[] | null {
  const pairs = text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const points: Point[] = [];
  for (const pair of pairs) {
    const m = /^\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(pair);
    if (!m) return null;
    points.push([Number(m[1]), Number(m[2])]);
  }
  return points;
}

export function cornersText(points: Point[]): string {
  return points.map(([x, y]) => `${x}, ${y}`).join('\n');
}

function box(w: number, d: number): Point[] {
  return [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
}

function ellipse(w: number, d: number, steps: number): Point[] {
  return Array.from({ length: steps }, (_, i): Point => {
    const a = (2 * Math.PI * i) / steps;
    return [(w / 2) * (1 + Math.cos(a)), (d / 2) * (1 + Math.sin(a))];
  });
}

function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function crossesItself(ring: Point[]): boolean {
  const n = ring.length;
  const cross = (a: Point, b: Point, c: Point) =>
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

const cm = (n: number) => Math.round(n * 100) / 100 + 0;
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const bad = (error: string): Outline => ({ ring: null, error });
