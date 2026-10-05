import type { Point } from '../geometry/placement-rules';

/**
 * What POST /api/layout/pdf-import returns (backend-nest src/pdf-import/stall-extraction.ts):
 * the stalls found in a CAD hall plan, with calibration, conflicts and uncertain items. A
 * proposal for review; nothing has been saved.
 */
export type PdfIssueSeverity = 'error' | 'warning' | 'info';

export interface PdfIssue {
  code: string;
  severity: PdfIssueSeverity;
  message: string;
}

export interface PdfStall {
  key: string;
  /** Hall of the drawing ("11", "10", ...), "?" when unknown. */
  group: string;
  blockId: string | null;
  letter: string | null;
  name: string;
  /** Outline in the group's metres (x right, z down), clockwise. */
  outline: Point[];
  /** Edges (outline[i] -> outline[i + 1]) drawn as fascia: the open sides. */
  openEdges: number[];
  area: number;
  shape: 'rectangle' | 'L-shape' | 'polygon';
  category: 'standard' | 'premium' | 'marquee' | 'start-up';
  labels: { area: number | null; dims: { a: number; b: number } | null; texts: string[] };
  confidence: 'high' | 'medium' | 'low';
  issues: PdfIssue[];
  include: boolean;
  /** The same outline in page points (z = page y, down), for drawing it over the PDF. */
  outlinePt: Point[];
}

export interface PdfGroup {
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

export interface PdfExcluded {
  reason: string;
  outlinePt: Point[];
  texts: string[];
}

export interface PdfUnresolved {
  texts: string[];
  /** Page point. */
  x: number;
  y: number;
  reason: string;
}

/** An area the drawing's stall grid covers (hall floor, foyer): a rectangle in its group's metres. */
export interface PdfGridArea {
  group: string;
  outline: Point[];
  area: number;
}

export interface PdfImportResult {
  page: { width: number; height: number; rotation: number };
  layers: Array<{ name: string; role: string; paths: number }>;
  usedLayers: boolean;
  groups: PdfGroup[];
  stalls: PdfStall[];
  excluded: PdfExcluded[];
  unresolved: PdfUnresolved[];
  /** Missing from older backends: then the import falls back to auto-fit. */
  gridAreas?: PdfGridArea[];
  issues: string[];
}
