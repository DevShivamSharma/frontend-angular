import type { FloorGeometry } from './floor-plan.models';

/** What a rectangle of a hall's floor is. Mirrors the backend's `FloorAreaKind`. */
export type FloorAreaKind =
  | 'outside'
  | 'wall'
  | 'column'
  | 'passage'
  | 'fire_curtain'
  | 'no_build'
  | 'utility'
  | 'entry'
  | 'unavailable'
  | 'void'
  | 'facility'
  | 'marking';

export interface FloorArea {
  kind: FloorAreaKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  hidden?: boolean;
}

/**
 * A hall's empty floor: metres, top-left origin, y down. Geometry may reach past
 * `width` x `depth`; labels and icons often sit outside the hall.
 */
export interface HallFloor {
  geometry?: FloorGeometry;
  schema: 'floor/1';
  width: number;
  depth: number;
  areas: FloorArea[];
  labels: { text: string; x: number; y: number; width?: number; height?: number }[];
  iconGroups: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    icons: { kind: string; label: string }[];
  }[];
  north: { x: number; y: number; size: number; rotation: number; label: string } | null;
  legend: {
    label: string;
    color?: string;
    kind?: FloorAreaKind;
    code?: string;
    showInView: boolean;
  }[];
}
