import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { forkJoin } from 'rxjs';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { RulesApiService } from '../../data/rules-api.service';
import { HallRules, RuleDefinition } from '../../data/rules.models';
import { itemsOfEvent } from '../../domain/rule-items';
import {
  RuleSwitchListComponent,
  RuleToggle,
} from '../rule-switch-list/rule-switch-list.component';

/**
 * The planning rules of one hall: the default rules, unless ITPO switched a rule for this hall. An
 * event can still switch a rule for itself on top of this.
 */
@Component({
  selector: 'app-hall-rules-panel',
  imports: [ButtonModule, EmptyStateComponent, RuleSwitchListComponent],
  templateUrl: './hall-rules-panel.component.html',
  styleUrl: './hall-rules-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallRulesPanelComponent {
  readonly hallId = input.required<number>();
  readonly hallName = input('this hall');

  private readonly api = inject(RulesApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly definitions = signal<readonly RuleDefinition[]>([]);
  private readonly rules = signal<HallRules | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly busy = signal(false);
  /** Bumped to draw the switches again, as they are, after a change was declined. */
  protected readonly revision = signal(0);
  protected readonly items = computed(() =>
    itemsOfEvent(this.definitions(), this.rules()?.rules ?? []),
  );
  protected readonly changedCount = computed(
    () => this.items().filter((item) => item.overridden).length,
  );

  constructor() {
    effect(() => {
      this.hallId();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({ catalogue: this.api.catalogue(), rules: this.api.forHall(this.hallId()) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ catalogue, rules }) => {
          this.definitions.set(catalogue.rules);
          this.rules.set(rules);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected async toggle({ id, enabled }: RuleToggle): Promise<void> {
    const item = this.items().find((rule) => rule.id === id);
    const go = await this.confirm.ask({
      header: 'Change the rule',
      message: `${enabled ? 'Switch on' : 'Switch off'} "${item?.label ?? id}" for ${this.hallName()}?`,
      acceptLabel: enabled ? 'Switch on' : 'Switch off',
    });
    if (!go) {
      this.revision.update((n) => n + 1);
      return;
    }
    // Back to the default is "use default", not an override that happens to match.
    this.send({ [id]: item && enabled === item.defaultEnabled ? null : enabled });
  }

  protected async useDefault(id: string): Promise<void> {
    const item = this.items().find((rule) => rule.id === id);
    const go = await this.confirm.ask({
      header: 'Use the default',
      message: `Let "${item?.label ?? id}" follow the default rules again?`,
      acceptLabel: 'Use default',
    });
    if (go) this.send({ [id]: null });
  }

  protected async useAllDefaults(): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Use all defaults',
      message: `Put the ${this.changedCount()} changed rules of ${this.hallName()} back to the default?`,
      acceptLabel: 'Use defaults',
    });
    if (!go) return;
    this.send(
      Object.fromEntries(
        this.items()
          .filter((item) => item.overridden)
          .map((item) => [item.id, null]),
      ),
    );
  }

  private send(switches: Record<string, boolean | null>): void {
    this.busy.set(true);
    this.api.setForHall(this.hallId(), switches).subscribe({
      next: (rules) => {
        this.rules.set(rules);
        this.busy.set(false);
      },
      error: (error) => {
        this.busy.set(false);
        this.revision.update((n) => n + 1);
        this.notify.fromError(error);
      },
    });
  }
}
