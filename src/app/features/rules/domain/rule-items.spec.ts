import { FormBuilder } from '@angular/forms';

import { RuleDefinition } from '../data/rules.models';
import { groupItems, itemsOfEvent, itemsOfRuleSet } from './rule-items';
import { createValuesForm, limitRange, toRuleValues } from './rule-values.form';

const DEFINITIONS: RuleDefinition[] = [
  { id: 'a', label: 'A', description: '', reference: '', group: 'access', available: true },
  { id: 'b', label: 'B', description: '', reference: '', group: 'floor', available: true },
  {
    id: 'c',
    label: 'C',
    description: '',
    reference: '',
    group: 'floor',
    available: false,
    waitingFor: 'zones',
  },
];

describe('rule items', () => {
  it('should treat a rule with no switch as on', () => {
    const items = itemsOfRuleSet(DEFINITIONS, { b: false });

    expect(items.map((i) => i.enabled)).toEqual([true, false, true]);
  });

  it('should show what an event changed and what it follows', () => {
    const items = itemsOfEvent(DEFINITIONS, [
      { id: 'a', enabled: false, defaultEnabled: true, overridden: true },
      { id: 'b', enabled: true, defaultEnabled: true, overridden: false },
    ]);

    expect(items[0]).toEqual(
      jasmine.objectContaining({ enabled: false, overridden: true, defaultEnabled: true }),
    );
    expect(items[1]).toEqual(jasmine.objectContaining({ enabled: true, overridden: false }));
  });

  it('should group the rows in a fixed order and drop empty groups', () => {
    const groups = groupItems(itemsOfRuleSet(DEFINITIONS, {}));

    expect(groups.map((g) => g.group)).toEqual(['floor', 'access']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'c']);
  });
});

describe('rule values form', () => {
  const values = {
    passageWidth: { B2B: 3, B2C: 3 },
    peripheralClearance: 1,
    curtainClearance: 1,
    facilityClearance: 1,
    partitionClearance: 1,
    pillarClearance: 0,
    emergencyExitClearance: 3,
    sizeStep: 1,
    maxUtilization: 0.7,
    eventSeparation: 3,
    foyerConstruction: false,
  };

  it('should edit the utilisation as a percentage and send it back as a share', () => {
    const form = createValuesForm(new FormBuilder(), values);

    expect(form.getRawValue().maxUtilization).toBe(70);
    form.controls.maxUtilization.setValue(55);
    expect(toRuleValues(form).maxUtilization).toBe(0.55);
  });

  it('should leave every other value as it was', () => {
    expect(toRuleValues(createValuesForm(new FormBuilder(), values))).toEqual(values);
  });

  it('should read a limit in the unit the user sees', () => {
    expect(limitRange('m', 1.5, 5)).toBe('1.5 to 5 m');
    expect(limitRange('share', 0.1, 1)).toBe('10 to 100 %');
  });
});
