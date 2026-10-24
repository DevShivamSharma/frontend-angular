import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { forkJoin } from 'rxjs';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { RulesApiService } from '../../../rules/data/rules-api.service';
import { EventRules, RuleDefinition } from '../../../rules/data/rules.models';
import {
  RuleSwitchListComponent,
  RuleToggle,
} from '../../../rules/components/rule-switch-list/rule-switch-list.component';
import { itemsOfEvent } from '../../../rules/domain/rule-items';

/** The planning rules of one event: the default unless the event changed a rule. */
@Component({
  selector: 'app-event-rules-tab',
  imports: [ButtonModule, EmptyStateComponent, RuleSwitchListComponent],
  templateUrl: './event-rules-tab.component.html',
  styleUrl: './event-rules-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRulesTabComponent {
  readonly eventId = input.required<string>();
  /** The event is for reading: the switches show what applies but cannot be changed. */
  readonly readonly = input(false);
  /** ITPO's own event: every rule is off, and none can be switched on. */
  readonly internal = input(false);

  private readonly api = inject(RulesApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly definitions = signal<readonly RuleDefinition[]>([]);
  private readonly rules = signal<EventRules | null>(null);
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

  private loaded = false;

  /** Reads the rules the first time the tab is shown. */
  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    forkJoin({ catalogue: this.api.catalogue(), rules: this.api.forEvent(this.eventId()) })
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
      message: `${enabled ? 'Switch on' : 'Switch off'} "${item?.label ?? id}" for this event?`,
      acceptLabel: enabled ? 'Switch on' : 'Switch off',
    });
    if (!go) {
      // The switch moved when it was clicked; draw it as it is.
      this.revision.update((n) => n + 1);
      return;
    }
    // Switching a rule back to the default is "use default", not an override that happens to match.
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
      message: `Put the ${this.changedCount()} changed rules of this event back to the default?`,
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
    this.api.setForEvent(this.eventId(), switches).subscribe({
      next: (rules) => {
        this.rules.set(rules);
        this.busy.set(false);
      },
      error: (error) => {
        this.busy.set(false);
        this.notify.fromError(error);
      },
    });
  }
}
