import type { HallFloor } from '../../../core/api/api.models';
import type { CategoryRef } from '../../../core/categories/categories.models';
import type {
  PlanContent,
  PlannerView,
  PlanSeat,
  PlanStall,
  PlanZone,
  StallSide,
} from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import {
  BoothPlace,
  centre,
  fillRows,
  pointInRing,
  keepClearOf,
  letterIndex,
  letters,
  newId,
  PlannerFloor,
  Rect,
  stallNumbers,
  standArea,
  zoneAt,
} from './planner-geometry';

/**
 * Planning a hall in one go: a short brief (what booths, how numbered, which area) becomes a few
 * complete layouts to choose from, each laid out the way halls are cut and kept to the hall's
 * rules. The planner's "Plan hall" dialog and its AI assistant both start here; the assistant
 * only fills in the brief, the geometry is done here.
 */

/** How new booths are numbered. */
export type Numbering = 'line' | 'island' | 'numbers' | 'letters';

/** What the person wants of the plan. Everything has a sensible default. */
export interface PlanBrief {
  /** Booth size, metres: along its line, and deep. */
  width: number;
  depth: number;
  /** Between islands and the cross-aisles; the hall's passage width by default. */
  aisle: number;
  /** A line of booths along the side walls: yes, no, or try both. */
  wallLines: 'auto' | 'yes' | 'no';
  /** Line ends open on two sides; they get the hall's corner category when it sells one. */
  corners: boolean;
  numbering: Numbering;
  /** Before every number, e.g. "H6-". */
  prefix: string;
  /** Categories every new booth gets. */
  categoryIds: string[];
  /** At most this many booths; null: as many as fit. */
  count: number | null;
}

/** The hall and its rules, as a plan is made for it. */
export interface PlanSetting {
  floor: PlannerFloor;
  hallFloor: HallFloor;
  /** The outline to fill: the hall's, or a zone's. */
  region: Point[];
  /** Booths and seats that stay, and are planned around. */
  stalls: PlanStall[];
  seats: PlanSeat[];
  zones: PlanZone[];
  categories: CategoryRef[];
  rules: {
    on: (rule: string) => boolean;
    passage: number;
    wallClearance: number;
    emergencyExitClearance: number;
    curtainClearance: number;
    facilityClearance: number;
    maxUtilization: number;
  };
}

/** One complete layout to choose. */
export interface PlanOption {
  key: string;
  /** e.g. "Rows across, lines along the side walls". */
  label: string;
  places: BoothPlace[];
  booths: number;
  /** m² to sell. */
  area: number;
  corners: number;
  /** Stall floor covered with these and the booths that stay, 0 to 100. */
  used: number;
  /** Over the rules' limit of floor covered. */
  overLimit: boolean;
}

/** The plan's grid, metres. */
const GRID = 1;
/** A cross-aisle at least this often, metres, and every this many booths at most. */
const CROSS_AISLE_METRES = 30;
const CROSS_AISLE_BOOTHS = 10;
/** Layouts offered. */
const OFFERED = 3;

/**
 * The setting of a plan from the planner's state: the hall, its rules, and what stays. With
 * `afresh`, the booths standing in the region are to be replaced, so they are left out here.
 */
export function planSetting(
  view: PlannerView,
  floor: PlannerFloor,
  plan: PlanContent,
  region: Point[],
  afresh: boolean,
): { setting: PlanSetting; replacing: Set<string> } {
  const replacing = new Set(
    afresh
      ? plan.stalls.filter((s) => pointInRing(centre({ ...s, height: s.depth }), region)).map((s) => s.id)
      : [],
  );
  const { switches, values } = view.hall.rules;
  const on = (rule: string) => (switches as Record<string, boolean>)[rule] !== false;
  return {
    replacing,
    setting: {
      floor,
      hallFloor: view.hall.floor,
      region,
      stalls: plan.stalls.filter((s) => !replacing.has(s.id)),
      seats: plan.seats,
      zones: plan.zones,
      categories: view.hall.categories,
      rules: {
        on,
        passage: values.passageWidth[view.hall.event.audience],
        // The rules' defaults, for a hall whose values leave one out.
        wallClearance: values.peripheralClearance ?? 1,
        emergencyExitClearance: values.emergencyExitClearance ?? 3,
        curtainClearance: values.curtainClearance ?? 1,
        facilityClearance: values.facilityClearance ?? 1,
        maxUtilization: values.maxUtilization ?? 0.7,
      },
    },
  };
}

