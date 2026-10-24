import { ShapeParam } from '../hall-shape.model';
import { MAX_SIDE } from '../outline-geometry';

/** A length in metres, as most shape measurements are. */
export const side = (key: string, label: string, value: number): ShapeParam => ({
  key,
  label,
  unit: 'm',
  min: 1,
  max: MAX_SIDE,
  step: 0.5,
  value,
});
