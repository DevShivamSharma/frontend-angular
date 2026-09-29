/**
 * A stall-plotting rule from the shared library (`/api/planner-rules`), written by planners in
 * their own words. Rules are not tied to halls: a layout records the ones chosen for its design
 * (`ruleIds`).
 */
export interface PlannerRule {
  id: number;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerRuleInput {
  description: string;
}
