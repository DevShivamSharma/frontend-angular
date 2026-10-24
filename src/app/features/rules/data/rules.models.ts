export type RuleGroup = 'floor' | 'stalls' | 'access' | 'layout';

/** One check the portal can make on a stall plan. */
export interface RuleDefinition {
  id: string;
  label: string;
  description: string;
  /** Where the rule comes from in ITPO's guidelines. */
  reference: string;
  group: RuleGroup;
  /** False while the data the rule needs does not exist yet; it can still be switched on. */
  available: boolean;
  waitingFor?: string;
}

/** What a value of the rules may be. */
export interface ValueLimit {
  key: string;
  label: string;
  unit: 'm' | 'share';
  min: number;
  max: number;
}

export interface DrawingProfile {
  id: string;
  label: string;
  description: string;
}

export interface RuleCatalogue {
  rules: RuleDefinition[];
  limits: ValueLimit[];
  profiles: DrawingProfile[];
}

/** Every value the rules use, in metres unless stated. */
export interface RuleValues {
  passageWidth: { B2B: number; B2C: number };
  peripheralClearance: number;
  curtainClearance: number;
  facilityClearance: number;
  partitionClearance: number;
  pillarClearance: number;
  emergencyExitClearance: number;
  sizeStep: number;
  /** A share, 0 to 1. */
  maxUtilization: number;
  eventSeparation: number;
  foyerConstruction: boolean;
}

export interface RuleReference {
  document: string;
  section?: string | null;
  note?: string | null;
}

/** The rules every hall follows. */
export interface RuleSet {
  switches: Record<string, boolean>;
  values: RuleValues;
  references: RuleReference[];
  drawingProfile: string;
  updatedAt: string;
}

export interface RuleSetChanges {
  switches?: Record<string, boolean>;
  values?: RuleValues;
  references?: RuleReference[];
  drawingProfile?: string;
}

/** A rule as one event has it. */
export interface EventRule {
  id: string;
  /** What applies to the event. */
  enabled: boolean;
  defaultEnabled: boolean;
  /** The event changed it from the default. */
  overridden: boolean;
}

export interface EventRules {
  event: { id: string; name: string | null; kind: 'internal' | 'external' };
  rules: EventRule[];
  values: RuleValues;
}
