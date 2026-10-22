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
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventKind } from '../../../core/events/events.models';
import type { ItpoEventView } from '../../../core/events/itpo-events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { daysBetween, EventPhase, eventPhase, formatDays, today } from './event-dates';

const COPY: Record<EventKind | 'mine', { heading: string; sub: string; empty: string }> = {
  internal: {
    heading: 'Internal events',
    sub: "ITPO's own events, from the Bharat Mandapam portal. Open one to add halls and plan its stalls.",
    empty: 'Internal events are created in the Bharat Mandapam portal; they appear here.',
  },
  external: {
    heading: 'External events',
    sub: 'Events of organisers who booked ITPO’s halls. They plan their stalls; ITPO reviews them.',
    empty: 'Organisers’ bookings appear here once made on the Bharat Mandapam portal.',
  },
  mine: {
    heading: 'My events',
    sub: 'Your bookings at Bharat Mandapam, with the halls you plan stalls on.',
    empty: 'You have no bookings yet. Book halls on the Bharat Mandapam portal.',
  },
};

/** One kind of event (from the route), or for an organiser, their own events. */
@Component({
  selector: 'app-events-page',
  imports: [
    FormsModule,
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
        <span class="search">
          <app-icon name="search" />
          <input
            type="search"
            [ngModel]="query()"
            (ngModelChange)="search($event)"
            placeholder="Event, booking number or organiser"
            aria-label="Search events"
          />
        </span>
      </app-page-header>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (!loading() && !events().length) {
        <div class="panel">
          <app-empty-state
            icon="event"
            [heading]="query() ? 'No events match' : 'No ' + copy().heading.toLowerCase() + ' yet'"
            [text]="copy().empty"
          />
        </div>
      }

      <ul class="cards">
        @for (e of events(); track e.id) {
          @let phase = phaseOf(e);
          <li>
            <button
              type="button"
              class="event-card"
              [class]="'phase-' + phase + ' status-' + status(e)"
              (click)="open(e)"
              [disabled]="opening() === e.id"
            >
              <span class="top">
                <span class="when" aria-hidden="true">
                  @if (e.startsOn) {
                    <span class="mon">{{ month(e.startsOn) }}</span>
                    <span class="day">{{ e.startsOn.slice(8, 10) }}</span>
                  } @else {
                    <span class="day">–</span>
                  }
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
                @if (e.startsOn && e.endsOn) {
                  <span><app-icon name="event" />{{ days(e) }}</span>
                }
                <span
                  ><app-icon name="meeting_room" />{{ e.halls }}
                  {{ e.halls === 1 ? 'hall' : 'halls' }}</span
                >
                @if (e.code) {
                  <span class="id" [title]="'ITPO booking ' + e.code"
                    ><app-icon name="confirmation_number" />{{ e.code }}</span
                  >
                }
              </span>
              <span class="foot">
                <span>{{
                  opening() === e.id
                    ? 'Opening…'
                    : e.halls
                      ? 'Open halls and stall plans'
                      : e.kind === 'internal' && canManage()
                        ? 'Add halls'
                        : 'No halls yet'
                }}</span>
                <app-icon name="arrow_forward" />
              </span>
            </button>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
      background: var(--app-surface-container-lowest);
    }
    .search input {
      width: min(320px, 60vw);
      height: 36px;
      border: 0;
      outline: 0;
      background: none;
      color: var(--app-on-surface);
      font: var(--app-body-medium);
    }
    button.event-card {
      width: 100%;
      border: 0;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
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
    .event-card.status-cancelled,
    .event-card.status-completed {
      --accent: var(--app-outline);
      opacity: 0.75;
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
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly events = signal<ItpoEventView[]>([]);
  protected readonly loading = signal(false);
  protected readonly query = signal('');
  protected readonly opening = signal<string | null>(null);
  protected readonly canManage = computed(() => this.context.can('events.manage'));
  protected readonly copy = computed(() => COPY[this.kind() ?? 'mine']);
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const kind = this.kind();
      untracked(() => void this.load(kind));
    });
  }

  /** ITPO's events of the kind; an organiser's own list is their external events. */
  private async load(kind: EventKind | undefined): Promise<void> {
    this.loading.set(true);
    try {
      this.events.set(
        await firstValueFrom(this.api.itpoEvents(this.slug(), kind ?? 'external', this.query())),
      );
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected search(q: string): void {
    this.query.set(q);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(this.kind()), 300);
  }

  /** Brings the ITPO event here, then opens it. */
  protected async open(e: ItpoEventView): Promise<void> {
    this.opening.set(e.id);
    try {
      const { eventId } = await firstValueFrom(this.api.openItpoEvent(this.slug(), e.id));
      await this.router.navigate(['/', this.slug(), 'events', eventId]);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.opening.set(null);
    }
  }

  private readonly today = today();

  protected phaseOf(e: ItpoEventView): EventPhase {
    return e.startsOn && e.endsOn
      ? eventPhase(
          { startsOn: e.startsOn, endsOn: e.endsOn, buildUpOn: null, dismantleOn: null },
          this.today,
        )
      : 'upcoming';
  }

  /** ITPO's own state of the event, for the card's colour. */
  protected status(e: ItpoEventView): string {
    return e.approvalStatus === 'Approved' ? 'scheduled' : 'draft';
  }

  protected phaseLabel(e: ItpoEventView, phase: EventPhase): string {
    if (e.approvalStatus && e.approvalStatus !== 'Approved') return e.approvalStatus;
    if (!e.startsOn) return 'No dates';
    if (phase !== 'upcoming') {
      return { 'build-up': 'Build-up', live: 'Live', dismantling: 'Dismantling', ended: 'Ended' }[
        phase
      ];
    }
    const n = daysBetween(this.today, e.startsOn);
    return n === 1 ? 'Tomorrow' : n <= 60 ? `In ${n} days` : 'Upcoming';
  }

  protected days(e: ItpoEventView): string {
    return formatDays(e.startsOn!, e.endsOn!);
  }

  protected month(d: string): string {
    return new Date(`${d}T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  }
}
