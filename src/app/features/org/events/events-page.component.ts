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
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventKind, EventView } from '../../../core/events/events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { daysBetween, EventPhase, eventPhase, formatDays, today } from './event-dates';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';
import { AppDialog } from '../../../core/ui/app-dialog.service';

const COPY: Record<EventKind | 'mine', { heading: string; sub: string; empty: string }> = {
  internal: {
    heading: 'Internal events',
    sub: 'Events your organisation runs itself, drawn by your own team.',
    empty: 'Create an event, then add the halls it uses and the rules for each hall.',
  },
  external: {
    heading: 'External events',
    sub: 'Events of organisers who booked your halls. They draw their stalls on those halls only.',
    empty: 'Create an event for an organiser’s booking, add its halls, then invite the organiser.',
  },
  mine: {
    heading: 'My events',
    sub: 'The events you were invited to, with the halls you plan stalls on.',
    empty: 'You have no events yet. The venue adds you when your halls are ready.',
  },
};

/** One kind of event (from the route), or for an organiser, their own events. */
@Component({
  selector: 'app-events-page',
  imports: [
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header [heading]="copy().heading" [subheading]="copy().sub">
        @if (canManage() && kind()) {
          <button pButton (click)="create()"><app-icon name="add" />New event</button>
        }
      </app-page-header>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (!loading() && !events().length) {
        <div class="panel">
          <app-empty-state
            icon="event"
            [heading]="'No ' + copy().heading.toLowerCase() + ' yet'"
            [text]="copy().empty"
          >
            @if (canManage() && kind()) {
              <button pButton (click)="create()">New event</button>
            }
          </app-empty-state>
        </div>
      }

      <ul class="cards">
        @for (e of events(); track e.id) {
          @let phase = phaseOf(e);
          <li>
            <a
              class="event-card"
              [class]="'phase-' + phase"
              [routerLink]="['/', slug(), 'events', e.id]"
            >
              <span class="top">
                <span class="when" aria-hidden="true">
                  <span class="mon">{{ month(e.startsOn) }}</span>
                  <span class="day">{{ e.startsOn.slice(8, 10) }}</span>
                </span>
                <span class="titles">
                  <span class="name">{{ e.name }}</span>
                  <span class="muted sub">
                    {{
                      e.organiserName ??
                        (e.kind === 'internal' ? 'Internal event' : 'External event')
                    }}
                  </span>
                </span>
                <span class="phase">
                  <span class="dot" aria-hidden="true"></span>{{ phaseLabel(e, phase) }}
                </span>
              </span>
              <span class="meta">
                <span><app-icon name="event" />{{ days(e) }}</span>
                <span
                  ><app-icon name="meeting_room" />{{ e.hallCount }}
                  {{ e.hallCount === 1 ? 'hall' : 'halls' }}</span
                >
                <span class="tag">{{ e.audience }}</span>
                @if (e.venueEventId) {
                  <span class="id" [title]="'Venue system id ' + e.venueEventId"
                    ><app-icon name="confirmation_number" />{{ e.venueEventId }}</span
                  >
                }
              </span>
              <span class="foot">
                <span>{{
                  e.hallCount
                    ? 'Open halls and stall plans'
                    : canManage()
                      ? 'Add halls'
                      : 'No halls yet'
                }}</span>
                <app-icon name="arrow_forward" />
              </span>
            </a>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
      gap: 16px;
    }
    .event-card {
      --accent: var(--app-outline);
      --accent-soft: var(--app-surface-container);
      --accent-tint: color-mix(in srgb, var(--accent) 14%, var(--app-surface-container-lowest));
      position: relative;
      display: grid;
      gap: 14px;
      height: 100%;
      box-sizing: border-box;
      padding: 18px 18px 14px;
      overflow: hidden;
      border: 1px solid var(--app-outline-variant);
      border-radius: 16px;
      background: var(--app-surface-container-lowest);
      box-shadow: var(--app-level1);
      color: inherit;
      text-decoration: none;
      transition:
        border-color 150ms ease,
        box-shadow 150ms ease,
        transform 150ms ease;
    }
    .event-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      height: 4px;
      background: var(--accent);
    }
    .event-card:hover,
    .event-card:focus-visible {
      border-color: var(--accent);
      box-shadow: var(--app-level2);
      transform: translateY(-1px);
    }
    .phase-upcoming {
      --accent: var(--app-primary);
      --accent-soft: var(--accent-tint);
    }
    .phase-build-up,
    .phase-dismantling {
      --accent: #d97706;
      --accent-soft: #fef3c7;
    }
    .phase-live {
      --accent: #16a34a;
      --accent-soft: #dcfce7;
    }
    .top {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      min-width: 0;
    }
    .when {
      display: grid;
      place-items: center;
      align-content: center;
      width: 52px;
      height: 56px;
      flex: none;
      border-radius: 12px;
      background: var(--accent-soft);
      color: var(--app-on-surface);
      line-height: 1.05;
    }
    .mon {
      font: var(--app-label-small);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      font-weight: 700;
    }
    .day {
      font: var(--app-title-large);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .titles {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .name {
      font: var(--app-title-medium);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub {
      font: var(--app-body-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .phase {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--app-on-surface);
      font: var(--app-label-medium);
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
    }
    .phase-live .dot {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--app-outline-variant);
      color: var(--app-on-surface-variant);
      font: var(--app-body-small);
      font-variant-numeric: tabular-nums;
    }
    .meta > span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .meta app-icon {
      font-size: 0.85rem;
    }
    .tag {
      padding: 1px 8px;
      border-radius: 6px;
      background: var(--app-surface-container);
      color: var(--app-on-surface);
      font: var(--app-label-small);
    }
    .id {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--app-primary);
      font: var(--app-label-large);
    }
    .foot app-icon {
      transition: transform 150ms ease;
    }
    .event-card:hover .foot app-icon {
      transform: translateX(3px);
    }
  `,
})
export class EventsPageComponent {
  /** From the route; absent on an organiser's own list. */
  readonly kind = input<EventKind>();

  private readonly api = inject(EventsApi);
  private readonly dialog = inject(AppDialog);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly events = signal<EventView[]>([]);
  protected readonly loading = signal(false);
  protected readonly canManage = computed(() => this.context.can('events.manage'));
  protected readonly copy = computed(() => COPY[this.kind() ?? 'mine']);

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const kind = this.kind();
      untracked(() => void this.load(kind));
    });
  }

  private async load(kind: EventKind | undefined): Promise<void> {
    this.loading.set(true);
    try {
      this.events.set(await firstValueFrom(this.api.events(this.slug(), kind)));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  private readonly today = today();

  protected phaseOf(e: EventView): EventPhase {
    return eventPhase(e, this.today);
  }

  protected phaseLabel(e: EventView, phase: EventPhase): string {
    if (phase !== 'upcoming') {
      return { 'build-up': 'Build-up', live: 'Live', dismantling: 'Dismantling', ended: 'Ended' }[
        phase
      ];
    }
    const n = daysBetween(this.today, e.startsOn);
    return n === 1 ? 'Tomorrow' : n <= 60 ? `In ${n} days` : 'Upcoming';
  }

  protected days(e: EventView): string {
    return formatDays(e.startsOn, e.endsOn);
  }

  protected month(d: string): string {
    return new Date(`${d}T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  }

  protected create(): void {
    const kind = this.kind();
    if (!kind) return;
    const data: EventDialogData = { slug: this.slug(), kind };
    this.dialog.open<EventView>(EventDialogComponent, { data }).subscribe((event?: EventView) => {
      // Straight on to adding its halls.
      if (event) void this.router.navigate(['/', this.slug(), 'events', event.id]);
    });
  }
}
