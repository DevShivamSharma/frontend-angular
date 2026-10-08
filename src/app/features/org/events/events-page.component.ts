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
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventKind, EventView } from '../../../core/events/events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { formatDays } from './event-dates';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';

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
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header [heading]="copy().heading" [subheading]="copy().sub">
        @if (canManage() && kind()) {
          <button mat-flat-button (click)="create()"><mat-icon>add</mat-icon>New event</button>
        }
      </app-page-header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (!loading() && !events().length) {
        <div class="panel">
          <app-empty-state
            icon="event"
            [heading]="'No ' + copy().heading.toLowerCase() + ' yet'"
            [text]="copy().empty"
          >
            @if (canManage() && kind()) {
              <button mat-flat-button (click)="create()">New event</button>
            }
          </app-empty-state>
        </div>
      }

      <ul class="cards">
        @for (e of events(); track e.id) {
          <li>
            <a class="card panel" [routerLink]="['/', slug(), 'events', e.id]">
              <span class="when" aria-hidden="true">
                <span class="day">{{ e.startsOn.slice(8, 10) }}</span>
                <span class="mon">{{ month(e.startsOn) }}</span>
              </span>
              <span class="body">
                <span class="name">
                  {{ e.name }}
                  <span class="status-chip is-neutral">{{ e.audience }}</span>
                </span>
                @if (e.organiserName) {
                  <span class="muted">{{ e.organiserName }}</span>
                }
                <span class="muted small"
                  >{{ days(e) }} · {{ e.hallCount }} {{ e.hallCount === 1 ? 'hall' : 'halls'
                  }}{{ e.venueEventId ? ' · ' + e.venueEventId : '' }}</span
                >
              </span>
              <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
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
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 16px;
      color: inherit;
      text-decoration: none;
      height: 100%;
      box-sizing: border-box;
      transition: border-color 120ms;
    }
    .card:hover,
    .card:focus-visible {
      border-color: var(--mat-sys-primary);
    }
    .when {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      flex: none;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      line-height: 1.1;
    }
    .day {
      font: var(--mat-sys-title-medium);
      font-variant-numeric: tabular-nums;
    }
    .mon {
      font: var(--mat-sys-label-small);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .name {
      font: var(--mat-sys-title-medium);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .small {
      font: var(--mat-sys-body-small);
      font-variant-numeric: tabular-nums;
    }
    .chevron {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class EventsPageComponent {
  /** From the route; absent on an organiser's own list. */
  readonly kind = input<EventKind>();

  private readonly api = inject(EventsApi);
  private readonly dialog = inject(MatDialog);
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
    this.dialog
      .open(EventDialogComponent, { data })
      .afterClosed()
      .subscribe((event?: EventView) => {
        // Straight on to adding its halls.
        if (event) void this.router.navigate(['/', this.slug(), 'events', event.id]);
      });
  }
}
