import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BASIC_RULES, BasicRuleId, BasicRuleSettings } from '../geometry/basic-rules';

@Component({
  selector: 'app-basic-rules',
  templateUrl: './basic-rules.component.html',
  styleUrl: './basic-rules.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BasicRulesComponent {
  readonly settings = input<BasicRuleSettings>({});
  readonly changed = output<BasicRuleSettings>();
  readonly rules = BASIC_RULES;
  readonly enabledCount = computed(() => this.rules.filter(r => this.enabled(r.id)).length);

  enabled(id: BasicRuleId): boolean { return this.settings()[id] !== false; }

  toggle(id: BasicRuleId, enabled: boolean): void {
    this.changed.emit({ ...this.settings(), [id]: enabled });
  }

  setAll(enabled: boolean): void {
    this.changed.emit(Object.fromEntries(this.rules.map(r => [r.id, enabled])));
  }
}
