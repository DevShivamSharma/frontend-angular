import type { Stall } from '../models/stall.model';
import type { AuditEntry, Point, Rect } from '../geometry/placement-rules';
import { DraftFrame, parsePoint, parseSize, polarPoint, orthoPoint } from './draft-frame';
import { DraftEngine, type DraftHost, rotated, rowStalls } from './draft-engine';

/*
 * A 60 x 40 m hall, centre-origin in the planner: world x -30..30, z -20..20. In the drafting
 * frame (CAD) its lower-left corner is (0, 0) and Y points up.
 */
const frame = new DraftFrame(-30, 20);
const W = (x: number, y: number): Point => frame.toWorld({ x, y });

function engine(audit: AuditEntry[] = []): { e: DraftEngine; zooms: Array<Rect | 'extents'>; actions: string[] } {
  const zooms: Array<Rect | 'extents'> = [];
  const actions: string[] = [];
  const host: DraftHost = {
    frame: () => frame,
    hallId: () => 'h1',
    prefix: () => 'STALL-',
    defaultSize: () => [3, 3],
    audit: () => audit,
    zoomTo: r => zooms.push(r),
    action: a => actions.push(a),
  };
  return { e: new DraftEngine(host), zooms, actions };
}

const userRect = (s: Stall) => {
  const a = frame.toUser({ x: s.posX - s.width / 2, z: s.posZ + s.length / 2 });
  return { x: a.x, y: a.y, w: s.width, l: s.length };
};

describe('DraftFrame', () => {
  it('uses CAD coordinates: origin lower-left, Y up, angles counter-clockwise from east', () => {
    expect(frame.toUser({ x: -30, z: 20 })).toEqual({ x: 0, y: 0 });
    expect(frame.toUser({ x: 30, z: -20 })).toEqual({ x: 60, y: 40 });
    expect(DraftFrame.angle(W(0, 0), W(0, 10))).toBe(90);
    expect(DraftFrame.angle(W(0, 0), W(-5, 0))).toBe(180);
  });

  it('reads absolute, relative, polar and direct-distance input', () => {
    const last = W(10, 10);
    expect(frame.toUser(parsePoint('12.5,3', frame, null, null)!)).toEqual({ x: 12.5, y: 3 });
    expect(frame.toUser(parsePoint('@4,-2', frame, last, null)!)).toEqual({ x: 14, y: 8 });
    expect(frame.toUser(parsePoint('@36<0', frame, last, null)!)).toEqual({ x: 46, y: 10 });
    expect(frame.toUser(parsePoint('@5<90', frame, last, null)!)).toEqual({ x: 10, y: 15 });
    // Direct distance: 6 m from the last point towards the cursor (straight up here).
    expect(frame.toUser(parsePoint('6', frame, last, W(10, 30))!)).toEqual({ x: 10, y: 16 });
    expect(parsePoint('Gap', frame, last, null)).toBeNull();
    expect(parseSize('3x2')).toEqual([3, 2]);
    expect(parseSize('4')).toEqual([4, 4]);
    expect(parseSize('x')).toBeNull();
  });

  it('constrains to ORTHO and POLAR angles', () => {
    expect(frame.toUser(orthoPoint(W(0, 0), W(10, 2)))).toEqual({ x: 10, y: 0 });
    const p = frame.toUser(polarPoint(W(0, 0), W(10, 9.5), 45));
    expect(p.x).toBeCloseTo(p.y, 6);
  });
});

