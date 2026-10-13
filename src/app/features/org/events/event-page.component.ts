import { DecimalPipe } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';

import type { AssignableRoleView } from '../../../core/api/api.models';
import { EventsApi } from '../../../core/events/events-api.service';
import type {
  EventDetailView,
  EventHallView,
  EventPeople,
  EventStatus,
  EventView,
} from '../../../core/events/events.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { AddHallsDialogComponent, AddHallsData } from './add-halls-dialog.component';
import { StatTileComponent } from '../../../shared/stat-tile.component';
import { daysBetween, formatDay, formatDays } from './event-dates';
import { EventExhibitorsComponent } from './event-exhibitors.component';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';
import { EventSettlementComponent } from './event-settlement.component';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { SelectModule } from 'primeng/select';

/** One event: its dates, the halls it uses (each with its rules), and its organisers. */
@Component({
  selector: 'app-event-page',
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    TooltipModule,
    CopyLinkComponent,
    EmptyStateComponent,
    EventExhibitorsComponent,
    EventSettlementComponent,
    PageHeaderComponent,
    StatTileComponent,
    FieldComponent,
    InputTextModule,
    SelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a pButton [text]="true" class="back" [routerLink]="backLink()"
        ><app-icon name="arrow_back" />{{ backLabel() }}</a
      >
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      @if (event(); as e) {
        <app-page-header
          [heading]="e.name"
          [subheading]="e.organiserName ?? 'Run by your organisation'"
        >
          <span meta class="chips">
            <span
              class="status-chip"
              [class.is-positive]="e.kind === 'internal'"
              [class.is-neutral]="e.kind === 'external'"
              >{{ e.kind === 'internal' ? 'Internal' : 'External' }}</span
            >
            <span class="status-chip is-neutral">{{ e.audience }}</span>
            <span
              class="status-chip"
              [class.is-positive]="e.status === 'scheduled'"
              [class.is-neutral]="e.status === 'draft' || e.status === 'completed'"
              [class.is-danger]="e.status === 'cancelled'"
              [pTooltip]="e.status === 'cancelled' ? (e.cancelReason ?? 'Cancelled') : ''"
              >{{ statusLabel(e.status) }}</span
            >
          </span>
          @if (canSeeBookings()) {
            <a pButton [outlined]="true" [routerLink]="['bookings']"
              ><app-icon name="confirmation_number" />Bookings</a
            >
          }
          @if (canManage() && !eventScoped()) {
            @switch (e.status) {
              @case ('draft') {
                <button pButton (click)="schedule(e)" [disabled]="busy()">
                  <app-icon name="event_available" />Schedule
                </button>
              }
              @case ('scheduled') {
                <button pButton [outlined]="true" (click)="complete(e)" [disabled]="busy()">
                  <app-icon name="task_alt" />Complete
                </button>
                <button pButton [text]="true" (click)="reopen(e)" [disabled]="busy()">
                  <app-icon name="undo" />Back to draft
                </button>
              }
            }
          }
          @if (canManage()) {
            <button pButton [outlined]="true" (click)="edit(e)">
              <app-icon name="edit" />Edit
            </button>
            @if (!eventScoped() && (e.status === 'draft' || e.status === 'scheduled')) {
              <button pButton [text]="true" severity="danger" (click)="cancel(e)" [disabled]="busy()">
                <app-icon name="event_busy" />Cancel event
              </button>
            }
            <button pButton [text]="true" severity="danger" (click)="remove(e)">
              <app-icon name="delete" />Delete
            </button>
          }
        </app-page-header>

        <div class="stats">
          <app-stat-tile
            icon="event"
            label="Event days"
            [value]="dayCount(e) + (dayCount(e) === 1 ? ' day' : ' days')"
            [caption]="days(e.startsOn, e.endsOn)"
          />
          <app-stat-tile
            icon="construction"
            tone="secondary"
            label="On site, build-up to dismantling"
            [value]="siteDays(e) + (siteDays(e) === 1 ? ' day' : ' days')"
            [caption]="days(e.buildUpOn ?? e.startsOn, e.dismantleOn ?? e.endsOn)"
          />
          <app-stat-tile
            icon="meeting_room"
            tone="tertiary"
            label="Halls"
            [value]="e.halls.length"
            [caption]="(totalArea() | number: '1.0-0') + ' m² of floor'"
          />
          <app-stat-tile
            icon="confirmation_number"
            label="Stalls are sold"
            [value]="e.bookingChannel === 'platform_portal' ? 'Here' : 'Your system'"
            [caption]="e.venueEventId ? 'Id in your system: ' + e.venueEventId : 'No id in your system'"
          />
        </div>

        <div class="layout">
        <div class="main">
        <section class="panel">
          <div class="row">
            <h2 class="section-title grow">
              Halls <span class="count">{{ e.halls.length }}</span>
            </h2>
            @if (canManage()) {
              <button pButton (click)="addHalls(e)"><app-icon name="add" />Add halls</button>
            }
          </div>
          @if (!e.halls.length) {
            <app-empty-state
              icon="meeting_room"
              heading="No halls yet"
              [text]="
                canManage()
                  ? 'Add the halls this event booked. Each keeps its floor and gets its own rules.'
                  : 'The venue has not added halls to this event yet.'
              "
            />
          }
          <ul class="halls">
            @for (h of e.halls; track h.hallId) {
              <li class="hall-card">
                <a class="hall" [routerLink]="['halls', h.hallId]">
                  <span class="hall-top">
                    <span class="hall-icon" aria-hidden="true"><app-icon name="meeting_room" /></span>
                    <span class="hall-name">
                      <b>{{ h.name }}</b>
                      <span class="muted small"
                        >{{ h.venue.name }}{{ h.level ? ' · ' + h.level : '' }}</span
                      >
                    </span>
                  </span>
                  <span class="hall-facts nums">
                    <span
                      ><b>{{ h.floorArea | number: '1.0-0' }}</b> m²</span
                    >
                    <span class="muted"
                      >{{ h.width | number: '1.0-1' }} × {{ h.depth | number: '1.0-1' }} m</span
                    >
                  </span>
                  <span class="hall-foot">
                    <span class="status-chip is-neutral">{{ h.rulesOn }} rules on</span>
                    @if (h.overlaps.length) {
                      <span class="status-chip is-warning" [pTooltip]="overlapText(h)">
                        <app-icon name="warning" /> Also booked
                      </span>
                    }
                    @if (h.latestFloorVersion !== h.floorVersion && !eventScoped()) {
                      <span
                        class="status-chip is-neutral"
                        pTooltip="The hall's floor changed after it was added; this event keeps the floor it was added with."
                      >
                        Floor v{{ h.floorVersion }}
                      </span>
                    }
                    <span class="open">Open <app-icon name="chevron_right" /></span>
                  </span>
                </a>
                @if (canManage()) {
                  <button
                    pButton
                    class="remove"
                    [text]="true"
                    [rounded]="true"
                    severity="secondary"
                    (click)="removeHall(e, h)"
                    [attr.aria-label]="'Remove ' + h.name"
                    pTooltip="Remove from this event"
                  >
                    <app-icon name="close" />
                  </button>
                }
              </li>
            }
          </ul>
        </section>

        @if (canSeeSettlement() && e.bookingChannel === 'platform_portal' && e.status !== 'draft') {
          <app-event-settlement [event]="e" />
        }
        </div>

        <aside class="side">
        @if (canSeeBookings()) {
          <app-event-exhibitors [event]="e" />
        }

        @if (e.kind === 'external' && canManage()) {
          <section class="panel">
            <h2 class="section-title">Organiser access</h2>
            <p class="muted">
              People from {{ e.organiserName }} sign in at your address and see this event’s halls
              only. They plan stalls with the rules you set for each hall.
            </p>
            <form class="invite" (ngSubmit)="invite(e)">
              <app-field class="email" label="Email" for="event-email">
                <input
                  id="event-email"
                  pInputText
                  type="email"
                  name="email"
                  [(ngModel)]="email"
                  required
                />
              </app-field>
              <app-field label="Role" for="event-invite-role" class="role">
                <p-select
                  inputId="event-invite-role"
                  name="role"
                  [(ngModel)]="roleId"
                  [options]="eventRoles()"
                  optionLabel="name"
                  optionValue="id"
                  required
                />
              </app-field>
              <button
                pButton
                type="submit"
                icon="pi pi-send"
                label="Invite"
                [disabled]="busy() || !email || !roleId"
              ></button>
            </form>
            @if (lastLink(); as link) {
              <div class="link">
                <span class="muted small">Send this link to {{ link.email }}:</span>
                <app-copy-link [url]="link.url" />
              </div>
            }
            @if (people(); as p) {
              <ul class="people">
                @for (m of p.members; track m.id) {
                  <li>
                    <span class="grow">
                      <b>{{ m.user.name }}</b>
                      <span class="muted small">{{ m.user.email }} · {{ m.role.name }}</span>
                    </span>
                    <button pButton [text]="true" (click)="removePerson(e, m.id, m.user.name)">
                      Remove
                    </button>
                  </li>
                }
                @for (i of p.invitations; track i.id) {
                  <li>
                    <span class="grow">
                      <b>{{ i.email }}</b>
                      <span class="muted small"
                        >{{ i.role.name }} ·
                        {{ i.expired ? 'invitation expired' : 'invited' }}</span
                      >
                    </span>
                    <button pButton [text]="true" (click)="revoke(e, i.id, i.email)">
                      Cancel invitation
                    </button>
                  </li>
                }
                @if (!p.members.length && !p.invitations.length) {
                  <li class="muted">Nobody yet.</li>
                }
              </ul>
            }
          </section>
        }
        </aside>
        </div>
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .chips {
      display: inline-flex;
      gap: 6px;
    }
    .label {
      font: var(--app-label-small);
      color: var(--app-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mono {
      font-family: ui-monospace, monospace;
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
      display: grid;
      min-width: 0;
    }
    .small {
      font: var(--app-body-small);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    /* Headline numbers, then halls beside the event's people: the page uses the full width. */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
      gap: 24px;
      align-items: start;
    }
    .main,
    .side {
      display: grid;
      gap: 24px;
      min-width: 0;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    h2.grow {
      display: flex;
      align-items: center;
    }
    .count {
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--app-label-medium);
      background: var(--app-surface-container);
      color: var(--app-on-surface-variant);
      vertical-align: middle;
    }
    .halls {
      list-style: none;
      margin: 16px 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
    }
    .hall-card {
      position: relative;
      display: flex;
    }
    .hall {
      flex: 1;
      display: grid;
      gap: 12px;
      align-content: start;
      padding: 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 12px;
      color: inherit;
      text-decoration: none;
      min-width: 0;
      transition:
        border-color 150ms ease,
        box-shadow 150ms ease;
    }
    .hall:hover,
    .hall:focus-visible {
      border-color: var(--app-primary);
      box-shadow: var(--app-level1);
    }
    .hall-top {
      display: flex;
      gap: 10px;
      align-items: center;
      padding-right: 28px;
      min-width: 0;
    }
    .hall-icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--app-primary-container);
      color: var(--app-on-primary-container);
    }
    .hall-name {
      display: grid;
      min-width: 0;
    }
    .hall-name b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hall-facts {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font: var(--app-body-small);
    }
    .hall-facts b {
      font: var(--app-title-medium);
    }
    .hall-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .open {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      font: var(--app-label-medium);
      color: var(--app-primary);
    }
    .remove {
      position: absolute;
      top: 6px;
      right: 6px;
    }
    .people {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
    }
    .people li {
      display: flex;
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--app-outline-variant);
      padding: 8px 0;
    }
    .people li:first-child {
      border-top: 0;
    }
    .invite {
      display: flex;
      flex-wrap: wrap;
      gap: 0 12px;
      align-items: flex-start;
    }
    .email {
      flex: 2 1 240px;
    }
    .role {
      flex: 1 1 180px;
    }
    .invite button {
      margin-top: 8px;
    }
    .link {
      display: grid;
      gap: 4px;
    }
  `,
})
export class EventPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(EventsApi);
  private readonly orgApi = inject(OrgApi);
  private readonly dialog = inject(AppDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly eventScoped = this.context.eventScoped;
  protected readonly canManage = computed(() => this.context.can('events.manage'));
  protected readonly canSeeBookings = computed(() => this.context.can('bookings.view'));
  protected readonly canSeeSettlement = computed(() => this.context.can('reports.view'));
  protected readonly event = signal<EventDetailView | null>(null);
  protected readonly people = signal<EventPeople | null>(null);
  protected readonly roles = signal<AssignableRoleView[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly lastLink = signal<{ email: string; url: string } | null>(null);
  protected email = '';
  protected roleId = '';

  /** Roles an organiser can be given: event roles, without the old exhibitor role. */
  protected readonly eventRoles = computed(() =>
    this.roles().filter((r) => r.scopeKind === 'event' && r.key !== 'exhibitor'),
  );
  protected readonly backLink = computed(() => {
    const e = this.event();
    if (this.eventScoped() || !e) return ['/', this.slug(), 'events'];
    return ['/', this.slug(), 'events', e.kind];
  });
  protected readonly backLabel = computed(() => {
    const e = this.event();
    if (this.eventScoped() || !e) return 'My events';
    return e.kind === 'internal' ? 'Internal events' : 'External events';
  });

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const id = this.eventId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const event = await firstValueFrom(this.api.event(this.slug(), id));
      this.event.set(event);
      if (event.kind === 'external' && this.canManage()) await this.loadPeople(event.id);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  private async loadPeople(id: string): Promise<void> {
    const [people, roles] = await Promise.all([
      firstValueFrom(this.api.people(this.slug(), id)),
      this.roles().length
        ? Promise.resolve(this.roles())
        : firstValueFrom(this.orgApi.roles(this.slug())),
    ]);
    this.people.set(people);
    this.roles.set(roles);
    if (!this.roleId) {
      this.roleId = this.eventRoles().find((r) => r.key === 'organiser_architect')?.id ?? '';
    }
  }

  protected days(from: string, to: string): string {
    return formatDays(from, to);
  }

  protected day(d: string): string {
    return formatDay(d);
  }

  /** Days the event is open, first and last included. */
  protected dayCount(e: EventView): number {
    return daysBetween(e.startsOn, e.endsOn) + 1;
  }

  /** Days the halls are taken, build-up to dismantling. */
  protected siteDays(e: EventView): number {
    return daysBetween(e.buildUpOn ?? e.startsOn, e.dismantleOn ?? e.endsOn) + 1;
  }

  /** Floor area of every hall the event uses, m². */
  protected readonly totalArea = computed(() =>
    (this.event()?.halls ?? []).reduce((sum, h) => sum + h.floorArea, 0),
  );

  protected overlapText(h: EventHallView): string {
    return (
      'Also booked at overlapping dates: ' +
      h.overlaps.map((o) => `${o.name} (${formatDays(o.startsOn, o.endsOn)})`).join(', ')
    );
  }

  protected edit(event: EventView): void {
    const data: EventDialogData = { slug: this.slug(), kind: event.kind, event };
    this.dialog.open<EventView>(EventDialogComponent, { data }).subscribe((saved?: EventView) => {
      if (saved) {
        this.notifier.success('Event saved.');
        void this.load(saved.id);
      }
    });
  }

  protected async remove(event: EventView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${event.name}?`,
      message:
        event.kind === 'external'
          ? 'Its halls and rules go, and its organisers lose access to it.'
          : 'Its halls and their rules go with it.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.delete(this.slug(), event.id));
      this.notifier.success(`${event.name} deleted.`);
      void this.router.navigate(['/', this.slug(), 'events', event.kind]);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected addHalls(event: EventDetailView): void {
    const data: AddHallsData = { slug: this.slug(), event };
    this.dialog
      .open<EventDetailView>(AddHallsDialogComponent, { data })
      .subscribe((saved?: EventDetailView) => {
        if (saved) {
          this.event.set(saved);
          this.notifier.success('Halls added.');
        }
      });
  }

  protected async removeHall(event: EventDetailView, hall: EventHallView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Remove ${hall.name} from ${event.name}?`,
      message: 'Its rules for this event go with it.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.removeHall(this.slug(), event.id, hall.hallId));
      await this.load(event.id);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected statusLabel(status: EventStatus): string {
    return { draft: 'Draft', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }[
      status
    ];
  }

  protected async schedule(event: EventView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Schedule ${event.name}?`,
      message: 'The event is on. Its published stall plans can go on sale.',
      confirmLabel: 'Schedule',
    });
    if (ok) await this.step(() => this.api.schedule(this.slug(), event.id), 'Event scheduled.');
  }

  protected async complete(event: EventView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Complete ${event.name}?`,
      message: 'The event is over. This cannot be undone.',
      confirmLabel: 'Complete',
    });
    if (ok) await this.step(() => this.api.complete(this.slug(), event.id), 'Event completed.');
  }

  protected async reopen(event: EventView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Take ${event.name} back to draft?`,
      message: 'It is off sale until it is scheduled again.',
      confirmLabel: 'Back to draft',
    });
    if (ok) await this.step(() => this.api.reopen(this.slug(), event.id), 'Event back in draft.');
  }

  protected async cancel(event: EventView): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Cancel ${event.name}?`,
      message: 'The event will not take place. Its halls and plans stay for the record.',
      reasonLabel: 'Why (optional)',
      confirmLabel: 'Cancel event',
      // "Cancel" next to "Cancel event" reads as the same thing.
      cancelLabel: 'Keep event',
      destructive: true,
      optional: true,
    });
    if (reason === null) return;
    await this.step(
      () => this.api.cancel(this.slug(), event.id, reason || null),
      'Event cancelled.',
    );
  }

  private async step(call: () => Observable<EventView>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(call());
      this.notifier.success(done);
      await this.load(this.eventId());
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async invite(event: EventDetailView): Promise<void> {
    const email = this.email.trim();
    if (!email || !this.roleId) return;
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.api.invite(this.slug(), event.id, email, this.roleId),
      );
      if (result.added) {
        this.notifier.success(`${email} can now open ${event.name}.`);
        this.lastLink.set(null);
      } else {
        this.notifier.success(`Invitation for ${email} created.`);
        const url = result.invitation?.inviteUrl;
        this.lastLink.set(url ? { email, url } : null);
      }
      this.email = '';
      await this.loadPeople(event.id);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async removePerson(event: EventDetailView, id: string, name: string): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Remove ${name} from ${event.name}?`,
      message: 'They lose access to this event. With no other event here, they leave entirely.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.removePerson(this.slug(), event.id, id));
      await this.loadPeople(event.id);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async revoke(event: EventDetailView, id: string, email: string): Promise<void> {
    try {
      await firstValueFrom(this.api.revokeInvitation(this.slug(), event.id, id));
      this.notifier.success(`Invitation for ${email} cancelled.`);
      this.lastLink.set(null);
      await this.loadPeople(event.id);
    } catch {
      // The error interceptor has shown it.
    }
  }
}
