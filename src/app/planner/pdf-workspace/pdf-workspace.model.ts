/** Coordinates are the PDF.js scale-1 viewport, never assumed to be CAD metres. */
export interface PdfPoint {
  x: number;
  y: number;
}
export type ObjectKind = 'unknown' | 'hall' | 'foyer' | 'stall' | 'wall' | 'symbol' | 'legend';
export interface Calibration {
  a: PdfPoint;
  b: PdfPoint;
  metres: number;
  metresPerUnit: number;
}
export interface PdfObject {
  id: string;
  page: number;
  name: string;
  kind: ObjectKind;
  /** Immutable traced/extracted outline; edits affect points only. */
  sourcePoints: PdfPoint[];
  points: PdfPoint[];
  sourcePathId?: string;
  regionId?: string;
  /** Explicitly reviewed connections; a shared foyer is not a stall-placement hall. */
  adjacentHallIds?: string[];
  calibration?: Calibration;
  reviewed: boolean;
  heightMetres: number | null;
  legendId?: string;
}
export interface PdfWorkspace {
  version: 1;
  id: string;
  name: string;
  pdf: ArrayBuffer;
  sha256: string;
  page: number;
  objects: PdfObject[];
  pageCalibrations: Record<number, Calibration>;
  updatedAt: number;
}
export interface SourcePath {
  id: string;
  layer: string;
  d: string;
  points: PdfPoint[];
  closed: boolean;
  curved: boolean;
  clipped: boolean;
  compound: boolean;
  hidden: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface PageInspection {
  page: number;
  width: number;
  height: number;
  rotation: number;
  userUnit: number;
  transform: number[];
  paths: SourcePath[];
  texts: Array<{ text: string; position: PdfPoint }>;
  layers: string[];
  images: number;
  curvedPaths: number;
  clippedPaths: number;
  issues: string[];
}

export function distance(a: PdfPoint, b: PdfPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
export function calibrate(a: PdfPoint, b: PdfPoint, metres: number): Calibration {
  const units = distance(a, b);
  if (!Number.isFinite(metres) || metres <= 0 || !Number.isFinite(units) || units < 0.01) {
    throw new Error('Choose two different points and enter a positive distance in metres.');
  }
  return { a: { ...a }, b: { ...b }, metres, metresPerUnit: metres / units };
}
export function area(points: PdfPoint[]): number {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}
export function polygonError(points: PdfPoint[]): string | null {
  if (points.length < 3 || points.length > 500) return 'An outline needs 3–500 vertices.';
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return 'Coordinates must be finite numbers.';
  if (!Number.isFinite(area(points)) || area(points) < 0.000001)
    return 'The outline must enclose a finite area.';
  const cross = (a: PdfPoint, b: PdfPoint, c: PdfPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: PdfPoint, b: PdfPoint, c: PdfPoint) =>
    Math.abs(cross(a, b, c)) < 1e-8 &&
    c.x >= Math.min(a.x, b.x) - 1e-8 &&
    c.x <= Math.max(a.x, b.x) + 1e-8 &&
    c.y >= Math.min(a.y, b.y) - 1e-8 &&
    c.y <= Math.max(a.y, b.y) + 1e-8;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (distance(a, b) < 1e-8) return 'Remove duplicate consecutive vertices.';
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return 'Outline edges must not cross or touch themselves.';
    }
  }
  return null;
}
export function contains(points: PdfPoint[], p: PdfPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function calibrationFor(doc: PdfWorkspace, object: PdfObject): Calibration | undefined {
  const region = doc.objects.find(
    (o) => o.id === object.regionId && o.page === object.page && o.kind === 'hall',
  );
  return object.calibration ?? region?.calibration ?? doc.pageCalibrations[object.page];
}
export function sourceToMetres(points: PdfPoint[], calibration: Calibration): PdfPoint[] {
  return points.map((p) => ({
    x: (p.x - calibration.a.x) * calibration.metresPerUnit,
    y: (p.y - calibration.a.y) * calibration.metresPerUnit,
  }));
}
