import type { RuleGroup, RuleValues } from '../../rules/data/rules.models';

/** A rule's id, as the rules catalogue names it. */
export type RuleId = string;

/** The groups the rules are listed under, in order. */
export const GROUPS: Array<{ key: RuleGroup; label: string }> = [
  { key: 'floor', label: 'The hall floor' },
  { key: 'access', label: 'Passages and access' },
  { key: 'stalls', label: 'Stalls' },
  { key: 'layout', label: 'The whole layout' },
];

const m = (n: number) => `${n} m`;

/** The value a rule checks with, in words; rules without a value have none. */
export const VALUE_TEXT: Partial<Record<RuleId, (v: RuleValues) => string>> = {
  peripheralClearance: (v) => `${m(v.peripheralClearance)} from the hall's walls`,
  openSideAccess: (v) =>
    `${m(v.passageWidth.B2B)} clear (B2B), ${m(v.passageWidth.B2C)} clear (B2C)`,
  SMOKE_CURTAIN: (v) => `${m(v.curtainClearance)} from a fire curtain`,
  FACILITY_ACCESS: (v) => `${m(v.facilityClearance)} from a facility`,
  PARTITION: (v) => `${m(v.partitionClearance)} from a partition`,
  PILLAR: (v) =>
    v.pillarClearance
      ? `${m(v.pillarClearance)} from a pillar`
      : 'Not on a pillar; next to one is fine',
  EMERGENCY_EXIT_ACCESS: (v) => `${m(v.emergencyExitClearance)} clear in front`,
  sizeStep: (v) => `Sizes in steps of ${m(v.sizeStep)}`,
  maxUtilization: (v) => `At most ${Math.round(v.maxUtilization * 100)}% of the floor`,
  eventSeparation: (v) => `${m(v.eventSeparation)} between events`,
  FOYER: (v) => (v.foyerConstruction ? 'Stalls allowed in foyers' : 'No stalls in foyers'),
};
