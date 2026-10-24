import { EventRule, RuleDefinition, RuleGroup } from '../data/rules.models';

/** A rule as a row of a switch list. */
export interface RuleItem extends RuleDefinition {
  enabled: boolean;
  /** Event view only: the event changed it from the default. */
  overridden: boolean;
  defaultEnabled: boolean;
}

export const GROUP_TITLES: Record<RuleGroup, string> = {
  floor: 'Hall floor',
  stalls: 'Stalls',
  access: 'Access and safety',
  layout: 'Layout',
};

const GROUP_ORDER: RuleGroup[] = ['floor', 'stalls', 'access', 'layout'];

/** The rules of the set, as rows. */
export function itemsOfRuleSet(
  definitions: readonly RuleDefinition[],
  switches: Record<string, boolean>,
): RuleItem[] {
  return definitions.map((definition) => ({
    ...definition,
    enabled: switches[definition.id] !== false,
    overridden: false,
    defaultEnabled: switches[definition.id] !== false,
  }));
}

/** The rules of one event, as rows: what applies, and whether the event changed it. */
export function itemsOfEvent(
  definitions: readonly RuleDefinition[],
  rules: readonly EventRule[],
): RuleItem[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return definitions.map((definition) => {
    const rule = byId.get(definition.id);
    return {
      ...definition,
      enabled: rule?.enabled ?? true,
      overridden: rule?.overridden ?? false,
      defaultEnabled: rule?.defaultEnabled ?? true,
    };
  });
}

export interface RuleItemGroup {
  group: RuleGroup;
  title: string;
  items: RuleItem[];
}

/** The rows under their group headings, in a fixed order. */
export function groupItems(items: readonly RuleItem[]): RuleItemGroup[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: GROUP_TITLES[group],
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}
