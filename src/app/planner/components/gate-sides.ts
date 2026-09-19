import { GateSide } from '../models/stall.model';
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
