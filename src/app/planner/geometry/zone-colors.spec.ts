import { nextPlanningZoneColor, planningZoneColor, validZoneColor, zoneLabelColor } from './zone-colors';
import { PlanningZone } from './planning-zones';

describe('Planning zone colours', () => {
  const zone = (id: string, color?: string): PlanningZone => ({id,label:id,kind:'EXHIBITION',eventType:'B2B',polygon:[],color});
  it('gives successive zones different saved colours, including after the preset palette', () => {
    const zones: PlanningZone[] = [];
    for (let index = 0; index < 100; index++) zones.push(zone(String(index), nextPlanningZoneColor(zones)));
    expect(new Set(zones.map(z => z.color)).size).toBe(100);
    expect(zones.every(z => validZoneColor(z.color))).toBeTrue();
  });
  it('keeps custom colours independent of type, ordering and deletions', () => {
    const custom = zone('a','#BE185D');
    expect(planningZoneColor({...custom,kind:'ADMIN'},42)).toBe('#be185d');
    expect(nextPlanningZoneColor([zone('b','#2563eb'),custom])).not.toBe('#2563eb');
    expect(nextPlanningZoneColor([zone('b','#2563eb')],'b')).toBe('#2563eb');
  });
  it('gives legacy zones deterministic defaults and readable text on custom colours', () => {
    expect(planningZoneColor(zone('a'),0)).not.toBe(planningZoneColor(zone('b'),1));
    expect(zoneLabelColor('#ffffff')).toBe('#000000');
    expect(zoneLabelColor('#000000')).toBe('#ffffff');
    expect(validZoneColor('red')).toBeFalse();
  });
});
