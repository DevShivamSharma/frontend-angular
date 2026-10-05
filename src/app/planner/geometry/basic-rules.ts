/** Persisted switches. Missing keys keep the existing behaviour (on). */
export const BASIC_RULE_IDS = [
  'hallBoundary', 'stallOverlap', 'sizeStep', 'peripheralClearance', 'openSideAccess',
  'PASSAGE', 'NO_CONSTRUCTION', 'ENTRY_EXIT_ACCESS', 'EMERGENCY_EXIT_ACCESS',
  'FACILITY_ACCESS', 'FOYER', 'PARTITION', 'SMOKE_CURTAIN',
  // Meeting rules (October 2026): no stalls in the hall's corners, none in internal (Media/Admin)
  // zones, and B2B / B2C zones kept apart.
  'cornerKeepOut', 'internalZones', 'eventSeparation'
] as const;

export type BasicRuleId = typeof BASIC_RULE_IDS[number];
export type BasicRuleSettings = Partial<Record<BasicRuleId, boolean>>;

export function ruleEnabled(rules: { enabledRules?: BasicRuleSettings | null }, id: BasicRuleId): boolean {
  return rules.enabledRules?.[id] !== false;
}

export const BASIC_RULES: ReadonlyArray<{ id: BasicRuleId; label: string; description: string }> = [
  { id: 'hallBoundary', label: 'Hall boundary & floor', description: 'Keep stalls inside the hall and off walls and floor openings.' },
  { id: 'stallOverlap', label: 'Stall overlap', description: 'Prevent one stall from overlapping another.' },
  { id: 'sizeStep', label: 'Grid size step', description: 'Require stall sizes to use the hall’s size step. Position snapping has its own control.' },
  { id: 'peripheralClearance', label: 'Wall clearance', description: 'Keep the configured clearance along external walls.' },
  { id: 'openSideAccess', label: 'Open-side passage', description: 'Keep the event’s passage width clear in front of every open side.' },
  { id: 'PASSAGE', label: 'Compulsory passages', description: 'Keep marked entry, exit and service passages free.' },
  { id: 'NO_CONSTRUCTION', label: 'No-construction zones', description: 'Keep stalls out of areas marked NC.' },
  { id: 'ENTRY_EXIT_ACCESS', label: 'Entry, exit & service access', description: 'Keep access zones and the space in front of gates free.' },
  { id: 'EMERGENCY_EXIT_ACCESS', label: 'Emergency access', description: 'Keep emergency exit zones and door access free.' },
  { id: 'FACILITY_ACCESS', label: 'Fire-safety & facility access', description: 'Keep the configured clearance around hose reels and public facilities.' },
  { id: 'FOYER', label: 'Foyer restrictions', description: 'Keep marked foyers and pre-function areas free.' },
  { id: 'PARTITION', label: 'Partition clearance', description: 'Keep the configured clearance around partitions.' },
  { id: 'SMOKE_CURTAIN', label: 'Smoke-curtain clearance', description: 'Keep the configured clearance around smoke curtains.' },
  { id: 'cornerKeepOut', label: 'Hall corners', description: 'Keep a full passage width from at least one of the two walls meeting at a hall corner.' },
  { id: 'internalZones', label: 'Internal zones', description: 'No stalls in Media or Admin zones; they are not sold.' },
  { id: 'eventSeparation', label: 'B2B / B2C separation', description: 'Keep 3 m between stalls of B2B zones and stalls of B2C zones.' }
];
