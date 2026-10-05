import { BASIC_RULES, ruleEnabled } from './basic-rules';
import { effectiveRules, type LayoutRules } from './placement-rules';
import type { EventType } from '../models/hall.model';
import type { RuleChanges } from '../layout-assistant.service';

/**
 * An assistant rule proposal against the hall's current rules: what would change, in words, and
 * the rules after applying it. Pure, so the chat can show the review and apply exactly that.
 * Anything already in place is left out, so "already set" is never shown as a change.
 */

/** "Passage width (B2B): 3 m → 4 m", "Turn off: Wall clearance", "New planner rule: “…”". */
export function describeRuleChanges(
  changes: RuleChanges,
  stored: Partial<LayoutRules> | null | undefined,
  eventType: EventType,
  existingNotes: readonly string[]
): string[] {
  const rules = effectiveRules(stored);
  const label = (id: string) => BASIC_RULES.find(r => r.id === id)?.label ?? id;
  const lines: string[] = [];
  for (const id of changes.enable) if (!ruleEnabled(rules, id)) lines.push(`Turn on: ${label(id)}`);
  for (const id of changes.disable) if (ruleEnabled(rules, id)) lines.push(`Turn off: ${label(id)}`);
  const passage = rules.minPassageWidth[eventType];
  if (changes.passageWidth !== null && changes.passageWidth !== passage) {
    lines.push(`Passage width (${eventType}): ${passage} m → ${changes.passageWidth} m`);
  }
  if (changes.wallClearance !== null && changes.wallClearance !== rules.peripheralClearance) {
    lines.push(`Wall clearance: ${rules.peripheralClearance} m → ${changes.wallClearance} m`);
  }
  for (const note of newNotes(changes, existingNotes)) lines.push(`New planner rule: “${note}”`);
  return lines;
}

/** The hall rules with the proposal applied: switches and values only, everything else kept. */
export function applyRuleChanges(
  stored: Partial<LayoutRules> | null | undefined,
  changes: RuleChanges,
  eventType: EventType
): LayoutRules {
  const rules = effectiveRules(stored);
  const enabledRules = { ...(rules.enabledRules ?? {}) };
  for (const id of changes.enable) enabledRules[id] = true;
  for (const id of changes.disable) enabledRules[id] = false;
  return {
    ...rules,
    enabledRules,
    minPassageWidth: changes.passageWidth === null
      ? rules.minPassageWidth
      : { ...rules.minPassageWidth, [eventType]: changes.passageWidth },
    peripheralClearance: changes.wallClearance ?? rules.peripheralClearance
  };
}

/** Written rules not already in the library (ignoring case and spacing). */
export function newNotes(changes: RuleChanges, existingNotes: readonly string[]): string[] {
  const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set(existingNotes.map(key));
  return changes.notes.map(n => n.trim()).filter(n => {
    if (!n || seen.has(key(n))) return false;
    seen.add(key(n));
    return true;
  });
}
