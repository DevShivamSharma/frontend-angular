import { BlockedArea, Hall, HallShape, HallSize } from '../models/hall.model';
import { GateSide, Stall, StallInput, StallStatus } from '../models/stall.model';

/**
 * Pure geometry/normalization helpers ported 1:1 from `frontend/src/App.js:10-114`.
 *
 * These are deliberately plain functions with no Angular dependencies so the
 * migration can unit-test them against the React behaviour (decision FD-006).
 */


/** Snap a number to a grid step. `App.js:16`. */
export function snapValue(v: number, step = 1): number {
  return Math.round(v / step) * step;
}

/** Normalize a hall shape, defaulting to SQUARE. `App.js:18-22`. */
export function shapeOf(v: unknown): HallShape {
  return String(v ?? 'SQUARE').trim().toUpperCase() === 'CIRCLE' ? 'CIRCLE' : 'SQUARE';
}

/** Convert a value to a finite number or return the fallback. `App.js:23-26`. */
export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize a gate side, defaulting invalid values to FRONT. `App.js:28-33`. */
export function validGate(v: unknown): GateSide {
  const upper = String(v ?? '').toUpperCase();
  return upper === 'FRONT' || upper === 'BACK' || upper === 'LEFT' || upper === 'RIGHT'
    ? upper
    : 'FRONT';
}

/**
 * Normalize an open-sides list (array or single value) into a deduped,
 * validated `GateSide[]`. Invalid entries are dropped; when nothing valid
 * remains the single fallback side is used, so the result is never empty.
 */
export function normalizeOpenSides(value: unknown, fallback: unknown): GateSide[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const sides: GateSide[] = [];

  for (const entry of raw) {
    const upper = String(entry ?? '').toUpperCase();
    if (
      (upper === 'FRONT' || upper === 'BACK' || upper === 'LEFT' || upper === 'RIGHT') &&
      !sides.includes(upper)
    ) {
      sides.push(upper);
    }
  }

  return sides.length ? sides : [validGate(fallback)];
}

/** Renderable width/length for a hall of either shape. `App.js:35-47`. */
export function hallSize(hall: Hall | null | undefined): HallSize {
  return hall?.shape === 'CIRCLE'
    ? { width: num(hall.radius, 20) * 2, length: num(hall.radius, 20) * 2 }
    : { width: num(hall?.width, 40), length: num(hall?.length, 40) };
}

/**
 * Check whether the complete stall rectangle is inside the selected hall.
 * `App.js:52-84`.
 *
 * The circular case uses the stall's half-diagonal so that no corner can
 * cross the circle. The `1e-8` epsilons let a stall sit exactly on the edge.
 */
export function withinHall(
  hall: Hall | null | undefined,
  stall: Pick<Stall, 'width' | 'length' | 'posX' | 'posZ'> | null | undefined,
  x: unknown = stall?.posX,
  z: unknown = stall?.posZ
): boolean {
  if (!hall || !stall) return false;

  const stallWidth = num(stall.width, 0);
  const stallLength = num(stall.length, 0);
  const px = num(x, 0);
  const pz = num(z, 0);

  if (stallWidth <= 0 || stallLength <= 0) return false;

  if (shapeOf(hall.shape) === 'CIRCLE') {
    const radius = num(hall.radius, 20);
    const distanceFromCenter = Math.sqrt(px * px + pz * pz);

    const halfDiagonal = Math.sqrt(
      (stallWidth / 2) * (stallWidth / 2) + (stallLength / 2) * (stallLength / 2)
    );

    return distanceFromCenter + halfDiagonal <= radius + 1e-8;
  }

  const hallWidth = num(hall.width, 40);
  const hallLength = num(hall.length, 40);

  return (
    Math.abs(px) + stallWidth / 2 <= hallWidth / 2 + 1e-8 &&
    Math.abs(pz) + stallLength / 2 <= hallLength / 2 + 1e-8
  );
}

/**
 * Axis-aligned overlap test against the other stalls. `App.js:86-99`.
 * Edge-touching stalls do not count as overlapping.
 */
export function overlaps(
  candidate: Pick<Stall, 'width' | 'length' | 'posX' | 'posZ'>,
  others: ReadonlyArray<Stall>,
  ignoreId: string | number | null = null
): boolean {
  return others.some(o => {
    if (ignoreId != null && String(o.id) === String(ignoreId)) {
      return false;
    }

    return (
      Math.abs(candidate.posX - o.posX) < (candidate.width + o.width) / 2 - 1e-8 &&
      Math.abs(candidate.posZ - o.posZ) < (candidate.length + o.length) / 2 - 1e-8
    );
  });
}

/**
 * Check whether a candidate stall rectangle overlaps any blocked area that
 * prohibits placement (`kind === 'outside'` or `kind === 'wall'`).
 *
 * Uses the same axis-aligned overlap math and `1e-8` epsilon as `overlaps()`
 * so edge-touching is allowed. `'zone'` areas (pillars and other coloured
 * rectangles) never block: real pavilions are built around pillars. The
 * restrictions that do block — compulsory passages, no-construction areas,
 * fire curtains, hidden or not — are `hall.zones`, checked by `blockedInPlan()`.
 *
 * Returns `false` (no block) when the areas array is null, undefined or empty,
 * so a hall without blockedAreas behaves exactly as today.
 */
export function overlapsBlockedArea(
  candidate: Pick<Stall, 'width' | 'length' | 'posX' | 'posZ'>,
  areas: BlockedArea[] | null | undefined
): boolean {
  if (!areas || areas.length === 0) return false;

  return areas.some(area => {
    if (area.kind === 'zone') return false;

    return (
      Math.abs(candidate.posX - area.posX) < (candidate.width + area.width) / 2 - 1e-8 &&
      Math.abs(candidate.posZ - area.posZ) < (candidate.length + area.length) / 2 - 1e-8
    );
  });
}

/** Normalize a backend/Excel stall into UI state. `App.js:101-114`. */
export function normalizeStall(
  s: StallInput,
  hallId: string | number,
  fallbackName = 'Shop'
): Stall {
  const openSides = normalizeOpenSides(s.openSides, s.gateSide);

  return {
    id: (s.id as string | number | undefined) ?? `stall-${Date.now()}-${Math.random()}`,
    hallId,
    name: String(s.name ?? s.stallName ?? fallbackName).trim() || fallbackName,
    width: num(s.width, 5),
    length: num(s.length, 5),
    height: num(s.height, 4),
    posX: num(s.posX, 0),
    posZ: num(s.posZ, 0),
    color: (s.color as string) || '#3498db',
    gateSide: openSides[0],
    openSides,
    stallNumber: typeof s.stallNumber === 'string' && s.stallNumber.trim() ? s.stallNumber.trim() : null,
    status: validStatus(s.status),
    stallTypeId: typeof s.stallTypeId === 'string' && s.stallTypeId ? s.stallTypeId : null,
    rotation: num(s.rotation, 0),
    isSplitParent: s.isSplitParent === true,
    ...(typeof s.parentStallNumber === 'string' ? { parentStallNumber: s.parentStallNumber } : {})
  };
}

/** Normalize a stall status, defaulting anything unknown to AVAILABLE. */
export function validStatus(v: unknown): StallStatus {
  const upper = String(v ?? '').trim().toUpperCase();
  return upper === 'BOOKED' || upper === 'CANCELLED' ? upper : 'AVAILABLE';
}
