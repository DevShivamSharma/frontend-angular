import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import type { EventHallDetailView } from '../../domain/planner-hall.models';
import type { RuleCatalogue, RuleDefinition } from '../../../rules/data/rules.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { GROUPS, RuleId, VALUE_TEXT } from '../../domain/rule-summary';

export interface PlannerRulesData {
  hall: EventHallDetailView;
  /** Labels and descriptions of the rules; null when they could not be loaded. */
  catalogue: RuleCatalogue | null;
}

interface ShownRule {
  id: RuleId;
  label: string;
  description: string;
  reference: string;
  value: string | null;
  waitingFor: string | null;
}

/**
 * The rules on for a hall of an event, shown when the planner opens, before any drawing: what
 * every booth is checked against, with the values for this event. Read only; the venue sets them.
 */
@Component({
  selector: 'app-planner-rules-dialog',
  imports: [ButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planner-rules-dialog.component.html',
  styleUrl: './planner-rules-dialog.component.scss',
})
export class PlannerRulesDialogComponent {
  protected readonly data = dialogData<PlannerRulesData>();
  protected readonly ref = inject(DialogRef);

  private readonly definitions = computed(() => {
    const byId = new Map<RuleId, RuleDefinition>();
    for (const r of this.data.catalogue?.rules ?? []) byId.set(r.id, r);
    return byId;
  });

  private readonly onIds = computed(() =>
    (Object.entries(this.data.hall.rules.switches) as Array<[RuleId, boolean]>)
      .filter(([, on]) => on)
      .map(([id]) => id),
  );

  protected readonly onCount = computed(() => this.onIds().length);

  protected readonly groups = computed(() => {
    const defs = this.definitions();
    const shown = this.onIds().map((id) => ({ id, group: defs.get(id)?.group ?? 'layout' }));
    return GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      rules: shown.filter((r) => r.group === g.key).map((r) => this.describe(r.id)),
    })).filter((g) => g.rules.length);
  });

  protected readonly off = computed(() =>
    (Object.entries(this.data.hall.rules.switches) as Array<[RuleId, boolean]>)
      .filter(([, on]) => !on)
      .map(([id]) => this.definitions().get(id)?.label ?? words(id)),
  );

  protected readonly profile = computed(() => {
    const id = this.data.hall.rules.drawingProfile;
    const p = this.data.catalogue?.profiles.find((x) => x.id === id);
    return p ? `${p.label} — ${p.description}` : id || null;
  });

  private describe(id: RuleId): ShownRule {
    const def = this.definitions().get(id);
    const { values } = this.data.hall.rules;
    const audience = this.data.hall.event.audience;
    // The passage width of this event, not of both kinds.
    const value =
      id === 'openSideAccess' || id === 'PASSAGE'
        ? `${values.passageWidth[audience]} m clear (${audience})`
        : (VALUE_TEXT[id]?.(values) ?? null);
    return {
      id,
      label: def?.label ?? words(id),
      description: def?.description ?? '',
      reference: def?.reference ?? '',
      value,
      waitingFor: def && !def.available ? (def.waitingFor ?? null) : null,
    };
  }
}

/** A rule id in words, for when the catalogue is not at hand: "cornerKeepOut" → "Corner keep out". */
function words(id: string): string {
  const spaced = id
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
