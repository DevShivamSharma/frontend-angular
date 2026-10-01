import type { RuleChanges } from '../layout-assistant.service';
import { applyRuleChanges, describeRuleChanges, newNotes } from './rule-changes';

const changes = (c: Partial<RuleChanges>): RuleChanges =>
  ({ enable: [], disable: [], passageWidth: null, wallClearance: null, notes: [], ...c });

describe('assistant rule changes', () => {
  it('describes only what would actually change', () => {
    const stored = { enabledRules: { peripheralClearance: false }, minPassageWidth: { B2B: 3, B2C: 4 } };
    const lines = describeRuleChanges(changes({
      enable: ['peripheralClearance', 'stallOverlap'],
      disable: ['FOYER'],
      passageWidth: 4,
      wallClearance: 1,
      notes: ['Corner stalls are premium', 'Existing rule']
    }), stored, 'B2B', ['existing  RULE']);
    expect(lines).toEqual([
      'Turn on: Wall clearance',
      'Turn off: Foyer restrictions',
      'Passage width (B2B): 3 m → 4 m',
      'New planner rule: “Corner stalls are premium”'
    ]);
  });

  it('applies switches and values for the event type, keeping every other rule', () => {
    const stored = { snapStep: 0.5, minPassageWidth: { B2B: 3, B2C: 4 } };
    const rules = applyRuleChanges(stored, changes({ disable: ['peripheralClearance'], passageWidth: 5, wallClearance: 2 }), 'B2C');
    expect(rules.enabledRules).toEqual({ peripheralClearance: false });
    expect(rules.minPassageWidth).toEqual({ B2B: 3, B2C: 5 });
    expect(rules.peripheralClearance).toBe(2);
    expect(rules.snapStep).toBe(0.5);
  });

  it('adds each new written rule once', () => {
    expect(newNotes(changes({ notes: [' A rule ', 'a  rule', 'B'] }), ['b'])).toEqual(['A rule']);
  });
});
