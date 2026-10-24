/** A corner of an outline: [x, y] in metres, origin top-left, y down. */
export type Corner = [number, number];

export type ParamUnit = 'm' | '°' | '';

/** One measurement of a shape, with the range it may take. */
export interface ShapeParam {
  key: string;
  label: string;
  unit: ParamUnit;
  min: number;
  max: number;
  step: number;
  value: number;
}

/**
 * A kind of hall outline. Each shape makes its outline from a few measurements; adding a shape
 * means adding one of these to the registry, and nothing else changes.
 */
export interface HallShapeDefinition {
  id: string;
  label: string;
  /** Where such halls are found. */
  example: string;
  params: readonly ShapeParam[];
  /** The corners for these measurements, or why they make no hall. `points` is for a custom outline. */
  build(params: Record<string, number>, points: readonly Corner[]): Corner[] | string;
}

/** An outline, or why the measurements make none. */
export type Outline = { ring: Corner[]; error: null } | { ring: null; error: string };
