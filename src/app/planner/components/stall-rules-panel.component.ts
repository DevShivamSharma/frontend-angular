import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { StallRuleReport } from '../geometry/stall-rule-report';
import { IconComponent } from './icon.component';

/**
 * The selected stall's rules: what it breaks (and why), what it meets, which rules are off for
 * this layout, and the written planner rules that apply to the whole layout.
 */
@Component({
  selector: 'app-stall-rules-panel',
  templateUrl: './stall-rules-panel.component.html',
  styleUrl: './stall-rules-panel.component.css',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StallRulesPanelComponent {
  readonly report = input.required<StallRuleReport>();
  /** Passage width for the layout's event type and the wall clearance, in metres. */
  readonly passageWidth = input.required<number>();
  readonly wallClearance = input.required<number>();
  /** Written planner rules applied to this layout. */
  readonly notes = input<readonly string[]>([]);

  readonly broken = computed(() => this.report().checks.filter(c => c.status === 'broken'));
  readonly met = computed(() => this.report().checks.filter(c => c.status === 'ok'));
  readonly off = computed(() => this.report().checks.filter(c => c.status === 'off'));
  readonly unusedLabels = computed(() =>
    this.report().checks.filter(c => c.status === 'not-used').map(c => c.label).join(', '));
}
