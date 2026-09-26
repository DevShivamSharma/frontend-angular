import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { extractErrorMessage } from '../../core/http-error.util';
import { LayoutAssistantService } from '../layout-assistant.service';
import { PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

/**
 * Starters, so the first use is not a blank page. The chip shows a short label; clicking it puts
 * the full requirement in the box, where it can be edited before it is sent.
 */
const EXAMPLES: ReadonlyArray<{ label: string; text: string }> = [
  { label: 'Fill free space 5 × 5', text: 'Fill the free space with 5 × 5 m stalls, 1 m apart.' },
  { label: 'Two rows, 4 m aisle', text: 'Two rows of 3 × 3 m stalls with a 4 m aisle between them.' },
  { label: 'Food court by the entry', text: 'Eight 6 × 4 m food stalls near the entry, all opening onto the passage.' }
];

/**
 * "Assist": a layout described in words.
 *
 * The requirement goes to the backend, which asks the model for a plan. The plan comes back as
 * positions, which `PlannerStore.reviewPlan` checks against this hall's placement rules - so
 * what is shown is already known to fit, and nothing is created until Apply.
 */
@Component({
  selector: 'app-assist-panel',
  templateUrl: './assist-panel.component.html',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AssistPanelComponent {
  private readonly store = inject(PlannerStore);
  private readonly assistant = inject(LayoutAssistantService);

  readonly examples = EXAMPLES;
  readonly requirement = new FormControl('', { nonNullable: true });

  readonly busy = signal(false);
  readonly failed = signal('');
  readonly summary = signal('');
  readonly notes = signal<string[]>([]);

  readonly proposals = this.store.proposals;

  readonly fits = computed(() => this.proposals()?.filter(p => p.valid).length ?? 0);
  readonly rejected = computed(() => this.proposals()?.filter(p => !p.valid).length ?? 0);

  readonly area = computed(() =>
    Math.round(
      (this.proposals() ?? [])
        .filter(p => p.valid)
        .reduce((total, p) => total + p.footprint.width * p.footprint.length, 0)
    )
  );

  /** The reasons the rejected stalls were rejected, each listed once. */
  readonly reasons = computed(() => {
    const seen = new Set<string>();
    for (const proposal of this.proposals() ?? []) {
      if (proposal.valid) continue;
      for (const violation of proposal.violations) seen.add(violation.message);
    }
    return [...seen].slice(0, 3);
  });

  useExample(text: string): void {
    this.requirement.setValue(text);
  }

  async generate(): Promise<void> {
    const requirement = this.requirement.value.trim();
    const hall = this.store.currentHall();
    if (!requirement || !hall || this.busy()) return;

    this.busy.set(true);
    this.failed.set('');
    this.store.clearPlan();

    try {
      const plan = await this.assistant.plan(
        requirement,
        hall,
        this.store.currentStalls(),
        this.store.grid()?.cellSize ?? 1
      );
      this.summary.set(plan.summary ?? '');
      this.notes.set(plan.notes ?? []);
      this.store.reviewPlan(plan.stalls ?? []);
    } catch (error: unknown) {
      this.summary.set('');
      this.notes.set([]);
      // status 0 is "never reached the server", which here almost always means the endpoint
      // does not exist yet rather than that something went wrong with the request.
      this.failed.set(
        error instanceof HttpErrorResponse && error.status === 0
          ? 'The layout assistant is not reachable. It needs POST /api/layout/assist on the backend.'
          : extractErrorMessage(error)
      );
    } finally {
      this.busy.set(false);
    }
  }

  apply(): void {
    this.store.applyPlan();
    this.summary.set('');
    this.notes.set([]);
  }

  discard(): void {
    this.store.clearPlan();
    this.summary.set('');
    this.notes.set([]);
  }
}
