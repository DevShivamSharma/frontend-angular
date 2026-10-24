import { Corner, HallShapeDefinition } from '../hall-shape.model';
import { ellipse } from '../outline-geometry';
import { side } from './param';

export const FAN: HallShapeDefinition = {
  id: 'fan',
  label: 'Auditorium',
  example: 'A fan widening from the stage, with a curved back wall',
  params: [
    side('stage', 'Stage width', 16),
    side('depth', 'Depth', 30),
    { key: 'angle', label: 'Fan angle', unit: '°', min: 10, max: 150, step: 5, value: 60 },
  ],
  build: ({ stage, depth, angle }): Corner[] => {
    const half = (angle * Math.PI) / 360;
    const r1 = stage / (2 * Math.sin(half));
    const r2 = r1 + depth;
    const steps = Math.max(8, Math.ceil(angle / 3));
    const at = (r: number, a: number): Corner => [r * Math.sin(a), r * Math.cos(a)];
    const back: Corner[] = [];
    for (let i = 0; i <= steps; i++) back.push(at(r2, -half + (2 * half * i) / steps));
    // The stage wall straight along the top, left to right; the back wall right to left.
    return [at(r1, -half), at(r1, half), ...back.reverse()];
  },
};

export const ROUND: HallShapeDefinition = {
  id: 'round',
  label: 'Round',
  example: 'A rotunda or a domed pavilion',
  params: [side('diameter', 'Diameter', 40)],
  build: (p) => ellipse(p['diameter'], p['diameter'], 64),
};

export const OVAL: HallShapeDefinition = {
  id: 'oval',
  label: 'Oval',
  example: 'An oval arena or a garden pavilion',
  params: [side('width', 'Width', 80), side('depth', 'Depth', 50)],
  build: (p) => ellipse(p['width'], p['depth'], 72),
};

export const STADIUM: HallShapeDefinition = {
  id: 'stadium',
  label: 'Arena',
  example: 'Straight sides with round ends',
  params: [side('length', 'Length', 100), side('width', 'Width', 50)],
  build: ({ length: l, width: w }): Corner[] | string => {
    if (l <= w) return 'An arena is longer than it is wide.';
    const r = w / 2;
    const ring: Corner[] = [];
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
  },
};

export const POLYGON: HallShapeDefinition = {
  id: 'polygon',
  label: 'Hexagon / octagon',
  example: 'A many-sided pavilion',
  params: [
    { key: 'sides', label: 'Sides', unit: '', min: 5, max: 12, step: 1, value: 6 },
    side('across', 'Across corners', 40),
  ],
  build: (p): Corner[] => {
    const n = Math.round(p['sides']);
    const r = p['across'] / 2;
    // A flat side along the top, where the entrance usually is.
    const start = -Math.PI / 2 + Math.PI / n;
    return Array.from({ length: n }, (_, i): Corner => {
      const a = start + (2 * Math.PI * i) / n;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
  },
};
