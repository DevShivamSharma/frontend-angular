import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { groupItems, RuleItem } from '../../domain/rule-items';

export interface RuleToggle {
  id: string;
  enabled: boolean;
}

/**
 * The rules as switches under their group headings. It only shows what it is given and says what
 * the user did; the page decides what that means (the rule set, or one event).
 */
@Component({
  selector: 'app-rule-switch-list',
  imports: [FormsModule, ToggleSwitchModule, TagModule, ButtonModule],
  templateUrl: './rule-switch-list.component.html',
  styleUrl: './rule-switch-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleSwitchListComponent {
  readonly items = input.required<readonly RuleItem[]>();
  /** In an event's list: mark what the event changed and offer to put it back. */
  readonly eventMode = input(false);
  readonly busy = input(false);
  /** Changes when the switches must be drawn again from `items` (a change the user declined). */
  readonly revision = input(0);

  readonly toggled = output<RuleToggle>();
  /** The user asked for a rule to follow the default again. */
  readonly reset = output<string>();

  protected readonly groups = computed(() => groupItems(this.items()));

  protected onToggle(item: RuleItem, enabled: boolean): void {
    this.toggled.emit({ id: item.id, enabled });
  }
}