describe('DraftEngine', () => {
  it('STALLROW fills a typed line with numbered stalls opening onto it (the proposal example)', () => {
    const { e } = engine();
    e.enter('SR');
    e.enter('3x2'); // size
    e.enter(''); // numbering: accept STALL-001 onwards
    e.enter('42,18.5'); // start point
    e.enter('@36<0'); // end point: 36 m east
    expect(e.stalls.length).toBe(12);
    expect(e.stalls[0].name).toBe('STALL-001');
    expect(e.stalls[11].name).toBe('STALL-012');
    // Left of an eastward line is north: the row stands on the line and opens down onto it.
    expect(userRect(e.stalls[0])).toEqual({ x: 42, y: 18.5, w: 3, l: 2 });
    expect(userRect(e.stalls[11])).toEqual({ x: 75, y: 18.5, w: 3, l: 2 });
    expect(e.stalls.every(s => s.openSides.join() === 'FRONT')).toBe(true);
    expect(e.log.join('\n')).toContain('12 stalls created: STALL-001 … STALL-012. 72.0 m² added.');
    expect(e.commandName).toBeNull();
  });

  it('STALLROW back-to-back, with a gap and a chosen prefix and start', () => {
    const { e } = engine();
    e.enter('SR');
    e.enter('');
    e.enter('P');
    e.enter('A-');
    e.enter('S');
    e.enter('10');
    e.enter('');
    e.enter('0,20');
    e.enter('B');
    e.enter('G');
    e.enter('1');
    e.enter('@11,0'); // 3 m stalls, 1 m gaps: 3 per row
    expect(e.stalls.map(s => s.name)).toEqual(['A-010', 'A-011', 'A-012', 'A-013', 'A-014', 'A-015']);
    const [north, south] = [e.stalls.slice(0, 3), e.stalls.slice(3)];
    expect(north.map(s => userRect(s).x)).toEqual([0, 4, 8]);
    expect(north.every(s => userRect(s).y === 20 && s.openSides[0] === 'BACK')).toBe(true);
    expect(south.every(s => userRect(s).y === 17 && s.openSides[0] === 'FRONT')).toBe(true);
  });

  it('places single stalls, moves, copies, rotates and erases them, all undoable', () => {
    const { e } = engine();
    e.enter('STL');
    e.enter('5,5');
    e.enter('20,5');
    e.enter('');
    expect(e.stalls.map(s => s.name)).toEqual(['STALL-001', 'STALL-002']);

    e.select([String(e.stalls[0].id)]);
    e.enter('M');
    e.enter('5,5');
    e.enter('@0,10');
    expect(userRect(e.stalls[0])).toEqual({ x: 5, y: 15, w: 3, l: 3 });

    e.enter('CO');
    e.enter('5,15');
    e.enter('@10,0');
    e.enter('@20,0');
    e.enter('');
    expect(e.stalls.map(s => s.name)).toEqual(['STALL-001', 'STALL-002', 'STALL-003', 'STALL-004']);
    expect(userRect(e.stalls[3]).x).toBe(25);

    e.select([String(e.stalls[1].id)]);
    e.enter('RO');
    e.enter('20,5');
    e.enter('90');
    // Quarter turn about its lower-left corner: 3 x 3 stays 3 x 3, the FRONT opening faces right.
    expect(e.stalls[1].openSides).toEqual(['RIGHT']);
    expect(userRect(e.stalls[1])).toEqual({ x: 17, y: 5, w: 3, l: 3 });

    e.enter('E');
    expect(e.stalls.length).toBe(3);
    e.undo();
    e.undo();
    expect(e.stalls[1].openSides).toEqual(['FRONT']);
    e.redo();
    expect(e.stalls[1].openSides).toEqual(['RIGHT']);
  });

  it('asks for objects when nothing is selected, and window-selects through the host', () => {
    const { e } = engine();
    e.enter('STL');
    e.enter('0,0');
    e.enter('');
    e.enter('E');
    expect(e.prompt?.wants).toBe('selection');
    e.enter(''); // nothing selected
    expect(e.commandName).toBeNull();
    expect(e.log).toContain('Nothing selected.');
    e.enter('E');
    e.select([String(e.stalls[0].id)]);
    e.enter('');
    expect(e.stalls.length).toBe(0);
  });

  it('keeps a numbered stall as cancelled when it is erased', () => {
    const { e } = engine();
    e.load([{ ...rowStalls(frame, W(0, 0), W(3, 0), [3, 3], 0, false, () => 'X', 'h1')[0], stallNumber: 'STALL-007' }]);
    e.enter('E');
    e.enter('ALL');
    e.enter('');
    expect(e.stalls.map(s => s.status)).toEqual(['CANCELLED']);
  });

  it('renumbers the drawing in reading order', () => {
    const { e } = engine();
    e.enter('SR');
    e.enter('');
    e.enter('');
    e.enter('0,0');
    e.enter('@9,0'); // bottom row: 3 stalls
    e.enter('SR');
    e.enter('');
    e.enter('');
    e.enter('0,10');
    e.enter('@6,0'); // top row: 2 stalls
    e.enter('RN');
    e.enter('B-');
    e.enter('');
    const byName = [...e.stalls].sort((a, b) => a.name.localeCompare(b.name)).map(s => userRect(s));
    expect(byName.map(r => [r.x, r.y])).toEqual([[0, 10], [3, 10], [0, 0], [3, 0], [6, 0]]);
  });

  it('repeats the last command on Enter, cancels on Esc and reports unknown commands', () => {
    const { e, actions } = engine();
    e.enter('ID');
    e.enter('3,4');
    expect(e.log).toContain('X = 3.00   Y = 4.00');
    e.enter('');
    expect(e.commandName).toBe('ID');
    e.escape();
    expect(e.commandName).toBeNull();
    expect(e.log).toContain('*Cancel*');
    e.enter('FOO');
    expect(e.log.join()).toContain('Unknown command "FOO"');
    e.enter('pp');
    e.enter('3d');
    expect(actions).toEqual(['pdf', '3d']);
  });

  it('measures with DIST', () => {
    const { e } = engine();
    e.enter('DI');
    e.enter('0,0');
    e.enter('@3,4');
    expect(e.log.join()).toContain('Distance = 5.00 m');
  });

  it('walks through rule issues with CHECK', () => {
    const { e, zooms } = engine();
    e.enter('STL');
    e.enter('0,0');
    e.enter('');
    const id = String(e.stalls[0].id);
    const { e: checked, zooms: z2 } = engine([
      { stallId: id, stallNumber: null, violations: [{ code: 'PERIPHERAL_CLEARANCE', ruleRef: 'ITPO D1', message: 'Too close to the wall.', geometry: [], relatedStallIds: [] }] },
    ]);
    checked.load(e.stalls);
    checked.enter('CHK');
    expect(checked.log.join('\n')).toContain('STALL-001: Too close to the wall. (ITPO D1)');
    expect([...checked.selection]).toEqual([id]);
    expect(z2.length).toBe(1);
    expect(zooms.length).toBe(0);
  });

  it('rotates by any angle through the rotation field', () => {
    const [s] = rowStalls(frame, W(0, 0), W(3, 0), [3, 2], 0, false, () => 'X', 'h1');
    const [r] = rotated([s], { x: s.posX, z: s.posZ }, 30);
    expect(r.rotation).toBe(330);
    expect([r.posX, r.posZ]).toEqual([s.posX, s.posZ]);
  });
});