export function defaultBrief(setting: Pick<PlanSetting, 'rules'>): PlanBrief {
  return {
    width: 3,
    depth: 3,
    aisle: setting.rules.passage,
    wallLines: 'auto',
    corners: true,
    numbering: 'line',
    prefix: '',
    categoryIds: [],
    count: null,
  };
}

/**
 * The best few layouts for a brief: rows across or down the hall, booths either way round, with
 * or without lines along the side walls. Each fills the region as the rules allow; they are
 * ranked by booths, then area to sell, then corner booths, and any that would cover more floor
 * than the rules allow come last.
 */
export function planOptions(brief: PlanBrief, setting: PlanSetting): PlanOption[] {
  const { width, depth } = brief;
  if (!(width > 0 && depth > 0)) return [];
  const sizes: Array<[number, number]> =
    width === depth ? [[width, depth]] : [[width, depth], [depth, width]];
  const walls = brief.wallLines === 'auto' ? [false, true] : [brief.wallLines === 'yes'];
  const rules = setting.rules;
  const margin = Math.max(GRID, rules.on('peripheralClearance') ? rules.wallClearance : 0);
  const keepClear = keepClearOf(
    setting.hallFloor,
    {
      emergencyExitClearance: rules.emergencyExitClearance,
      curtainClearance: rules.curtainClearance,
      facilityClearance: rules.facilityClearance,
    },
    rules.on,
  );
  const floorArea = standArea(setting.floor);
  const stayArea = setting.stalls.reduce((sum, s) => sum + s.width * s.depth, 0);
  const limit = rules.on('maxUtilization') ? rules.maxUtilization * 100 : Infinity;

  const options: PlanOption[] = [];
  for (const across of [true, false]) {
    for (const [w, d] of sizes) {
      for (const wallLines of walls) {
        const flip = across ? (r: Rect) => r : transposeRect;
        const places = fillRows(
          {
            region: across ? setting.region : setting.region.map(([x, y]) => [y, x] as Point),
            width: w,
            depth: d,
            aisle: brief.aisle,
            margin,
            crossEvery: Math.max(1, Math.min(CROSS_AISLE_BOOTHS, Math.floor(CROSS_AISLE_METRES / w))),
            count: brief.count,
            pillarClearance: 0.5,
            shiftForPillars: true,
            sellPillarStands: false,
            corners: brief.corners,
            wallLines,
            keepClear: keepClear.map(flip),
            cornerClear: rules.on('cornerKeepOut') ? rules.passage : 0,
            grid: GRID,
          },
          across ? setting.floor : transposeFloor(setting.floor),
          across ? setting.stalls : setting.stalls.map(transposeStall),
          across ? setting.seats : setting.seats.map(transposeStall),
        ).map((p) => (across ? p : transposePlace(p)));
        if (!places.length) continue;
        const area = places.reduce((sum, p) => sum + p.width * p.height, 0);
        const used = floorArea ? ((stayArea + area) / floorArea) * 100 : 0;
        options.push({
          key: `${across ? 'across' : 'down'}-${w}x${d}-${wallLines ? 'walls' : 'open'}`,
          label:
            `Rows ${across ? 'across' : 'down'} the hall` +
            (w !== width ? `, booths turned (${w} × ${d} m)` : '') +
            (wallLines ? ', lines along the side walls' : ''),
          places,
          booths: places.length,
          area,
          corners: places.filter((p) => p.corner).length,
          used,
          overLimit: used > limit,
        });
      }
    }
  }
  options.sort(
    (a, b) =>
      Number(a.overLimit) - Number(b.overLimit) ||
      b.booths - a.booths ||
      b.area - a.area ||
      b.corners - a.corners,
  );
  // Different layouts only: one of each count and direction.
  const seen = new Set<string>();
  return options
    .filter((o) => {
      const sig = `${o.booths}|${o.key.split('-')[0]}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    })
    .slice(0, OFFERED);
}

/** The booths of a layout, numbered and categorised as the brief says. */
export function boothsOf(option: PlanOption, brief: PlanBrief, setting: PlanSetting): PlanStall[] {
  const numbers = numberPlaces(option.places, setting.stalls, brief.numbering, brief.prefix, '');
  const corner = brief.corners
    ? setting.categories.find((c) => c.status === 'active' && /corner/i.test(c.name))?.id
    : undefined;
  return option.places.map((p, i) => {
    const categoryIds = [...brief.categoryIds];
    if (corner && p.corner && !categoryIds.includes(corner)) categoryIds.push(corner);
    return {
      id: newId(),
      zoneId: zoneAt(centre(p), setting.zones)?.id ?? null,
      islandNumber: numbers[i].island,
      stallNumber: numbers[i].stall,
      x: p.x,
      y: p.y,
      width: p.width,
      depth: p.height,
      openSides: [...p.openSides],
      scheme: 'shell',
      categoryIds,
      isPremium: false,
      isBlocked: false,
      isFnb: false,
      isBranding: false,
      isHorseshoe: false,
      isMarqueeAvailable: false,
      isRestrictedForOverseas: false,
      isActive: true,
      location: null,
      description: null,
    };
  });
}

/** A place in order of numbering: its line and island, when it has them. */
export interface Numbered extends Rect {
  line?: number;
  island?: number;
}

/**
 * Island and stall number of each place. By line: the line's letter after the prefix (A, B…,
 * after the letters already used) and 1, 2, 3 along it. By island: the island's number and A, B,
 * C through both its lines. In order: the prefix and one count through all of them.
 */
export function numberPlaces(
  places: Numbered[],
  stalls: PlanStall[],
  numbering: Numbering,
  prefixText: string,
  startAt: string,
): Array<{ island: string | null; stall: string }> {
  const prefix = prefixText.trim();
  if (numbering === 'numbers' || numbering === 'letters') {
    const island = prefix || null;
    const list = stallNumbers(stalls, island, numbering, places.length, startAt);
    return list.map((stall) => ({ island, stall }));
  }
  // Places with no lines of their own count each row as one.
  const rows = [...new Set(places.map((p) => p.y))].sort((a, b) => a - b);
  const lineOf = (p: Numbered) => p.line ?? rows.indexOf(p.y);
  const islandOf = (p: Numbered) => p.island ?? rows.indexOf(p.y);
  const used = stalls
    .map((s) => s.islandNumber ?? '')
    .filter((i) => i.startsWith(prefix))
    .map((i) => i.slice(prefix.length));
  if (numbering === 'line') {
    const first =
      Math.max(-1, ...used.filter((u) => /^[A-Z]+$/.test(u)).map((u) => letterIndex(u))) + 1;
    const seen = new Map<number, number>();
    return places.map((p) => {
      const n = (seen.get(lineOf(p)) ?? 0) + 1;
      seen.set(lineOf(p), n);
      return { island: `${prefix}${letters(first + lineOf(p))}`, stall: String(n) };
    });
  }
  const first =
    Math.max(
      0,
      ...used
        .map((u) => /^(\d+)-$/.exec(u))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => Number(m[1])),
    ) + 1;
  // Through an island: its top line left to right, then the line below it.
  const order = places
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        islandOf(a.p) - islandOf(b.p) || lineOf(a.p) - lineOf(b.p) || a.p.x - b.p.x || a.p.y - b.p.y,
    );
  const seen = new Map<number, number>();
  const out: Array<{ island: string | null; stall: string }> = new Array(places.length);
  for (const { p, i } of order) {
    const n = seen.get(islandOf(p)) ?? 0;
    seen.set(islandOf(p), n + 1);
    out[i] = { island: `${prefix}${first + islandOf(p)}-`, stall: letters(n) };
  }
  return out;
}

// ---- rows down the hall: the same layout, laid out on the hall turned over its diagonal -------

/** Each side seen across the diagonal: top is left, bottom is right. */
const ACROSS_DIAGONAL: Record<StallSide, StallSide> = {
  top: 'left',
  left: 'top',
  bottom: 'right',
  right: 'bottom',
};

function transposeRect(r: Rect): Rect {
  return { x: r.y, y: r.x, width: r.height, height: r.width };
}

function transposeFloor(f: PlannerFloor): PlannerFloor {
  return {
    width: f.depth,
    depth: f.width,
    floor: f.floor.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as Point))),
    blocked: f.blocked.map(transposeRect),
    pillars: f.pillars.map(transposeRect),
  };
}

function transposeStall<T extends { x: number; y: number; width: number; depth: number }>(s: T): T {
  return { ...s, x: s.y, y: s.x, width: s.depth, depth: s.width };
}

function transposePlace(p: BoothPlace): BoothPlace {
  return {
    ...p,
    ...transposeRect(p),
    openSides: p.openSides.map((side) => ACROSS_DIAGONAL[side]),
  };
}
