import type { FloorAreaKind } from './floor.models';

/** What each kind of area on a hall's floor is called. */
export const AREA_LABELS: Record<FloorAreaKind, string> = {
  outside: 'Outside the hall',
  wall: 'Wall',
  column: 'Column',
  passage: 'Passage',
  fire_curtain: 'Fire curtain',
  no_build: 'No construction',
  utility: 'Utility',
  entry: 'Entry / exit',
  unavailable: 'Not available',
  marking: 'Marking',
  void: 'Void / opening',
  facility: 'Facility',
};
