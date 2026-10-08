import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  canMove,
  completeBlockedReason,
  EVENT_STATUS_LABELS,
  eventScoped,
  isOpen,
} from '../../../core/events/event-rules';
import { EventsApi } from '../../../core/events/events-api.service';
import {
  EVENT_KINDS,
  EventDetailView,
  EventHallView,
  EventPlanSummaryView,
  EventStatus,
  EventView,
  ExhibitorView,
  HallOptionView,
} from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import type { StallPlanStatus } from '../../../core/stall-plans/stall-plans.models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import {
  ExhibitorDialogComponent,
  ExhibitorDialogData,
} from '../exhibitors/exhibitor-dialog.component';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';

const PLAN_STATUS_LABELS: Record<StallPlanStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
};

/**
 * One event: its status and the moves it can make, the halls it books, their stall plans and
 * the exhibitors registered for it. What a member sees and may change follows their permissions;
 * booking halls and deleting are for members of the whole organisation.
 */
@Component({
  selector: 'app-event-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a mat-button class="back" [routerLink]="['..']"><mat-icon>arrow_back</mat-icon>Events</a>
      @if (event(); as e) {
        <app-page-header [heading]="e.name" [subheading]="kindLabel(e)">
          <div meta class="meta">
            <span
              class="status-chip"
              [class.is-positive]="e.status === 'scheduled'"
              [class.is-neutral]="e.status === 'draft'"
              [class.is-warning]="e.status === 'cancelled'"
              >{{ statusLabels[e.status] }}</span
            >
            <span class="outline-chip">{{ e.eventType }}</span>
            @if (e.code) {
              <span class="outline-chip">{{ e.code }}</span>
            }
          </div>
          @if (canBook()) {
            <a mat-stroked-button [routerLink]="['bookings']"
              ><mat-icon>confirmation_number</mat-icon>Bookings</a
            >
          }
          @if (canManage()) {
            @if (open()) {
              <button mat-stroked-button (click)="edit(e)"><mat-icon>edit</mat-icon>Edit</button>
            }
            @if (can(e, 'draft')) {
              <button mat-stroked-button [disabled]="busy()" (click)="changeStatus(e, 'draft')">
                <mat-icon>undo</mat-icon>Back to draft
              </button>
            }
            @if (can(e, 'scheduled')) {
              <button mat-flat-button [disabled]="busy()" (click)="changeStatus(e, 'scheduled')">
                <mat-icon>event_available</mat-icon>Schedule
              </button>
            }
            @if (can(e, 'completed')) {
              <span [matTooltip]="completeBlocked() ?? ''">
                <button
                  mat-flat-button
                  [disabled]="busy() || !!completeBlocked()"
                  (click)="complete(e)"
                >
                  <mat-icon>task_alt</mat-icon>Complete
                </button>
              </span>
            }
            @if (can(e, 'cancelled')) {
              <button mat-button class="danger" [disabled]="busy()" (click)="cancel(e)">
                <mat-icon>event_busy</mat-icon>Cancel event
              </button>
            }
            @if (canDelete()) {
              <button mat-button class="danger" [disabled]="busy()" (click)="remove(e)">
                <mat-icon>delete</mat-icon>Delete
              </button>
            }
          }
        </app-page-header>

        <dl class="facts panel">
          <div>
            <dt>Dates</dt>
            <dd>
              {{ e.startsOn | date: 'EEE d MMM y' }}
              @if (e.endsOn !== e.startsOn) {
                – {{ e.endsOn | date: 'EEE d MMM y' }}
              }
            </dd>
          </div>
          <div>
            <dt>Venue</dt>
            <dd>
              @if (context.can('venues.view')) {
                <a [routerLink]="['/', slug(), 'venues', e.venue.id]">{{ e.venue.name }}</a>
              } @else {
                {{ e.venue.name }}
              }
            </dd>
          </div>
          <div>
            <dt>Organiser</dt>
            <dd>
              @if (e.organiser.name || e.organiser.email || e.organiser.phone) {
                {{ e.organiser.name ?? '' }}
                @if (e.organiser.email) {
                  <br /><a [href]="'mailto:' + e.organiser.email">{{ e.organiser.email }}</a>
                }
                @if (e.organiser.phone) {
                  <br /><span class="muted">{{ e.organiser.phone }}</span>
                }
              } @else {
                <span class="muted">Not given</span>
              }
            </dd>
          </div>
          @if (e.description) {
            <div class="wide">
              <dt>Description</dt>
              <dd class="description">{{ e.description }}</dd>
            </div>
          }
          @if (e.status === 'cancelled') {
            <div class="wide">
              <dt>Why it was cancelled</dt>
              <dd>{{ e.cancelledReason ?? 'No reason given.' }}</dd>
            </div>
          }
        </dl>
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (failed()) {
        <div class="panel">
          <app-empty-state
            icon="cloud_off"
            heading="The event could not be loaded"
            text="It may have been deleted, or the connection dropped."
          >
            <button mat-stroked-button (click)="load()">Try again</button>
          </app-empty-state>
        </div>
      }

      @if (event(); as e) {
        <section aria-labelledby="halls-title">
          <div class="row section-bar">
            <h2 class="section-title" id="halls-title">Halls ({{ e.halls.length }})</h2>
            <span class="spacer"></span>
            @if (canManageHalls()) {
              <button mat-stroked-button [matMenuTriggerFor]="hallMenu">
                <mat-icon>add</mat-icon>Add hall
              </button>
            }
          </div>
          @if (e.halls.length) {
            <ul class="halls">
              @for (hall of e.halls; track hall.hallId) {
                <li class="hall panel">
                  <span class="body">
                    <span class="name">
                      @if (context.can('venues.view')) {
                        <a
                          [routerLink]="['/', slug(), 'venues', e.venue.id, 'halls', hall.hallId]"
                          >{{ hall.name }}</a
                        >
                      } @else {
                        {{ hall.name }}
                      }
                      @if (hall.code) {
                        <span class="status-chip is-neutral">{{ hall.code }}</span>
                      }
                    </span>
                    <span class="muted figures">
                      {{ hall.width | number: '1.0-2' }} × {{ hall.depth | number: '1.0-2' }} m ·
                      {{ hall.floorArea | number: '1.0-0' }} m² open
                      @if (hall.level) {
                        · {{ hall.level }}
                      }
                    </span>
                    <span class="muted small">Floor version {{ hall.floorVersion }}</span>
                    @if (hall.currentVersion > hall.floorVersion) {
                      <span class="floor-note small">
                        <mat-icon aria-hidden="true">info</mat-icon>
                        The hall's floor is now version {{ hall.currentVersion }}; this event's
                        stalls stay on version {{ hall.floorVersion }}.
                      </span>
                    }
                  </span>
                  @if (canManageHalls()) {
                    <button
                      mat-icon-button
                      [disabled]="busy()"
                      (click)="removeHall(e, hall)"
                      [attr.aria-label]="'Remove ' + hall.name"
                      matTooltip="Remove the hall from the event"
                    >
                      <mat-icon>remove_circle_outline</mat-icon>
                    </button>
                  }
                </li>
              }
            </ul>
          } @else {
            <div class="panel">
              <app-empty-state
                icon="grid_on"
                heading="No halls booked"
                [text]="
                  canManageHalls()
                    ? 'Book halls of ' + e.venue.name + ' for the event’s days.'
                    : 'The event books no hall yet.'
                "
              />
            </div>
          }
        </section>

        <mat-menu #hallMenu="matMenu" xPosition="before" class="event-hall-menu">
          @for (option of addableHalls(); track option.hallId) {
            <button
              mat-menu-item
              [disabled]="option.conflicts.length > 0 || busy()"
              (click)="addHall(e, option)"
            >
              <mat-icon>{{ option.conflicts.length ? 'event_busy' : 'add' }}</mat-icon>
              <span class="item">
                <b>{{ option.name }}</b>
                @if (option.conflicts.length) {
                  <span class="muted"
                    >Booked by
                    @for (c of option.conflicts; track c.eventId) {
                      {{ c.name }} ({{ c.startsOn | date: 'd MMM' }} –
                      {{ c.endsOn | date: 'd MMM y' }}){{ $last ? '' : ', ' }}
                    }
                  </span>
                } @else if (option.code) {
                  <span class="muted">{{ option.code }}</span>
                }
              </span>
            </button>
          } @empty {
            <button mat-menu-item disabled>
              {{
                !hallOptionsLoaded()
                  ? 'Loading the venue’s halls…'
                  : hallOptions().length
                    ? 'Every hall of the venue is booked'
                    : 'The venue has no halls'
              }}
            </button>
          }
        </mat-menu>

        @if (context.can('layouts.view')) {
          <section aria-labelledby="plans-title">
            <h2 class="section-title" id="plans-title">Stall plans</h2>
            @if (plans().length) {
              <div class="table-wrap panel panel-flush">
                <table mat-table [dataSource]="plans()" aria-labelledby="plans-title">
                  <ng-container matColumnDef="hall">
                    <th mat-header-cell *matHeaderCellDef>Hall</th>
                    <td mat-cell *matCellDef="let p">
                      <b>{{ p.hallName }}</b>
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="status">
                    <th mat-header-cell *matHeaderCellDef>Plan</th>
                    <td mat-cell *matCellDef="let p">
                      @if (p.status) {
                        <span
                          class="status-chip"
                          [class.is-positive]="p.status === 'published'"
                          [class.is-neutral]="p.status === 'draft'"
                          >{{ planLabel(p.status) }}</span
                        >
                      } @else {
                        <span class="muted">Not started</span>
                      }
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="revision">
                    <th mat-header-cell *matHeaderCellDef>Revision</th>
                    <td mat-cell *matCellDef="let p">{{ p.planId ? p.revision : '—' }}</td>
                  </ng-container>
                  <ng-container matColumnDef="stalls">
                    <th mat-header-cell *matHeaderCellDef>Stalls</th>
                    <td mat-cell *matCellDef="let p">{{ p.stallCount }}</td>
                  </ng-container>
                  <ng-container matColumnDef="bookings">
                    <th mat-header-cell *matHeaderCellDef>Active bookings</th>
                    <td mat-cell *matCellDef="let p">{{ p.activeBookings }}</td>
                  </ng-container>
                  <ng-container matColumnDef="open">
                    <th mat-header-cell *matHeaderCellDef>
                      <span class="cdk-visually-hidden">Open</span>
                    </th>
                    <td mat-cell *matCellDef="let p" class="actions-cell">
                      <a
                        mat-button
                        [routerLink]="['halls', p.hallId, 'plan']"
                        [attr.aria-label]="'Open the plan of ' + p.hallName"
                        >Open plan</a
                      >
                    </td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="planColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: planColumns"></tr>
                </table>
              </div>
            } @else if (plansFailed()) {
              <p class="empty-state">
                The stall plans could not be loaded.
                <button mat-button (click)="loadPlans()">Try again</button>
              </p>
            } @else {
              <p class="empty-state">Each hall the event books gets its own stall plan.</p>
            }
          </section>
        }

        @if (context.can('bookings.view')) {
          <section aria-labelledby="exhibitors-title">
            <div class="row section-bar">
              <h2 class="section-title" id="exhibitors-title">
                Exhibitors ({{ exhibitors().length }})
              </h2>
              <span class="spacer"></span>
              <a mat-button [routerLink]="['/', slug(), 'exhibitors']">All exhibitors</a>
              @if (canRegister()) {
                <button mat-stroked-button [matMenuTriggerFor]="registerMenu">
                  <mat-icon>how_to_reg</mat-icon>Register exhibitor
                </button>
                <button mat-stroked-button (click)="newExhibitor(e)">
                  <mat-icon>add_business</mat-icon>New exhibitor
                </button>
              }
            </div>
            <mat-menu #registerMenu="matMenu" xPosition="before">
              @for (x of unregistered(); track x.id) {
                <button mat-menu-item [disabled]="busy()" (click)="register(e, x)">
                  <mat-icon>storefront</mat-icon>{{ x.name }}
                </button>
              } @empty {
                <button mat-menu-item disabled>Every exhibitor is registered</button>
              }
            </mat-menu>
            @if (exhibitors().length) {
              <ul class="exhibitors panel panel-flush">
                @for (x of exhibitors(); track x.id) {
                  <li>
                    <span class="body">
                      <b>{{ x.name }}</b>
                      <span class="muted small">
                        {{ x.contactName ?? 'No contact' }}
                        @if (x.email) {
                          · {{ x.email }}
                        }
                        @if (x.phone) {
                          · {{ x.phone }}
                        }
                      </span>
                    </span>
                    @if (canUnregister()) {
                      <button
                        mat-button
                        class="danger"
                        [disabled]="busy()"
                        (click)="unregister(e, x)"
                        [attr.aria-label]="'Unregister ' + x.name"
                      >
                        Unregister
                      </button>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="empty-state">No exhibitor is registered for this event yet.</p>
            }
          </section>
        }
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .outline-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-label-medium);
      white-space: nowrap;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px 24px;
      margin: 0;
    }
    .facts .wide {
      grid-column: 1 / -1;
    }
    dt {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }
    dd {
      margin: 0;
    }
    .description {
      white-space: pre-line;
    }
    .section-bar {
      margin-bottom: 4px;
    }
    .section-bar .section-title {
      margin: 0;
    }
    .item {
      display: grid;
      line-height: 1.3;
      padding: 4px 0;
    }
    .item .muted {
      font: var(--mat-sys-body-small);
    }
    .halls {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .hall {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font: var(--mat-sys-title-medium);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .name a {
      color: inherit;
    }
    .figures {
      font-variant-numeric: tabular-nums;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .floor-note {
      display: flex;
      gap: 6px;
      align-items: flex-start;
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }
    .floor-note mat-icon {
      flex: none;
      color: var(--mat-sys-primary);
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }
    .mat-mdc-cell:first-child,
    .mat-mdc-header-cell:first-child {
      padding-left: 20px;
    }
    .exhibitors {
      list-style: none;
      margin: 0;
    }
    .exhibitors li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 20px;
    }
    .exhibitors li + li {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
  `,
})
export class EventPageComponent implements OnInit {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(EventsApi);
  private readonly exhibitorsApi = inject(ExhibitorsApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  protected readonly context = inject(OrgContextStore);

  protected readonly statusLabels = EVENT_STATUS_LABELS;
  protected readonly planColumns = ['hall', 'status', 'revision', 'stalls', 'bookings', 'open'];

  protected readonly event = signal<EventDetailView | null>(null);
  protected readonly plans = signal<EventPlanSummaryView[]>([]);
  protected readonly hallOptions = signal<HallOptionView[]>([]);
  protected readonly hallOptionsLoaded = signal(false);
  /** Registered for this event. */
  protected readonly exhibitors = signal<ExhibitorView[]>([]);
  /** Every exhibitor the member sees, to register. */
  private readonly allExhibitors = signal<ExhibitorView[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly plansFailed = signal(false);
  protected readonly busy = signal(false);

  protected readonly slug = computed(() => this.context.slug());
  /** Booking halls and deleting events is for members of the whole organisation. */
  private readonly wholeOrganisation = computed(() => {
    const ctx = this.context.context();
    return !!ctx && !eventScoped(ctx.membership);
  });
  protected readonly canManage = computed(() => this.context.can('events.manage'));
  protected readonly open = computed(() => {
    const e = this.event();
    return !!e && isOpen(e.status);
  });
  protected readonly canManageHalls = computed(
    () => this.canManage() && this.wholeOrganisation() && this.open(),
  );
  protected readonly canDelete = computed(
    () => this.canManage() && this.wholeOrganisation() && this.event()?.status === 'draft',
  );
  protected readonly canBook = computed(() => this.context.can('bookings.view'));
  protected readonly canRegister = computed(
    () => this.context.can('bookings.manage') && this.open(),
  );
  protected readonly canUnregister = computed(() => this.context.can('bookings.manage'));
  protected readonly completeBlocked = computed(() => {
    const e = this.event();
    return e ? completeBlockedReason(e.endsOn) : null;
  });
  protected readonly addableHalls = computed(() => this.hallOptions().filter((h) => !h.booked));
  protected readonly unregistered = computed(() => {
    const registered = new Set(this.exhibitors().map((x) => x.id));
    return this.allExhibitors().filter((x) => !registered.has(x.id));
  });

  ngOnInit(): void {
    void this.load();
  }

  protected can(event: EventView, to: EventStatus): boolean {
    return canMove(event.status, to);
  }

  protected planLabel(status: StallPlanStatus): string {
    return PLAN_STATUS_LABELS[status];
  }

  protected kindLabel(event: EventView): string {
    const kind = EVENT_KINDS.find((k) => k.value === event.kind);
    return kind ? `${kind.label} event · ${kind.hint}` : event.kind;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.event.set(await firstValueFrom(this.api.event(this.slug(), this.eventId())));
    } catch {
      // The error interceptor has shown it.
      this.failed.set(true);
      return;
    } finally {
      this.loading.set(false);
    }
    await Promise.all([this.loadPlans(), this.loadExhibitors(), this.loadHallOptions()]);
  }

  protected async loadPlans(): Promise<void> {
    if (!this.context.can('layouts.view')) return;
    this.plansFailed.set(false);
    try {
      this.plans.set(await firstValueFrom(this.api.plans(this.slug(), this.eventId())));
    } catch {
      // The error interceptor has shown it.
      this.plansFailed.set(true);
    }
  }

  private async loadExhibitors(): Promise<void> {
    if (!this.context.can('bookings.view')) return;
    try {
      const [registered, all] = await Promise.all([
        firstValueFrom(this.exhibitorsApi.exhibitors(this.slug(), this.eventId())),
        this.context.can('bookings.manage')
          ? firstValueFrom(this.exhibitorsApi.exhibitors(this.slug()))
          : Promise.resolve([]),
      ]);
      this.exhibitors.set(registered);
      this.allExhibitors.set(all);
    } catch {
      // The error interceptor has shown it.
    }
  }

  private async loadHallOptions(): Promise<void> {
    if (!this.canManageHalls()) return;
    this.hallOptionsLoaded.set(false);
    try {
      this.hallOptions.set(await firstValueFrom(this.api.hallOptions(this.slug(), this.eventId())));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.hallOptionsLoaded.set(true);
    }
  }

  protected edit(event: EventDetailView): void {
    const data: EventDialogData = {
      slug: this.slug(),
      event,
      canChangeVenue: this.wholeOrganisation(),
    };
    this.dialog
      .open(EventDialogComponent, { data, maxWidth: '95vw' })
      .afterClosed()
      .subscribe((saved?: EventView) => {
        if (saved) {
          this.notifier.success(`${saved.name} saved.`);
          void this.load();
        }
      });
  }

  protected async complete(event: EventDetailView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Complete ${event.name}?`,
      message: 'A completed event no longer changes. This cannot be undone.',
      confirmLabel: 'Complete',
    });
    if (confirmed) await this.changeStatus(event, 'completed');
  }

  protected async cancel(event: EventDetailView): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Cancel ${event.name}?`,
      message:
        'A cancelled event no longer reserves its halls and cannot be scheduled again. ' +
        'Its active bookings must be cancelled first.',
      confirmLabel: 'Cancel event',
      destructive: true,
      reasonLabel: 'Why is it cancelled?',
    });
    if (reason !== null) await this.changeStatus(event, 'cancelled', reason);
  }

  /** Scheduling and back to draft are reversible, so they need no confirmation. */
  protected async changeStatus(
    event: EventDetailView,
    to: EventStatus,
    reason?: string,
  ): Promise<void> {
    this.busy.set(true);
    try {
      const view = await firstValueFrom(this.api.setStatus(this.slug(), event.id, to, reason));
      this.event.update((current) => (current ? { ...current, ...view } : current));
      this.notifier.success(`${view.name} is ${EVENT_STATUS_LABELS[view.status].toLowerCase()}.`);
      await this.loadHallOptions();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(event: EventDetailView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${event.name}?`,
      message: 'The draft and the halls it books are released. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteEvent(this.slug(), event.id));
      this.notifier.success(`${event.name} deleted.`);
      void this.router.navigate(['/', this.slug(), 'events']);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async addHall(event: EventDetailView, option: HallOptionView): Promise<void> {
    this.busy.set(true);
    try {
      this.event.set(await firstValueFrom(this.api.addHall(this.slug(), event.id, option.hallId)));
      this.notifier.success(`${option.name} booked for ${event.name}.`);
      await Promise.all([this.loadHallOptions(), this.loadPlans()]);
    } catch {
      // The error interceptor has shown it; show what is free now.
      await this.loadHallOptions();
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeHall(event: EventDetailView, hall: EventHallView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Remove ${hall.name}?`,
      message: `${event.name} no longer books it; the hall is free for other events on these days.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.removeHall(this.slug(), event.id, hall.hallId));
      this.notifier.success(`${hall.name} removed.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected newExhibitor(event: EventDetailView): void {
    const data: ExhibitorDialogData = {
      slug: this.slug(),
      events: [event],
      eventId: event.id,
      eventRequired: `Registered for ${event.name} at once`,
    };
    this.dialog
      .open(ExhibitorDialogComponent, { data, maxWidth: '95vw' })
      .afterClosed()
      .subscribe((saved?: ExhibitorView) => {
        if (saved) {
          this.notifier.success(`${saved.name} registered for ${event.name}.`);
          void this.loadExhibitors();
        }
      });
  }

  protected async register(event: EventDetailView, exhibitor: ExhibitorView): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.exhibitorsApi.register(this.slug(), event.id, exhibitor.id));
      this.notifier.success(`${exhibitor.name} registered for ${event.name}.`);
      await this.loadExhibitors();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async unregister(event: EventDetailView, exhibitor: ExhibitorView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Unregister ${exhibitor.name}?`,
      message: `${exhibitor.name} no longer takes part in ${event.name}. Not possible once it has bookings there.`,
      confirmLabel: 'Unregister',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.exhibitorsApi.unregister(this.slug(), event.id, exhibitor.id));
      this.notifier.success(`${exhibitor.name} unregistered.`);
      await this.loadExhibitors();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
