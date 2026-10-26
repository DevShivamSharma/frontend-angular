import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PlansApiService } from '../../../planner/data/plans-api.service';
import type { HallPlanStatus } from '../../../planner/domain/plan.models';
import { EventConfigApiService } from '../../data/event-config-api.service';

interface Step {
  id: string;
  label: string;
  hint: string;
  tab: 'halls' | 'config' | 'details';
  done: boolean;
}

/**
 * Where an event stands, as steps: halls added, configuration set (an internal event), plans made,
 * plans published (an external event: planned by the organiser, approved by ITPO, published). The
 * first step not done is the next one, and its button goes to the tab that does it.
 */
@Component({
  selector: 'app-event-progress',
  templateUrl: './event-progress.component.html',
  styleUrl: './event-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventProgressComponent {
  readonly eventId = input.required<string>();
  readonly kind = input.required<'internal' | 'external'>();
  readonly halls = input.required<number>();
  /** The person may do the steps (ITPO staff, for an internal event). */
  readonly canAct = input(false);
  readonly go = input<(tab: string) => void>(() => undefined);

  private readonly plans = inject(PlansApiService);
  private readonly config = inject(EventConfigApiService);

  private readonly statuses = signal<HallPlanStatus[] | null>(null);
  private readonly configured = signal<boolean | null>(null);

  protected readonly steps = computed<Step[]>(() => {
    const list = this.statuses();
    if (list === null) return [];
    const halls = this.halls();
    const every = (test: (s: HallPlanStatus) => boolean) => list.length > 0 && list.every(test);
    if (this.kind() === 'internal') {
      return [
        {
          id: 'halls',
          label: 'Add halls',
          hint: 'Pick the halls the event uses.',
          tab: 'halls',
          done: halls > 0,
        },
        {
          id: 'config',
          label: 'Set the configuration',
          hint: 'Booking dates, limits and options.',
          tab: 'config',
          done: this.configured() === true,
        },
        {
          id: 'plan',
          label: 'Plan the stalls',
          hint: 'Draw or import each hall’s stalls.',
          tab: 'halls',
          done: every((s) => s.status === 'planned' && s.stalls > 0),
        },
        {
          id: 'publish',
          label: 'Publish',
          hint: 'Write the stalls so they can be booked.',
          tab: 'halls',
          done: every((s) => !!s.published && s.published.revision === s.revision),
        },
      ];
    }
    return [
      {
        id: 'halls',
        label: 'Halls booked',
        hint: 'The organiser’s halls.',
        tab: 'halls',
        done: halls > 0,
      },
      {
        id: 'plan',
        label: 'Organiser plans',
        hint: 'The organiser draws and sends each hall.',
        tab: 'halls',
        done: every((s) => s.status === 'pending' || s.status === 'approved'),
      },
      {
        id: 'approve',
        label: 'ITPO approves',
        hint: 'Review and approve each hall’s plan.',
        tab: 'halls',
        done: every((s) => s.status === 'approved'),
      },
      {
        id: 'publish',
        label: 'Published',
        hint: 'The organiser publishes the approved plans.',
        tab: 'halls',
        done: every((s) => !!s.published && s.published.revision === s.revision),
      },
    ];
  });

  /** The first step that is not done, with its place in the list; null when all are. */
  protected readonly next = computed(() => {
    const steps = this.steps();
    const i = steps.findIndex((s) => !s.done);
    return i < 0 ? null : { step: steps[i], index: i };
  });
  protected readonly doneCount = computed(() => this.steps().filter((s) => s.done).length);

  constructor() {
    effect(() => {
      const id = this.eventId();
      this.halls();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.statuses.set(await firstValueFrom(this.plans.planStatuses(id)));
    } catch {
      this.statuses.set(null);
    }
    if (this.kind() === 'internal') {
      try {
        this.configured.set(!!(await firstValueFrom(this.config.get(id)))?.id);
      } catch {
        this.configured.set(null);
      }
    }
  }
}
