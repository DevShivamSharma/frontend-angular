import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import type {
  AssignableRoleView,
  CreatedInvitation,
  InvitationView,
  MemberView,
  MembershipScope,
} from '../../../core/api/api.models';
import { AuthService } from '../../../core/auth/auth.service';
import { EventsApi } from '../../../core/events/events-api.service';
import type { EventView, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { InviteDialogComponent, InviteDialogData } from './invite-dialog.component';
import { scopeLines } from './scope-lines';

/**
 * The organisation's people. What a member can change follows their permissions, and never
 * reaches anyone holding a permission they lack (the server enforces the same).
 */
@Component({
  selector: 'app-team-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    CopyLinkComponent,
    PageHeaderComponent,
  ],
  templateUrl: './team-page.component.html',
  styleUrl: './team-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamPageComponent {
  private readonly api = inject(OrgApi);
  private readonly eventsApi = inject(EventsApi);
  private readonly exhibitorsApi = inject(ExhibitorsApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  protected readonly context = inject(OrgContextStore);
  private readonly me = inject(AuthService).user;

  protected readonly members = signal<MemberView[]>([]);
  protected readonly invitations = signal<InvitationView[]>([]);
  protected readonly roles = signal<AssignableRoleView[]>([]);
  /** To name the events and exhibitors of event roles, when the member may see them. */
  private readonly events = signal<EventView[]>([]);
  private readonly exhibitors = signal<ExhibitorView[]>([]);
  protected readonly resent = signal<CreatedInvitation | null>(null);
  protected readonly loading = signal(false);

  protected readonly canInvite = computed(() => this.context.can('team.invite'));
  protected readonly canManage = computed(() => this.context.can('team.manage'));
  protected readonly memberColumns = computed(() =>
    this.canManage() ? ['person', 'role', 'lastLogin', 'actions'] : ['person', 'role', 'lastLogin'],
  );
  protected readonly invitationColumns = computed(() =>
    this.canInvite() || this.canManage()
      ? ['email', 'role', 'invitedBy', 'expires', 'actions']
      : ['email', 'role', 'invitedBy', 'expires'],
  );
  private readonly rolesById = computed(() => new Map(this.roles().map((role) => [role.id, role])));
  private readonly eventNames = computed(() => new Map(this.events().map((e) => [e.id, e.name])));
  private readonly exhibitorNames = computed(
    () => new Map(this.exhibitors().map((x) => [x.id, x.name])),
  );

  private get slug(): string {
    return this.context.slug();
  }

  constructor() {
    void this.load();
    void this.loadScopeNames();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [members, invitations, roles] = await Promise.all([
        firstValueFrom(this.api.members(this.slug)),
        firstValueFrom(this.api.invitations(this.slug)),
        firstValueFrom(this.api.roles(this.slug)),
      ]);
      this.members.set(members);
      this.invitations.set(invitations);
      this.roles.set(roles);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  /** Separate from the team itself: the team shows even when these cannot be read. */
  private async loadScopeNames(): Promise<void> {
    try {
      const [events, exhibitors] = await Promise.all([
        this.context.can('events.view')
          ? firstValueFrom(this.eventsApi.events(this.slug))
          : Promise.resolve([]),
        this.context.can('bookings.view')
          ? firstValueFrom(this.exhibitorsApi.exhibitors(this.slug))
          : Promise.resolve([]),
      ]);
      this.events.set(events);
      this.exhibitors.set(exhibitors);
    } catch {
      // The error interceptor has shown it.
    }
  }

  /** The events (and exhibitor) an event role is given for. */
  protected scope(scope: MembershipScope): string[] {
    return scopeLines(scope, this.eventNames(), this.exhibitorNames());
  }

  protected isSelf(member: MemberView): boolean {
    return member.user.id === this.me()?.id;
  }

  /** A member whose role holds more than the viewer may not be changed by the viewer. */
  protected manageable(member: MemberView): boolean {
    return this.canManage() && (this.rolesById().get(member.role.id)?.assignable ?? false);
  }

  protected openInvite(): void {
    const data: InviteDialogData = {
      slug: this.slug,
      roles: this.roles(),
      events: this.events(),
      exhibitors: this.exhibitors(),
      canSeeEvents: this.context.can('events.view'),
      canSeeExhibitors: this.context.can('bookings.view'),
    };
    this.dialog
      .open(InviteDialogComponent, { data, autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((invited?: boolean) => {
        if (invited) {
          void this.load();
        }
      });
  }

  protected async changeRole(member: MemberView, roleId: string): Promise<void> {
    if (roleId === member.role.id) {
      return;
    }
    try {
      await firstValueFrom(this.api.changeRole(this.slug, member.id, roleId));
      this.notifier.success(`${member.user.name} is now ${this.rolesById().get(roleId)?.name}.`);
    } catch {
      // The error interceptor has shown it.
    }
    await this.load();
  }

  protected async remove(member: MemberView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Remove ${member.user.name}?`,
      message: `${member.user.email} loses access to this organisation at once. Their account stays, and can be invited again.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.api.removeMember(this.slug, member.id));
      this.notifier.success(`${member.user.name} removed.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async resend(invitation: InvitationView): Promise<void> {
    try {
      const created = await firstValueFrom(this.api.resendInvitation(this.slug, invitation.id));
      this.resent.set(created.inviteUrl ? created : null);
      this.notifier.success(
        `A new link was made for ${invitation.email}; the old one no longer works.`,
      );
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async revoke(invitation: InvitationView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Revoke the invitation?',
      message: `The link sent to ${invitation.email} stops working.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.api.revokeInvitation(this.slug, invitation.id));
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }
}
