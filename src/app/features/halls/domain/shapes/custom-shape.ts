import { Corner, HallShapeDefinition } from '../hall-shape.model';
import { MAX_CORNERS } from '../outline-geometry';

/** Any other outline: the user gives the corners. */
export const CUSTOM: HallShapeDefinition = {
  id: 'custom',
  label: 'Custom',
  example: 'Any other outline: click its corners on the grid, or type them',
  params: [],
  build: (_params, points): Corner[] | string => {
    if (points.length < 3) return 'Give at least three corners.';
    if (points.length > MAX_CORNERS) return `At most ${MAX_CORNERS} corners.`;
    return [...points];
  },
};
