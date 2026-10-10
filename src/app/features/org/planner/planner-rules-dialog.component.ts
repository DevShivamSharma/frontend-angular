import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import type { EventHallDetailView } from '../../../core/events/events.models';
import type { RuleCatalogue, RuleDefinition, RuleId } from '../../../core/rules/rules.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import { GROUPS, VALUE_TEXT } from '../rules/rules-summary.component';

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
  template: `
    <header class="dialog-title head">
      <span class="badge" aria-hidden="true"><app-icon name="rule" /></span>
      <span>
        Rules for {{ data.hall.hall.name }}
        <small class="muted"
          >{{ data.hall.event.name }} · {{ data.hall.event.audience }} · set by the venue, for your
          information</small
        >
      </span>
    </header>
    <div class="dialog-content body">
      <p class="lead">
        Every booth you draw is checked against these {{ onCount() }} rules. A change that breaks
        one is not made, and the message says which rule.
      </p>
      @if (profile(); as p) {
        <p class="profile"><b>Drawing:</b> {{ p }}</p>
      }
      @for (g of groups(); track g.key) {
        <section>
          <h3 class="group">{{ g.label }}</h3>
          <ul class="rules">
            @for (r of g.rules; track r.id) {
              <li>
                <app-icon name="check_circle" class="on" />
                <div class="rule">
                  <span class="name"
                    >{{ r.label }}
                    @if (r.reference) {
                      <span class="ref">{{ r.reference }}</span>
                    }
                  </span>
                  @if (r.value) {
                    <span class="value">{{ r.value }}</span>
                  }
                  @if (r.description) {
                    <span class="muted small">{{ r.description }}</span>
                  }
                  @if (r.waitingFor) {
                    <span class="muted small"
                      ><app-icon name="hourglass_empty" /> Takes effect with:
                      {{ r.waitingFor }}</span
                    >
                  }
                </div>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="muted">No rules are on for this hall: booths are checked only for the floor.</p>
      }
      @if (off().length) {
        <details class="off">
          <summary>{{ off().length }} rules are off for this hall</summary>
          <p class="muted small">{{ off().join(', ') }}</p>
        </details>
      }
    </div>
    <div class="dialog-actions">
      <button pButton type="button" (click)="ref.close()">
        <app-icon name="arrow_forward" />Start planning
      </button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .head small {
      display: block;
      font: var(--app-body-small);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--app-primary) 14%, transparent);
      color: var(--app-primary);
      flex: 0 0 auto;
    }
    .body {
      display: grid;
      gap: 14px;
    }
    .lead,
    .profile {
      margin: 0;
    }
    .group {
      margin: 0 0 8px;
      font: var(--app-title-small);
      color: var(--app-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .rules {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .rules li {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .on {
      color: light-dark(#15803d, #4ade80);
      flex: 0 0 auto;
    }
    .rule {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font: var(--app-title-small);
    }
    .ref {
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
      margin-left: 4px;
    }
    .value {
      font: var(--app-body-medium);
      font-weight: 600;
      color: var(--app-primary);
    }
    .small {
      font: var(--app-body-small);
    }
    .off summary {
      cursor: pointer;
      font: var(--app-label-medium);
      color: var(--app-on-surface-variant);
    }
  `,
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
