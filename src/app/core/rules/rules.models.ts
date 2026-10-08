/** Mirrors the backend's rule catalogue, an organisation's rules and check reports (Module C). */

export type RuleId =
  | 'hallBoundary'
  | 'stallOverlap'
  | 'sizeStep'
  | 'peripheralClearance'
  | 'openSideAccess'
  | 'PASSAGE'
  | 'NO_CONSTRUCTION'
  | 'ENTRY_EXIT_ACCESS'
  | 'EMERGENCY_EXIT_ACCESS'
  | 'FACILITY_ACCESS'
  | 'FOYER'
  | 'PARTITION'
  | 'SMOKE_CURTAIN'
  | 'cornerKeepOut'
  | 'internalZones'
  | 'eventSeparation'
  | 'maxUtilization';

export type RuleGroup = 'floor' | 'stalls' | 'access' | 'layout';
export type EventType = 'B2B' | 'B2C';
export type StallSide = 'top' | 'bottom' | 'left' | 'right';

export interface RuleDefinition {
  id: RuleId;
  label: string;
  description: string;
  reference: string;
  group: RuleGroup;
  available: boolean;
  waitingFor?: string;
}

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
  gridMetres: number | null;
  noRotation: boolean;
  maxSide: number | null;
}

export interface RuleCatalogue {
  rules: RuleDefinition[];
  limits: ValueLimit[];
  profiles: DrawingProfile[];
}

export interface RuleValues {
  passageWidth: Record<EventType, number>;
  peripheralClearance: number;
  curtainClearance: number;
  facilityClearance: number;
  partitionClearance: number;
  emergencyExitClearance: number;
  sizeStep: number;
  maxUtilization: number;
  eventSeparation: number;
  foyerConstruction: boolean;
}

export interface RuleReference {
  document: string;
  section?: string | null;
  note?: string | null;
}

/** An organisation's rules: one set of them per organisation. */
export interface RulesView {
  switches: Record<RuleId, boolean>;
  values: RuleValues;
  references: RuleReference[];
  drawingProfile: string;
  updatedAt: string;
}

export interface RulesInput {
  switches?: Partial<Record<RuleId, boolean>>;
  values?: RuleValues;
  references?: RuleReference[];
  drawingProfile?: string;
}

export interface PlanStall {
  id: string;
  number?: string | null;
  x: number;
  y: number;
  width: number;
  depth: number;
  openSides: StallSide[];
  rotation?: number;
}

export interface RuleOverride {
  ruleId: RuleId;
  stallIds?: string[] | null;
  reason: string;
}

export interface FloorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Violation {
  ruleId: RuleId | `profile.${string}`;
  reference: string;
  message: string;
  stallIds: string[];
  areas: FloorRect[];
  overridden: { reason: string; by: string | null } | null;
}

export interface RuleCheck {
  passed: boolean;
  violations: Violation[];
  rules: Array<{
    id: RuleId;
    state: 'checked' | 'off' | 'unavailable';
    violations: number;
    overridden: number;
  }>;
  utilisation: number;
  hall: { id: string; name: string; version: number };
}
