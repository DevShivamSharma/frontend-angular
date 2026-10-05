import { effectiveRules, type PlacementContext, type PlacementStall } from './placement-rules';
import { stallRuleReport } from './stall-rule-report';

const stall = (id: string, posX: number, posZ: number): PlacementStall =>
  ({ id, stallNumber: id, status: 'AVAILABLE', posX, posZ, width: 4, length: 3, openSides: ['FRONT'], gateSide: 'FRONT' } as PlacementStall);

/** A 40 x 40 m hall with a compulsory passage across x = -2..2. */
function hall(stalls: PlacementStall[], enabledRules = {}): PlacementContext {
  return {
    boundary: [{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }],
    zones: [{ id: 'p', kind: 'PASSAGE', label: 'Main passage', polygon: [{ x: -2, z: -20 }, { x: 2, z: -20 }, { x: 2, z: 20 }, { x: -2, z: 20 }] }],
    openings: [],
    rules: { ...effectiveRules({}), enabledRules },
    eventType: 'B2B',
    stalls
  };
}

describe('stallRuleReport', () => {
  it('says which rule a stall breaks, and why', () => {
    const s = stall('a', 0, 0);
    const report = stallRuleReport(s, hall([s]));
    const status = (id: string) => report.checks.find(c => c.id === id)!;
    expect(status('PASSAGE').status).toBe('broken');
    expect(status('PASSAGE').messages[0]).toContain('Main passage');
    expect(status('stallOverlap').status).toBe('ok');
    expect(status('FOYER').status).toBe('not-used');
  });

  it('reports a switched-off rule as off, not as met', () => {
    const s = stall('a', 0, 0);
    const report = stallRuleReport(s, hall([s], { PASSAGE: false }));
    expect(report.checks.find(c => c.id === 'PASSAGE')!.status).toBe('off');
  });

  it('checks a stall against the others, not against itself', () => {
    const a = stall('a', -10, 0);
    const b = stall('b', -10, 0);
    expect(stallRuleReport(a, hall([a])).checks.find(c => c.id === 'stallOverlap')!.status).toBe('ok');
    expect(stallRuleReport(a, hall([a, b])).checks.find(c => c.id === 'stallOverlap')!.status).toBe('broken');
  });
});
