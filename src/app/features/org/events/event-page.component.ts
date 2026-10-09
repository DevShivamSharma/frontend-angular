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
import { firstValueFrom } from 'rxjs';

import type { AssignableRoleView } from '../../../core/api/api.models';
import { EventsApi } from '../../../core/events/events-api.service';
import type {
  EventDetailView,
  EventHallView,
  EventPeople,
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
import { formatDay, formatDays } from './event-dates';
import { EventDialogComponent, EventDialogData } from './event-dialog.component';
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
    PageHeaderComponent,
    FieldComponent,
    InputTextModule,
    SelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-narrow">
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
          </span>
          @if (canManage()) {
            <button pButton [outlined]="true" (click)="edit(e)">
              <app-icon name="edit" />Edit
            </button>
            <button pButton [text]="true" severity="danger" (click)="remove(e)">
              <app-icon name="delete" />Delete
            </button>
          }
        </app-page-header>

        <section class="panel facts">
          <div>
            <span class="label">Event days</span>
            <b>{{ days(e.startsOn, e.endsOn) }}</b>
          </div>
          @if (e.buildUpOn) {
            <div>
              <span class="label">Build-up from</span>
              <b>{{ day(e.buildUpOn) }}</b>
            </div>
          }
          @if (e.dismantleOn) {
            <div>
              <span class="label">Dismantling until</span>
              <b>{{ day(e.dismantleOn) }}</b>
            </div>
          }
          @if (e.venueEventId) {
            <div>
              <span class="label">Id in your system</span>
              <b class="mono">{{ e.venueEventId }}</b>
            </div>
          }
        </section>

        <section class="panel">
          <div class="row">
            <h2 class="section-title grow">Halls</h2>
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
              <li>
                <a class="hall" [routerLink]="['halls', h.hallId]">
                  <span class="hall-name">
                    <b>{{ h.name }}</b>
                    <span class="muted small"
                      >{{ h.venue.name }}{{ h.level ? ' · ' + h.level : '' }}</span
                    >
                  </span>
                  <span class="muted small nums">
                    {{ h.width | number: '1.0-1' }} × {{ h.depth | number: '1.0-1' }} m ·
                    {{ h.floorArea | number: '1.0-0' }} m²
                  </span>
                  <span class="small">{{ h.rulesOn }} rules on</span>
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
                  <app-icon class="chevron" name="chevron_right" />
                </a>
                @if (canManage()) {
                  <button
                    pButton
                    [text]="true"
                    [rounded]="true"
                    severity="secondary"
                    (click)="removeHall(e, h)"
                    [attr.aria-label]="'Remove ' + h.name"
                  >
                    <app-icon name="close" />
                  </button>
                }
              </li>
            }
          </ul>
        </section>

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
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: 16px 40px;
    }
    .facts div {
      display: grid;
      gap: 2px;
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
    .halls,
    .people {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
    }
    .halls li,
    .people li {
      display: flex;
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--app-outline-variant);
      padding: 8px 0;
    }
    .halls li:first-child,
    .people li:first-child {
      border-top: 0;
    }
    .hall {
      flex: 1;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 16px;
      color: inherit;
      text-decoration: none;
      min-width: 0;
      border-radius: 8px;
      padding: 4px;
    }
    .hall:hover,
    .hall:focus-visible {
      background: var(--app-surface-container);
    }
    .hall-name {
      display: grid;
      min-width: 160px;
      flex: 1 1 200px;
    }
    .chevron {
      color: var(--app-on-surface-variant);
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
