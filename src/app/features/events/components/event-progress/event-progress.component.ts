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
  /** Where the step stands, in a few words, under its label. */
  note: string;
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
  imports: [],
  templateUrl: './event-progress.component.html',
  styleUrl: './event-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventProgressComponent {
  readonly eventId = input.required<string>();
  readonly kind = input.required<'internal' | 'external'>();
  readonly halls = input.required<number>();
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
    const count = (test: (s: HallPlanStatus) => boolean) => list.filter(test).length;
    const of = (n: number, word: string) => (list.length ? `${n} of ${list.length} ${word}` : '');
    const isPlanned = (s: HallPlanStatus) => s.status === 'planned' && s.stalls > 0;
    const isPublished = (s: HallPlanStatus) => !!s.published && s.published.revision === s.revision;
    const isSent = (s: HallPlanStatus) => s.status === 'pending' || s.status === 'approved';
    const isApproved = (s: HallPlanStatus) => s.status === 'approved';
    const hallsNote = halls === 1 ? '1 hall' : halls ? `${halls} halls` : 'None yet';
    if (this.kind() === 'internal') {
      const configured = this.configured();
      return [
        {
          id: 'halls',
          label: 'Halls added',
          note: hallsNote,
          tab: 'halls',
          done: halls > 0,
        },
        {
          id: 'config',
          label: 'Booking setup',
          note: configured === true ? 'Saved' : configured === false ? 'Not saved yet' : '',
          tab: 'config',
          done: configured === true,
        },
        {
          id: 'plan',
          label: 'Hall plans',
          note: of(count(isPlanned), 'planned'),
          tab: 'halls',
          done: every(isPlanned),
        },
        {
          id: 'publish',
          label: 'Published',
          note: of(count(isPublished), 'published'),
          tab: 'halls',
          done: every(isPublished),
        },
      ];
    }
    return [
      {
        id: 'halls',
        label: 'Halls booked',
        note: hallsNote,
        tab: 'halls',
        done: halls > 0,
      },
      {
        id: 'plan',
        label: 'Organiser plans',
        note: of(count(isSent), 'sent'),
        tab: 'halls',
        done: every(isSent),
      },
      {
        id: 'approve',
        label: 'ITPO approves',
        note: of(count(isApproved), 'approved'),
        tab: 'halls',
        done: every(isApproved),
      },
      {
        id: 'publish',
        label: 'Published',
        note: of(count(isPublished), 'published'),
        tab: 'halls',
        done: every(isPublished),
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
