import { Corner, HallShapeDefinition } from '../hall-shape.model';
import { box } from '../outline-geometry';
import { side } from './param';

export const RECTANGLE: HallShapeDefinition = {
  id: 'rectangle',
  label: 'Rectangle',
  example: 'Most exhibition halls',
  params: [side('width', 'Width', 60), side('depth', 'Depth', 40)],
  build: (p) => box(p['width'], p['depth']),
};

export const L_SHAPE: HallShapeDefinition = {
  id: 'l',
  label: 'L-shape',
  example: 'A hall with an annex, or one built round a corner block',
  params: [
    side('width', 'Width', 60),
    side('depth', 'Depth', 40),
    side('cutWidth', 'Corner cut-out width', 20),
    side('cutDepth', 'Corner cut-out depth', 15),
  ],
  build: ({ width: w, depth: d, cutWidth: cw, cutDepth: cd }): Corner[] | string => {
    if (cw >= w || cd >= d) return 'The cut-out must be smaller than the hall.';
    return [
      [0, 0],
      [w - cw, 0],
      [w - cw, cd],
      [w, cd],
      [w, d],
      [0, d],
    ];
  },
};

export const U_SHAPE: HallShapeDefinition = {
  id: 'u',
  label: 'U-shape',
  example: 'Wings round a courtyard or a forecourt',
  params: [
    side('width', 'Width', 80),
    side('depth', 'Depth', 50),
    side('gapWidth', 'Courtyard width', 30),
    side('gapDepth', 'Courtyard depth', 20),
  ],
  build: ({ width: w, depth: d, gapWidth: gw, gapDepth: gd }): Corner[] | string => {
    if (gw >= w - 2 || gd >= d - 1) return 'The courtyard must leave wings and a back to the hall.';
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
  },
};

export const T_SHAPE: HallShapeDefinition = {
  id: 't',
  label: 'T-shape',
  example: 'A wide front hall with a wing behind it',
  params: [
    side('width', 'Front width', 80),
    side('barDepth', 'Front depth', 20),
    side('stemWidth', 'Wing width', 30),
    side('depth', 'Total depth', 60),
  ],
  build: ({ width: w, barDepth: bd, stemWidth: sw, depth: d }): Corner[] | string => {
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
  },
};

export const WEDGE: HallShapeDefinition = {
  id: 'wedge',
  label: 'Wedge',
  example: 'A hall that widens from its entrance',
  params: [
    side('front', 'Front (top) width', 40),
    side('back', 'Back (bottom) width', 70),
    side('depth', 'Depth', 50),
  ],
  build: ({ front: f, back: b, depth: d }): Corner[] => {
    const w = Math.max(f, b);
    return [
      [(w - f) / 2, 0],
      [(w + f) / 2, 0],
      [(w + b) / 2, d],
      [(w - b) / 2, d],
    ];
  },
};
