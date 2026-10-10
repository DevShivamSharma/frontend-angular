import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../../../shared/icon.component';

import type {
  RuleCatalogue,
  RuleDefinition,
  RuleGroup,
  RuleId,
  RulesView,
  RuleValues,
} from '../../../core/rules/rules.models';

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
  EMERGENCY_EXIT_ACCESS: (v) => `${m(v.emergencyExitClearance)} clear in front`,
  sizeStep: (v) => `Sizes in steps of ${m(v.sizeStep)}`,
  maxUtilization: (v) => `At most ${Math.round(v.maxUtilization * 100)}% of the floor`,
  eventSeparation: (v) => `${m(v.eventSeparation)} between events`,
  FOYER: (v) => (v.foyerConstruction ? 'Stalls allowed in foyers' : 'No stalls in foyers'),
};

/**
 * The organisation's rules, read only: each rule on or off with the value it checks, the
 * drawing profile, and the documents the rules follow. For people who draw stalls but don't
 * set the rules.
 */
@Component({
  selector: 'app-rules-summary',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = rules();
    <section class="panel">
      <h2 class="section-title">Drawing</h2>
      <p class="profile">
        <b>{{ profile()?.label ?? s.drawingProfile }}</b>
        @if (profile()?.description; as d) {
          <span class="muted"> — {{ d }}</span>
        }
      </p>
      <p class="muted small">
        {{ onCount() }} of {{ availableCount() }} checks are on. Every stall you draw is checked
        against them.
      </p>
    </section>

    @for (g of groups; track g.key) {
      <section class="panel">
        <h2 class="section-title">{{ g.label }}</h2>
        <ul class="rules">
          @for (r of rulesOf(g.key); track r.id) {
            <li [class.off]="!isOn(r)">
              <span
                class="status-chip state"
                [class.is-positive]="isOn(r)"
                [class.is-neutral]="!isOn(r)"
                >{{ stateLabel(r) }}</span
              >
              <div class="rule">
                <span class="rule-name"
                  >{{ r.label }} <span class="ref">{{ r.reference }}</span></span
                >
                <span class="muted small">{{ r.description }}</span>
                @if (isOn(r) && valueText(r.id); as v) {
                  <span class="value small">{{ v }}</span>
                }
                @if (!r.available) {
                  <span class="small muted"
                    ><app-icon name="hourglass_empty" /> Takes effect with: {{ r.waitingFor }}</span
                  >
                }
              </div>
            </li>
          }
        </ul>
      </section>
    }

    @if (s.references.length) {
      <section class="panel">
        <h2 class="section-title">Documents these rules follow</h2>
        <ul class="docs">
          @for (ref of s.references; track $index) {
            <li>
              {{ ref.document }}
              @if (ref.section) {
                <span class="muted">· section {{ ref.section }}</span>
              }
              @if (ref.note) {
                <span class="muted small"> — {{ ref.note }}</span>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 16px;
    }
    .small {
      font: var(--app-body-small);
    }
    .profile {
      margin: 0 0 4px;
    }
    .rules,
    .docs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .docs {
      gap: 6px;
    }
    .rules li {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .rules li.off .rule {
      opacity: 0.7;
    }
    .state {
      flex: 0 0 auto;
      min-width: 44px;
      justify-content: center;
    }
    .rule {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .rule-name {
      font-weight: 600;
    }
    .ref {
      font: var(--app-label-small);
      color: var(--app-primary);
      margin-left: 6px;
    }
    .value {
      color: var(--app-on-surface);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class RulesSummaryComponent {
  readonly rules = input.required<RulesView>();
  readonly catalogue = input.required<RuleCatalogue>();

  protected readonly groups = GROUPS;
  protected readonly profile = computed(() =>
    this.catalogue().profiles.find((p) => p.id === this.rules().drawingProfile),
  );
  protected readonly availableCount = computed(
    () => this.catalogue().rules.filter((r) => r.available).length,
  );
  protected readonly onCount = computed(
    () => this.catalogue().rules.filter((r) => this.isOn(r)).length,
  );

  protected rulesOf(group: RuleGroup): RuleDefinition[] {
    return this.catalogue().rules.filter((r) => r.group === group);
  }

  /** Rules waiting for data never run, whatever their switch says. */
  protected isOn(rule: RuleDefinition): boolean {
    return rule.available && this.rules().switches[rule.id];
  }

  protected stateLabel(rule: RuleDefinition): string {
    if (!rule.available) return 'Later';
    return this.isOn(rule) ? 'On' : 'Off';
  }

  protected valueText(id: RuleId): string | null {
    return VALUE_TEXT[id]?.(this.rules().values) ?? null;
  }
}
