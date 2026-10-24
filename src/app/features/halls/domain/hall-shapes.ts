import { Corner, HallShapeDefinition, Outline } from './hall-shape.model';
import { finishOutline } from './outline-geometry';
import { L_SHAPE, RECTANGLE, T_SHAPE, U_SHAPE, WEDGE } from './shapes/basic-shapes';
import { CUSTOM } from './shapes/custom-shape';
import { FAN, OVAL, POLYGON, ROUND, STADIUM } from './shapes/curved-shapes';

/** The kinds of hall the portal can draw, in the order they are offered. */
export const HALL_SHAPES: readonly HallShapeDefinition[] = [
  RECTANGLE,
  L_SHAPE,
  U_SHAPE,
  T_SHAPE,
  WEDGE,
  FAN,
  ROUND,
  OVAL,
  STADIUM,
  POLYGON,
  CUSTOM,
];

export function shapeById(id: string): HallShapeDefinition {
  return HALL_SHAPES.find((shape) => shape.id === id) ?? RECTANGLE;
}

/** The measurements a shape starts with. */
export function defaultParams(id: string): Record<string, number> {
  return Object.fromEntries(shapeById(id).params.map((param) => [param.key, param.value]));
}

/** The outline a shape makes with these measurements (`points` is for the custom shape). */
export function outlineOf(
  id: string,
  params: Record<string, number>,
  points: readonly Corner[] = [],
): Outline {
  const shape = shapeById(id);
  for (const param of shape.params) {
    const value = params[param.key];
    if (!(
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= param.min &&
      value <= param.max
    )) {
      const unit = param.unit ? ` ${param.unit}` : '';
      return { ring: null, error: `${param.label}: ${param.min} to ${param.max}${unit}.` };
    }
  }

  const raw = shape.build(params, points);
  return typeof raw === 'string' ? { ring: null, error: raw } : finishOutline(raw);
}
