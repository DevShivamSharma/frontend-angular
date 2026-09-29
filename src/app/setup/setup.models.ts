import type {
  BlockedArea,
  HallAmenity,
  HallCompass,
  HallLegend,
  HallMarker
} from '../planner/models/hall.model';
import type { HallOpening, HallZone, Point } from '../planner/geometry/placement-rules';

/**
 * Types of the hall-setup API (backend-nest `src/hall-import`, `src/planner-rules`).
 * Coordinates are the planner's: metres, centre-origin, X right, Z down the plan.
 */

/** An amenity found on an uploaded plan, and how it was found. */
export interface ImportedAmenity extends HallAmenity {
  id: string;
  source: 'label' | 'symbol' | 'layer' | 'manual';
}

/** One possible reading of the plan: an outline and everything found in and around it. */
export interface HallDraft {
  id: string;
  outlineLabel: string;
  name: string;
  width: number;
  length: number;
  areaM2: number;
  boundary: Point[];
  amenities: ImportedAmenity[];
  markers: HallMarker[];
  openings: HallOpening[];
  zones: HallZone[];
  blockedAreas: BlockedArea[];
  legends: HallLegend[];
  compass: HallCompass | null;
  /** Plan linework for the underlay: flat [x1, z1, x2, z2, ...] metres. */
  linework: number[];
  /** This draft's frame centre in the overview's frame: overview point = draft point + origin. */
  origin: Point;
}

/** A closed area of the plan that can become a hall (overview frame, metres). */
export interface RoomOutline {
  id: string;
  label: string;
  areaM2: number;
  polygon: Point[];
}

/** Response of `POST /api/halls/import`. Nothing is saved until the reviewed hall is posted. */
export interface HallImportResult {
  fileName: string;
  /** 'image': a picture of a plan, read in the browser; the user traces it. */
  format: 'dxf' | 'pdf' | 'image';
  scale: { metresPerUnit: number; known: boolean; source: string };
  /**
   * false: `candidates` are alternative readings of ONE hall (pick one).
   * true: the plan holds several halls and `candidates` are those halls (save each).
   */
  multiHall: boolean;
  candidates: HallDraft[];
  /** The whole plan in one frame, for halls made from an area the user picks or draws. */
  overview: HallDraft;
  /** Closed areas of the plan, largest first. */
  rooms: RoomOutline[];
  warnings: string[];
  stats: { layers: number; shapes: number; texts: number; symbols: number };
}

export type { PlannerRule, PlannerRuleInput } from '../planner/models/rule.model';
