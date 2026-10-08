import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EVENT_STATUS_LABELS, eventScoped } from '../../../core/events/event-rules';
import { EventsApi } from '../../../core/events/events-api.service';
import {
  EVENT_KINDS,
  EVENT_STATUSES,
  EventStatus,
  EventView,
} from '../../../core/events/events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';

/** The organisation's events, latest first. Event-scoped members see only their own. */
@Component({
  selector: 'app-events-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Events"
        subheading="Your organisation's events, with their dates, venue and halls."
      >
        @if (canCreate()) {
          <button mat-flat-button (click)="create()"><mat-icon>add</mat-icon>New event</button>
        }
      </app-page-header>

      <section class="panel panel-flush" aria-label="Events">
        <div class="toolbar">
          <mat-button-toggle-group
            [value]="status()"
            (change)="setStatus($event.value)"
            aria-label="Filter by status"
            hideSingleSelectionIndicator
          >
            <mat-button-toggle value="">All</mat-button-toggle>
            @for (s of statuses; track s) {
              <mat-button-toggle [value]="s">{{ statusLabels[s] }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <span class="count muted" aria-live="polite"
            >{{ events().length }} {{ events().length === 1 ? 'event' : 'events' }}</span
          >
        </div>

        <div class="progress">
          @if (loading()) {
            <mat-progress-bar mode="indeterminate" />
          }
        </div>

        @if (events().length) {
          <div class="table-wrap">
            <table mat-table [dataSource]="events()">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Event</th>
                <td mat-cell *matCellDef="let e">
                  <span class="event">
                    <a class="event-name" [routerLink]="[e.id]">{{ e.name }}</a>
                    @if (e.code) {
                      <code class="muted">{{ e.code }}</code>
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let e">
                  <span
                    class="status-chip"
                    [class.is-positive]="e.status === 'scheduled'"
                    [class.is-neutral]="e.status === 'draft'"
                    [class.is-warning]="e.status === 'cancelled'"
                    >{{ statusLabel(e.status) }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="kind">
                <th mat-header-cell *matHeaderCellDef>Kind</th>
                <td mat-cell *matCellDef="let e">
                  <span class="kind">
                    {{ kindLabel(e) }}
                    <span class="outline-chip">{{ e.eventType }}</span>
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="dates">
                <th mat-header-cell *matHeaderCellDef>Dates</th>
                <td mat-cell *matCellDef="let e" class="dates">
                  {{ e.startsOn | date: 'd MMM y' }}
                  @if (e.endsOn !== e.startsOn) {
                    - {{ e.endsOn | date: 'd MMM y' }}
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="venue">
                <th mat-header-cell *matHeaderCellDef>Venue</th>
                <td mat-cell *matCellDef="let e">{{ e.venue.name }}</td>
              </ng-container>
              <ng-container matColumnDef="halls">
                <th mat-header-cell *matHeaderCellDef>Halls</th>
                <td mat-cell *matCellDef="let e">{{ e.hallCount }}</td>
              </ng-container>
              <ng-container matColumnDef="open">
                <th mat-header-cell *matHeaderCellDef>
                  <span class="cdk-visually-hidden">Open</span>
                </th>
                <td mat-cell *matCellDef="let e" class="chevron-cell">
                  <mat-icon aria-hidden="true">chevron_right</mat-icon>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                *matRowDef="let row; columns: columns"
                class="clickable"
                (click)="open(row, $event)"
              ></tr>
            </table>
          </div>
        } @else if (failed()) {
          <app-empty-state
            icon="cloud_off"
            heading="The events could not be loaded"
            text="Check your connection, then try again."
          >
            <button mat-stroked-button (click)="load()">Try again</button>
          </app-empty-state>
        } @else if (loaded()) {
          @if (status(); as s) {
            <app-empty-state
              icon="filter_alt_off"
              [heading]="'No ' + statusLabels[s].toLowerCase() + ' events'"
              text="Clear the filter to see events with any status."
            >
              <button mat-stroked-button (click)="setStatus('')">Show all events</button>
            </app-empty-state>
          } @else {
            <app-empty-state
              icon="event"
              heading="No events yet"
              [text]="
                canCreate()
                  ? 'Create the first event, then add halls from its venue.'
                  : 'Events you are assigned to will appear here.'
              "
            >
              @if (canCreate()) {
                <button mat-flat-button (click)="create()">New event</button>
              }
            </app-empty-state>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 18px 22px;
      border-bottom: 1px solid var(--card-border);
    }
    .count {
      margin-left: auto;
      font: var(--mat-sys-label-large);
    }
    .progress {
      height: 4px;
    }
    .event {
      display: grid;
      gap: 2px;
      padding: 6px 0;
    }
    .event-name {
      font-family: var(--app-display-font);
      font-size: 1.0625rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--mat-sys-on-surface);
      text-decoration: none;
    }
    .event-name:hover {
      text-decoration: underline;
    }
    .event-name:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
      border-radius: 4px;
    }
    code {
      font-size: 12px;
    }
    .kind {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .outline-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-label-medium);
      white-space: nowrap;
    }
    .dates {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .chevron-cell {
      width: 40px;
      color: var(--mat-sys-on-surface-variant);
    }
    .chevron-cell mat-icon {
      transition:
        transform 200ms ease-out,
        color 200ms ease-out;
    }
    .clickable {
      cursor: pointer;
      transition: background-color 150ms ease-out;
    }
    /* A row that opens its event: a wash of the organisation's colour, the chevron leans in. */
    .clickable:hover {
      background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent);
    }
    .clickable:hover .chevron-cell mat-icon {
      transform: translateX(3px);
      color: var(--mat-sys-primary);
    }
    @media (prefers-reduced-motion: reduce) {
      .clickable,
      .chevron-cell mat-icon {
        transition: none;
      }
      .clickable:hover .chevron-cell mat-icon {
        transform: none;
      }
    }
    .mat-mdc-cell:first-child,
    .mat-mdc-header-cell:first-child {
      padding-left: 20px;
    }
    @media (max-width: 700px) {
      .count {
        margin-left: 0;
        width: 100%;
      }
    }
  `,
})
export class EventsPageComponent {
  private readonly api = inject(EventsApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly columns = ['name', 'status', 'kind', 'dates', 'venue', 'halls', 'open'];
  protected readonly statuses = EVENT_STATUSES;
  protected readonly statusLabels = EVENT_STATUS_LABELS;
  protected readonly status = signal<EventStatus | ''>('');
  protected readonly events = signal<EventView[]>([]);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);

  /** Creating events is for members of the whole organisation; the server refuses others. */
  protected readonly canCreate = computed(() => {
    const ctx = this.context.context();
    return this.context.can('events.manage') && !!ctx && !eventScoped(ctx.membership);
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const status = this.status();
      this.events.set(
        await firstValueFrom(this.api.events(this.context.slug(), status ? { status } : {})),
      );
      this.loaded.set(true);
    } catch {
      // The error interceptor has shown it.
      this.events.set([]);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected setStatus(status: EventStatus | ''): void {
    this.status.set(status);
    void this.load();
  }

  protected statusLabel(status: EventStatus): string {
    return EVENT_STATUS_LABELS[status];
  }

  protected kindLabel(event: EventView): string {
    return EVENT_KINDS.find((k) => k.value === event.kind)?.label ?? event.kind;
  }

  /** Mouse users can click anywhere on a row; keyboard users follow the name link. */
  protected open(event: EventView, click: MouseEvent): void {
    if ((click.target as HTMLElement).closest('a, button')) {
      return;
    }
    void this.router.navigate(['/', this.context.slug(), 'events', event.id]);
  }

  protected create(): void {
    const data: EventDialogData = { slug: this.context.slug(), canChangeVenue: true };
    this.dialog
      .open(EventDialogComponent, { data, maxWidth: '95vw' })
      .afterClosed()
      .subscribe((event?: EventView) => {
        if (event) {
          this.notifier.success(`${event.name} created.`);
          void this.router.navigate(['/', this.context.slug(), 'events', event.id]);
        }
      });
  }
}
