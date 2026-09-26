import { GateSide, Stall } from '../models/stall.model';
import { IconName } from './icon.component';

/**
 * The four gate-side toggle buttons (`App.js:9-14`).
 *
 * This lives in the UI layer rather than in `geometry/` because it is purely
 * presentational - a label and an icon per side. `geometry/` stays free of any
 * Angular or UI imports, which is the layering rule in `01-architecture.md`.
 *
 * The icon name replaces the emoji arrow the React build used, so the arrow
 * inherits the button's text colour instead of rendering as a colour bitmap.
 */
export const GATE_SIDES: ReadonlyArray<readonly [GateSide, string, IconName]> = [
  ['FRONT', 'Front (+Z)', 'arrow-up'],
  ['BACK', 'Back (-Z)', 'arrow-down'],
  ['LEFT', 'Left (-X)', 'arrow-left'],
  ['RIGHT', 'Right (+X)', 'arrow-right']
];

/** One cell of the 3x3 compass. `side` null is an empty corner or the stall in the middle. */
export interface GateCompassCell {
  side: GateSide | null;
  /** Short label for the button; the axis stays in `title`. */
  short: string;
  /** Full label, e.g. "Front (+Z)". */
  label: string;
  icon: IconName | null;
  centre: boolean;
}

const EMPTY: GateCompassCell = { side: null, short: '', label: '', icon: null, centre: false };

function cell(side: GateSide): GateCompassCell {
  const [, label, icon] = GATE_SIDES.find(entry => entry[0] === side)!;
  return { side, short: label.replace(/\s*\(.*\)$/, ''), label, icon, centre: false };
}

/**
 * The same four sides, laid out where they actually are (row-major).
 *
 * As a 2x2 grid the buttons were in no particular place, so picking "the left side" meant
 * reading all four labels. On a compass it is a pointing task instead of a reading one.
 */
export const GATE_COMPASS: ReadonlyArray<GateCompassCell> = [
  EMPTY,
  cell('FRONT'),
  EMPTY,
  cell('LEFT'),
  { ...EMPTY, centre: true },
  cell('RIGHT'),
  EMPTY,
  cell('BACK'),
  EMPTY
];

/** A stall's open sides for display, e.g. "Front, Left". Falls back to the gate side. */
export function openSidesLabel(stall: Pick<Stall, 'openSides' | 'gateSide'>): string {
  const sides = stall.openSides?.length ? stall.openSides : [stall.gateSide];
  return sides.map(side => side.charAt(0) + side.slice(1).toLowerCase()).join(', ');
}
