import { Stall } from '../models/stall.model';
import { PlacementContext, validatePlacement, Violation } from './placement-rules';
import { rotate } from './polygon-geometry';

export interface SplitOptions {
  count: number;
  axis: 'X' | 'Z';
  arrangement: 'PASSAGE' | 'BACK_TO_BACK';
}

export interface SplitPreview {
  parentId: string | number;
  options: SplitOptions;
  children: Stall[];
  violations: Violation[];
  error: string | null;
}

/** Zero-based spreadsheet suffix: 0=A, 25=Z, 26=AA. */
export function splitSuffix(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid split index.');
  let suffix = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    suffix = String.fromCharCode(65 + (n - 1) % 26) + suffix;
  }
  return suffix;
}

/** Preview only. No child is inserted into the layout until the server returns the split. */
export function previewSplit(parent: Stall, options: SplitOptions, ctx: PlacementContext): SplitPreview {
  const result: SplitPreview = { parentId: parent.id, options, children: [], violations: [], error: null };
  const { count, axis, arrangement } = options;
  if (!Number.isInteger(count) || count < 2 || count > 100 ||
      !['X', 'Z'].includes(axis) || !['PASSAGE', 'BACK_TO_BACK'].includes(arrangement)) {
    return { ...result, error: 'Choose 2–100 children and a split direction.' };
  }
  if (parent.status !== 'AVAILABLE') return { ...result, error: 'Only available stalls can be split.' };
  if (arrangement === 'BACK_TO_BACK' && count !== 2) {
    return { ...result, error: 'A back-to-back split creates exactly two stalls.' };
  }
  const identifier = parent.stallNumber || parent.name.trim();
  if (!identifier) return { ...result, error: 'Give the parent a stall identifier before splitting.' };
  const gap = arrangement === 'PASSAGE' ? ctx.rules.minPassageWidth[ctx.eventType] : 0;
  const span = axis === 'X' ? parent.width : parent.length;
  const size = (span - gap * (count - 1)) / count;
  const step = ctx.rules.snapStep;
  if (size <= 0 || (step > 0 && Math.abs(size / step - Math.round(size / step)) > 1e-6)) {
    return { ...result, error: `The parent must fit ${count} equal children plus ${gap} m gaps on the ${step} m grid. Change its size or the split options.` };
  }
  result.children = Array.from({ length: count }, (_, i) => {
    const number = `${identifier}-${splitSuffix(i)}`;
    const offset = -span / 2 + size / 2 + i * (size + gap);
    const centre = rotate({ x: axis === 'X' ? offset : 0, z: axis === 'Z' ? offset : 0 }, parent.rotation ?? 0);
    const sides = arrangement === 'PASSAGE' ? [...parent.openSides] :
      axis === 'X' ? [i === 0 ? 'LEFT' as const : 'RIGHT' as const] :
        [i === 0 ? 'BACK' as const : 'FRONT' as const];
    return { ...parent, id: `split-preview-${i}`, name: number, stallNumber: number,
      parentStallNumber: identifier, isSplitParent: false,
      width: axis === 'X' ? size : parent.width, length: axis === 'Z' ? size : parent.length,
      posX: parent.posX + centre.x, posZ: parent.posZ + centre.z,
      openSides: sides, gateSide: sides[0], stallTypeId: null };
  });
  const splitContext = { ...ctx, stalls: [
    ...ctx.stalls.filter(s => String(s.id) !== String(parent.id)),
    ...result.children.map(s => ({ ...s, id: String(s.id) }))
  ] };
  result.violations = result.children.flatMap(s => validatePlacement(s, splitContext, String(s.id)).violations);
  return result;
}
