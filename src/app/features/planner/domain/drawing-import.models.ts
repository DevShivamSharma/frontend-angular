/** A point of the drawing: metres, x right and z down. */
export interface DrawingPoint {
  x: number;
  z: number;
}

/**
 * What POST .../plan/drawing returns (backend-nest src/stall-plans/drawing-import/stall-extraction.ts):
 * the stalls found in a CAD hall plan, with calibration, conflicts and uncertain items. A
 * proposal for review; nothing has been saved.
 */
export type DrawingIssueSeverity = 'error' | 'warning' | 'info';

export interface DrawingIssue {
  code: string;
  severity: DrawingIssueSeverity;
  message: string;
}

export interface DrawingStall {
  key: string;
  /** Hall of the drawing ("11", "10", ...), "?" when unknown. */
  group: string;
  blockId: string | null;
  letter: string | null;
  name: string;
  /** Outline in the group's metres (x right, z down), clockwise. */
  outline: DrawingPoint[];
  /** Edges (outline[i] -> outline[i + 1]) drawn as fascia: the open sides. */
  openEdges: number[];
  area: number;
  shape: 'rectangle' | 'L-shape' | 'polygon';
  category: 'standard' | 'premium' | 'marquee' | 'start-up';
  labels: { area: number | null; dims: { a: number; b: number } | null; texts: string[] };
  confidence: 'high' | 'medium' | 'low';
  issues: DrawingIssue[];
  include: boolean;
  /** The same outline in page points (z = page y, down), for drawing it over the PDF. */
  outlinePt: DrawingPoint[];
}

export interface DrawingGroup {
  group: string;
  /** Page points per metre. */
  pitchX: number;
  pitchY: number;
  /** Page point of the group's grid origin. */
  originX: number;
  originY: number;
  /** Grid fit residual, metres. */
  rms: number;
  gridLines: number;
  dimensionChecks: number;
  dimensionMaxError: number | null;
  usesHalfMetres: boolean;
}

export interface DrawingExcluded {
  reason: string;
  outlinePt: DrawingPoint[];
  texts: string[];
}

export interface DrawingUnresolved {
  texts: string[];
  /** Page point. */
  x: number;
  y: number;
  reason: string;
}

/** An area the drawing's stall grid covers (hall floor, foyer): a rectangle in its group's metres. */
export interface DrawingGridArea {
  group: string;
  outline: DrawingPoint[];
  area: number;
}

export interface DrawingImportResult {
  page: { width: number; height: number; rotation: number };
  layers: Array<{ name: string; role: string; paths: number }>;
  usedLayers: boolean;
  groups: DrawingGroup[];
  stalls: DrawingStall[];
  excluded: DrawingExcluded[];
  unresolved: DrawingUnresolved[];
  /**
   * Which halls of the drawing are this hall: the server keeps only their stalls, and refuses a
   * plan of other halls (422, "Wrong plan: ...").
   */
  hall: {
    groups: string[];
    /** Every hall the drawing has stalls of. */
    drawingHalls: string[];
    /** False when nothing named a hall number to match by: the planner asks to check. */
    matchedByName: boolean;
  };
  /** Missing from older backends: then the import falls back to auto-fit. */
  gridAreas?: DrawingGridArea[];
  issues: string[];
}
