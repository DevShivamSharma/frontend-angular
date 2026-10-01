import type { GateSide, Stall } from '../models/stall.model';
import {
  arrayOffsets, CadFrame, cadAngle, gridSnap, islandFootprints, mergeFootprints, mirrorIn, normaliseRightAngle,
  objectSnap, orthoFrom, polarFrom, rotateAbout, rowFootprints, selectInRect, snapTargets, splitFootprint, turnSides
} from './cad-geometry';
import { formatSize, matchKeyword, parsePointEntry, parseSize, resolvePointEntry } from './cad-input';
import { orderStalls } from './drafting-engine.service';
import { portalExport } from './portal-export';

function stall(p: Partial<Stall> & Pick<Stall, 'posX' | 'posZ' | 'width' | 'length'>): Stall {
  return {
    id: p.id ?? `s-${p.posX}-${p.posZ}`, hallId: 'h', name: p.name ?? 'S', height: 4, color: '#fff',
    gateSide: p.openSides?.[0] ?? 'FRONT', openSides: p.openSides ?? ['FRONT'], stallNumber: p.stallNumber ?? null,
    status: p.status ?? 'AVAILABLE', stallTypeId: null, rotation: p.rotation ?? 0, ...p
  } as Stall;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

describe('CAD frame and input', () => {
  const frame = new CadFrame(-20, 15);

  it('maps CAD (origin bottom-left, Y up) to planner world (centre origin, Z down)', () => {
    expect(frame.toWorld({ x: 0, y: 0 })).toEqual({ x: -20, z: 15 });
    expect(frame.toCad({ x: 0, z: 0 })).toEqual({ x: 20, y: 15 });
    expect(cadAngle({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(90);
  });

  it('parses absolute, relative, polar and direct-distance input', () => {
    expect(parsePointEntry('42, 18.5')).toEqual({ kind: 'absolute', x: 42, y: 18.5 });
    expect(parsePointEntry('@3,-2')).toEqual({ kind: 'relative', dx: 3, dy: -2 });
    expect(parsePointEntry('@36<0')).toEqual({ kind: 'polar', distance: 36, angle: 0, relative: true });
    expect(parsePointEntry('12')).toEqual({ kind: 'distance', distance: 12 });
    expect(parsePointEntry('size')).toBeNull();
  });

  it('resolves relative input from the last point, Y up', () => {
    const last = { x: 0, z: 0 };
    expect(resolvePointEntry({ kind: 'relative', dx: 3, dy: 2 }, frame, last, null)).toEqual({ x: 3, z: -2 });
    const up = resolvePointEntry({ kind: 'polar', distance: 5, angle: 90, relative: true }, frame, last, null)!;
    expect(round(up.x)).toBe(0);
    expect(round(up.z)).toBe(-5);
    expect(resolvePointEntry({ kind: 'distance', distance: 4 }, frame, last, { x: 1, z: 0 })).toEqual({ x: 4, z: 0 });
    expect(resolvePointEntry({ kind: 'relative', dx: 1, dy: 1 }, frame, null, null)).toBeNull();
  });

  it('reads sizes and AutoCAD keywords', () => {
    expect(parseSize('3x2')).toEqual({ width: 3, depth: 2 });
    expect(parseSize('4.5 × 3')).toEqual({ width: 4.5, depth: 3 });
    expect(parseSize('0x3')).toBeNull();
    expect(formatSize({ width: 3, depth: 2 })).toBe('3x2');
    const keywords = ['Size', 'Gap', 'Flip', 'Back-to-back'];
    expect(matchKeyword('b', keywords)).toBe('Back-to-back');
    expect(matchKeyword('gap', keywords)).toBe('Gap');
    expect(matchKeyword('x', keywords)).toBeNull();
    expect(matchKeyword('x', ['Next', 'eXit'])).toBe('eXit');
  });
});

describe('stall orientation', () => {
  it('turns sides a quarter clockwise at a time', () => {
    expect(turnSides(['FRONT'], 1)).toEqual(['LEFT']);
    expect(turnSides(['FRONT'], -1)).toEqual(['RIGHT']);
    expect(turnSides(['BACK', 'LEFT'], 2)).toEqual(['FRONT', 'RIGHT']);
  });

  it('stores right-angle turns unrotated with width and depth swapped', () => {
    const s = normaliseRightAngle(stall({ posX: 0, posZ: 0, width: 3, length: 2, rotation: 90 }));
    expect([s.width, s.length, s.rotation, s.openSides]).toEqual([2, 3, 0, ['LEFT']]);
    const odd = normaliseRightAngle(stall({ posX: 0, posZ: 0, width: 3, length: 2, rotation: 30 }));
    expect(odd.rotation).toBe(30);
  });

  it('rotates about a base point (clockwise on the plan)', () => {
    const s = rotateAbout(stall({ posX: 1.5, posZ: 1, width: 3, length: 2 }), { x: 0, z: 0 }, 90);
    expect([round(s.posX), round(s.posZ), s.width, s.length]).toEqual([-1, 1.5, 2, 3]);
  });

  it('mirrors in vertical and horizontal lines, swapping the facing sides', () => {
    const left = stall({ posX: 2, posZ: 0, width: 2, length: 2, openSides: ['LEFT'] });
    const v = mirrorIn(left, { x: 0, z: -1 }, { x: 0, z: 1 });
    expect([round(v.posX), v.openSides]).toEqual([-2, ['RIGHT']]);
    const front = stall({ posX: 0, posZ: 2, width: 2, length: 2, openSides: ['FRONT'] });
    const h = mirrorIn(front, { x: -1, z: 0 }, { x: 1, z: 0 });
    expect([round(h.posZ), h.openSides, h.rotation]).toEqual([-2, ['BACK'], 0]);
  });
});

describe('stall generators', () => {
  const size = { width: 3, depth: 2 };

  it('fills a row left to right with stalls above the line, opening onto it', () => {
    const row = rowFootprints({ start: { x: 0, z: 0 }, end: { x: 10, z: 0 }, size, gap: 0, flip: false, backToBack: false });
    expect(row.length).toBe(3);
    expect(row.map(r => [r.posX, r.posZ])).toEqual([[1.5, -1], [4.5, -1], [7.5, -1]]);
    expect(row.every(r => r.rotation === 0 && r.openSides[0] === 'FRONT')).toBeTrue();
  });

  it('turns stalls for a row drawn upwards: to the west, open on the right', () => {
    const row = rowFootprints({ start: { x: 0, z: 0 }, end: { x: 0, z: -6 }, size, gap: 0, flip: false, backToBack: false });
    expect(row.map(r => [round(r.posX), round(r.posZ), r.width, r.length, r.openSides[0]]))
      .toEqual([[-1, -1.5, 2, 3, 'RIGHT'], [-1, -4.5, 2, 3, 'RIGHT']]);
  });

  it('adds a second row back to back, opening the other way; gap and flip apply', () => {
    const row = rowFootprints({ start: { x: 0, z: 0 }, end: { x: 7, z: 0 }, size, gap: 1, flip: true, backToBack: true });
    expect(row.length).toBe(4);
    expect(row.slice(0, 2).map(r => [r.posX, r.posZ, r.openSides[0]])).toEqual([[1.5, 1, 'BACK'], [5.5, 1, 'BACK']]);
    expect(row.slice(2).map(r => [r.posZ, r.openSides[0]])).toEqual([[3, 'FRONT'], [3, 'FRONT']]);
  });

  it('builds an island two deep with corner stalls open on two sides', () => {
    const island = islandFootprints({ x: 0, z: 0 }, { x: 9, z: 4 }, size);
    expect(island.length).toBe(6);
    const sides = (i: number) => [...island[i].openSides].sort();
    expect(sides(0)).toEqual(['BACK', 'LEFT']);
    expect(sides(1)).toEqual(['BACK']);
    expect(sides(5)).toEqual(['FRONT', 'RIGHT']);
  });

  it('lists array offsets in CAD sense (rows up)', () => {
    expect(arrayOffsets(2, 2, 5, 4)).toEqual([{ x: 4, z: -0 }, { x: 0, z: -5 }, { x: 4, z: -5 }]);
  });

  it('splits and merges rectangles, refusing what does not tile', () => {
    const big = stall({ posX: 0, posZ: 0, width: 6, length: 2, openSides: ['FRONT', 'LEFT'] });
    const parts = splitFootprint(big, 2, 1);
    expect(parts.map(p => [p.posX, p.width, [...p.openSides].sort()])).toEqual([[-1.5, 3, ['FRONT', 'LEFT']], [1.5, 3, ['FRONT']]]);
    const merged = mergeFootprints(parts.map((p, i) => stall({ ...p, id: String(i) })))!;
    expect([merged.posX, merged.width, merged.length, [...merged.openSides].sort()]).toEqual([0, 6, 2, ['FRONT', 'LEFT']]);
    const gap = [stall({ posX: 0, posZ: 0, width: 2, length: 2 }), stall({ posX: 3, posZ: 0, width: 2, length: 2 })];
    expect(mergeFootprints(gap)).toBeNull();
  });
});

describe('selection and snapping', () => {
  const a = stall({ id: 'a', posX: 1, posZ: 1, width: 2, length: 2 });
  const b = stall({ id: 'b', posX: 5, posZ: 1, width: 2, length: 2 });

  it('takes enclosed stalls in a window and touched ones in a crossing', () => {
    const rect = { minX: -1, maxX: 4.5, minZ: -1, maxZ: 3 };
    expect(selectInRect([a, b], rect, false).map(s => s.id)).toEqual(['a']);
    expect(selectInRect([a, b], rect, true).map(s => s.id)).toEqual(['a', 'b']);
  });

  it('snaps to end points before midpoints, and to the grid', () => {
    const targets = snapTargets([[{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }]]);
    expect(objectSnap({ x: 0.2, z: 0.1 }, targets, 0.5)).toEqual({ point: { x: 0, z: 0 }, kind: 'endpoint' });
    expect(objectSnap({ x: 2.1, z: 0 }, targets, 0.5)?.kind).toBe('midpoint');
    expect(objectSnap({ x: 9, z: 9 }, targets, 0.5)).toBeNull();
    expect(gridSnap({ x: 1.26, z: -0.74 }, { x: 0.5, z: 0 }, 0.5)).toEqual({ x: 1.5, z: -0.5 });
  });

  it('applies ORTHO and POLAR from the base point', () => {
    expect(orthoFrom({ x: 0, z: 0 }, { x: 5, z: 1 })).toEqual({ x: 5, z: 0 });
    const p = polarFrom({ x: 0, z: 0 }, { x: 5, z: -5.2 });
    expect(round(p.x)).toBe(round(-p.z));
  });
});

describe('RENUMBER order', () => {
  const frame = new CadFrame(0, 10);
  const list = [
    stall({ id: '1', posX: 1, posZ: 1, width: 2, length: 2 }), stall({ id: '2', posX: 3, posZ: 1, width: 2, length: 2 }),
    stall({ id: '3', posX: 1, posZ: 3, width: 2, length: 2 }), stall({ id: '4', posX: 3, posZ: 3, width: 2, length: 2 })
  ];

  it('reads rows from the top of the plan, left to right, or snakes', () => {
    expect(orderStalls([...list].reverse(), 'Rows', frame).map(s => s.id)).toEqual(['1', '2', '3', '4']);
    expect(orderStalls(list, 'Snake', frame).map(s => s.id)).toEqual(['1', '2', '4', '3']);
    expect(orderStalls(list, 'Columns', frame).map(s => s.id)).toEqual(['1', '3', '2', '4']);
  });
});

describe('portal export', () => {
  const plan = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };

  it('writes 1 m cells and per-cell borders at the SelfCare 20 px/m, dashed where open', () => {
    const out = portalExport('Hall X', plan, [stall({ posX: -8.5, posZ: -4, width: 3, length: 2, openSides: ['FRONT'] as GateSide[], stallNumber: 'STALL-001' })]);
    expect([out.length, out.breadth, out.metersToPixels]).toEqual([20, 10, 20]);
    const s = out.default_stalls[0];
    expect(s.area).toBe('6sqm');
    expect(s.stallCoords[0]).toEqual({ x: 0, y: 0 });
    expect(s.stallCoords.at(-1)).toEqual({ x: 40, y: 20 });
    expect(s.borderCoords.length).toBe(10);
    expect(s.borderCoords.filter(b => b.isDashed).every(b => b.y1 === 40 && b.y2 === 40)).toBeTrue();
    expect(s.borderCoords.filter(b => b.isDashed).length).toBe(3);
  });

  it('skips what the portal cannot show, with the reason', () => {
    const out = portalExport('Hall X', plan, [
      stall({ name: 'turned', posX: 0, posZ: 0, width: 3, length: 2, rotation: 30 }),
      stall({ name: 'off grid', posX: 0.25, posZ: 0, width: 3, length: 2 }),
      stall({ name: 'gone', posX: 0, posZ: 0, width: 3, length: 2, status: 'CANCELLED' })
    ]);
    expect(out.default_stalls.length).toBe(0);
    expect(out.skipped.map(s => s.reason)).toEqual(['rotated 30°', 'not on the 1 × 1 m cell grid']);
  });

  it('exports a quarter-turned stall, and uses the layout cell size when given', () => {
    const turned = stall({ posX: -8, posZ: -3.5, width: 3, length: 2, rotation: 90, openSides: ['FRONT'] as GateSide[] });
    const cells = portalExport('Hall X', plan, [turned]).default_stalls[0].stallCoords;
    expect(cells.length).toBe(6);
    expect(portalExport('Hall X', plan, [turned], { cellWidth: 2, cellHeight: 2 }).skipped[0].reason).toBe('not on the 2 × 2 m cell grid');
  });
});
