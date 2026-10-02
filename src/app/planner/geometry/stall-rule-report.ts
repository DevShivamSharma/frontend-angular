import { BASIC_RULE_IDS, BASIC_RULES, ruleEnabled, type BasicRuleId } from './basic-rules';
import { validatePlacement, type Footprint, type PlacementContext, type ViolationCode } from './placement-rules';

/**
 * Which hall rules apply to one stall, and whether it meets each of them — the "Rules" view of
 * the selected stall in the editor.
 *
 * Every switchable rule is checked on its own: the real validator runs with only that rule
 * switched on, so a rule's result is exactly what that rule enforces, nothing re-implemented.
 */

export type RuleStatus = 'ok' | 'broken' | 'off' | 'not-used';

export interface StallRuleCheck {
  id: BasicRuleId;
  label: string;
  description: string;
  status: RuleStatus;
  /** Why the stall breaks the rule (status "broken"). */
  messages: string[];
}

export interface StallRuleReport {
  checks: StallRuleCheck[];
  /** Problems no switch controls (e.g. no open side, door access): always enforced. */
  other: string[];
}

/** The violation codes each rule can produce. */
const CODES: Record<BasicRuleId, readonly ViolationCode[]> = {
  hallBoundary: ['OUTSIDE_HALL', 'RESTRICTED_ZONE'],
  stallOverlap: ['STALL_OVERLAP'],
  sizeStep: ['INVALID_DIMENSIONS'],
  peripheralClearance: ['PERIPHERAL_CLEARANCE'],
  openSideAccess: ['OPEN_SIDE_BLOCKED', 'OPEN_SIDE_PASSAGE', 'PATHWAY_WIDTH', 'INVALID_TOUCHING', 'INVALID_BACK_TO_BACK'],
  PASSAGE: ['RESTRICTED_ZONE'],
  NO_CONSTRUCTION: ['RESTRICTED_ZONE'],
  ENTRY_EXIT_ACCESS: ['RESTRICTED_ZONE'],
  EMERGENCY_EXIT_ACCESS: ['RESTRICTED_ZONE'],
  FACILITY_ACCESS: ['RESTRICTED_ZONE'],
  FOYER: ['RESTRICTED_ZONE'],
  PARTITION: ['RESTRICTED_ZONE'],
  SMOKE_CURTAIN: ['RESTRICTED_ZONE']
};

/** Rules that check every stall, whatever the hall holds. The others need a zone of their kind. */
const ALWAYS: readonly BasicRuleId[] = ['hallBoundary', 'stallOverlap', 'sizeStep', 'peripheralClearance', 'openSideAccess'];

export function stallRuleReport(stall: Footprint & { id: string | number }, ctx: PlacementContext): StallRuleReport {
  const id = String(stall.id);
  const zoneKinds = new Set<string>(ctx.zones.filter(z => z.polygon?.length >= 3).map(z => z.kind));
  const checks = BASIC_RULES.map((rule): StallRuleCheck => {
    const base = { id: rule.id, label: rule.label, description: rule.description, messages: [] };
    if (!ALWAYS.includes(rule.id) && !zoneKinds.has(rule.id)) return { ...base, status: 'not-used' };
    if (!ruleEnabled(ctx.rules, rule.id)) return { ...base, status: 'off' };
    const only = Object.fromEntries(BASIC_RULE_IDS.map(r => [r, r === rule.id]));
    const { violations } = validatePlacement(stall, { ...ctx, rules: { ...ctx.rules, enabledRules: only } }, id);
    const messages = unique(violations.filter(v => CODES[rule.id].includes(v.code)).map(v => v.message));
    return { ...base, status: messages.length ? 'broken' : 'ok', messages };
  });

  const ruled = new Set(Object.values(CODES).flat());
  const other = unique(validatePlacement(stall, ctx, id).violations.filter(v => !ruled.has(v.code)).map(v => v.message));
  return { checks, other };
}

function unique(texts: string[]): string[] {
  return [...new Set(texts)];
}
