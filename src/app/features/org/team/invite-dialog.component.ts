import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type {
  AssignableRoleView,
  CreatedInvitation,
  InviteInput,
} from '../../../core/api/api.models';
import { exhibitorsForEvents } from '../../../core/events/event-rules';
import type { EventView, ExhibitorView } from '../../../core/events/events.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { scopeLines } from './scope-lines';

export interface InviteDialogData {
  slug: string;
  roles: AssignableRoleView[];
  /** The events the inviter sees; an event role is given for some of them. */
  events: EventView[];
  /** The exhibitors the inviter sees; a role that books stalls acts for one of them. */
  exhibitors: ExhibitorView[];
  /** False without `events.view`, so no event can be chosen. */
  canSeeEvents: boolean;
  /** False without `bookings.view`, so no exhibitor can be chosen. */
  canSeeExhibitors: boolean;
}

/**
 * Invites one person with one role. An event role also names the events the person works on,
 * and, when it books stalls, the exhibitor it books for (registered for each of those events).
 * Closes with true once an invitation exists.
 */
@Component({
  selector: 'app-invite-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    CopyLinkComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Invite someone</h2>
    @if (created(); as invitation) {
      <mat-dialog-content class="stack">
        <p>{{ invitation.email }} is invited as {{ invitation.role.name }}.</p>
        @for (line of createdScope(); track line) {
          <p class="muted scope">{{ line }}</p>
        }
        @if (invitation.inviteUrl) {
          <p class="muted">
            Email is not connected yet: pass this link on yourself. It works once, for 7 days.
          </p>
          <app-copy-link [url]="invitation.inviteUrl" />
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="another()">Invite another</button>
        <button mat-flat-button [mat-dialog-close]="true">Done</button>
      </mat-dialog-actions>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-dialog-content class="stack">
          <mat-form-field>
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" cdkFocusInitial />
            <mat-error>A valid email address</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Role</mat-label>
            <mat-select formControlName="roleId">
              @for (role of data.roles; track role.id) {
                <mat-option [value]="role.id" [disabled]="!role.assignable">
                  {{ role.name }}
                  @if (!role.assignable) {
                    <span class="muted"> — {{ role.reason }}</span>
                  }
                </mat-option>
              }
            </mat-select>
            @if (eventRole()) {
              <mat-hint>An event role: the person works only on the events chosen below</mat-hint>
            }
            <mat-error>Choose a role</mat-error>
          </mat-form-field>
          @if (eventRole()) {
            <mat-form-field>
              <mat-label>Events</mat-label>
              <mat-select formControlName="eventIds" multiple>
                @for (event of eventOptions(); track event.id) {
                  <mat-option [value]="event.id">{{ event.name }}</mat-option>
                }
              </mat-select>
              @if (!data.canSeeEvents) {
                <mat-hint>Giving an event role needs permission to see events</mat-hint>
              } @else if (!eventOptions().length) {
                <mat-hint>There is no event to choose</mat-hint>
              }
              <mat-error>Choose the events this person works on</mat-error>
            </mat-form-field>
          }
          @if (booksStalls()) {
            <mat-form-field>
              <mat-label>Exhibitor</mat-label>
              <mat-select formControlName="exhibitorId">
                @for (exhibitor of exhibitorOptions(); track exhibitor.id) {
                  <mat-option [value]="exhibitor.id">{{ exhibitor.name }}</mat-option>
                }
              </mat-select>
              @if (!data.canSeeExhibitors) {
                <mat-hint>Choosing the exhibitor needs permission to see bookings</mat-hint>
              } @else if (!chosenEvents().length) {
                <mat-hint>Choose the events first</mat-hint>
              } @else if (!exhibitorOptions().length) {
                <mat-hint>No exhibitor is registered for every chosen event</mat-hint>
              } @else {
                <mat-hint>This role books stalls for one exhibitor of the chosen events</mat-hint>
              }
              <mat-error>Choose the exhibitor this person books stalls for</mat-error>
            </mat-form-field>
          }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" [mat-dialog-close]="invitedAny()">Cancel</button>
          <button mat-flat-button type="submit" [disabled]="busy()">Send invitation</button>
        </mat-dialog-actions>
      </form>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
    .scope {
      margin: 0;
    }
  `,
})
export class InviteDialogComponent {
  protected readonly data = inject<InviteDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(OrgApi);
  private readonly ref = inject(MatDialogRef<InviteDialogComponent, boolean>);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    roleId: [
      this.data.roles.find((role) => role.assignable && !role.isLocked)?.id ?? '',
      Validators.required,
    ],
    eventIds: [[] as string[], Validators.required],
    exhibitorId: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly created = signal<CreatedInvitation | null>(null);
  /** Closing after any invitation was made tells the page to refresh. */
  protected readonly invitedAny = signal(false);

  private readonly roleId = toSignal(this.form.controls.roleId.valueChanges, {
    initialValue: this.form.controls.roleId.value,
  });
  protected readonly chosenEvents = toSignal(this.form.controls.eventIds.valueChanges, {
    initialValue: this.form.controls.eventIds.value,
  });
  private readonly role = computed(() => this.data.roles.find((r) => r.id === this.roleId()));
  protected readonly eventRole = computed(() => this.role()?.scopeKind === 'event');
  /** Its permissions are effective ones, as the server checks them. */
  protected readonly booksStalls = computed(
    () => this.eventRole() && !!this.role()?.permissions.includes('stalls.book'),
  );
  /** The server gives event roles only for events that are not cancelled. */
  protected readonly eventOptions = computed(() =>
    this.data.events.filter((e) => e.status !== 'cancelled'),
  );
  protected readonly exhibitorOptions = computed(() =>
    exhibitorsForEvents(this.data.exhibitors, this.chosenEvents()),
  );
  protected readonly createdScope = computed(() => {
    const invitation = this.created();
    return invitation
      ? scopeLines(
          invitation.scope,
          new Map(this.data.events.map((e) => [e.id, e.name])),
          new Map(this.data.exhibitors.map((x) => [x.id, x.name])),
        )
      : [];
  });

  constructor() {
    this.ref.backdropClick().subscribe(() => this.ref.close(this.invitedAny()));
    this.applyRole();
    this.form.controls.roleId.valueChanges.subscribe(() => this.applyRole());
    // An exhibitor not registered for every chosen event can no longer be chosen.
    this.form.controls.eventIds.valueChanges.subscribe((eventIds) => {
      const exhibitorId = this.form.controls.exhibitorId.value;
      if (
        exhibitorId &&
        !exhibitorsForEvents(this.data.exhibitors, eventIds).some((x) => x.id === exhibitorId)
      ) {
        this.form.controls.exhibitorId.setValue('');
      }
    });
  }

  /** The events and exhibitor take part (and are checked) only when the role needs them. */
  private applyRole(): void {
    const role = this.data.roles.find((r) => r.id === this.form.controls.roleId.value);
    const eventRole = role?.scopeKind === 'event';
    const booksStalls = eventRole && !!role?.permissions.includes('stalls.book');
    const { eventIds, exhibitorId } = this.form.controls;
    if (eventRole) eventIds.enable({ emitEvent: false });
    else eventIds.disable({ emitEvent: false });
    if (booksStalls) exhibitorId.enable({ emitEvent: false });
    else exhibitorId.disable({ emitEvent: false });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const { email, roleId, eventIds, exhibitorId } = this.form.getRawValue();
      const input: InviteInput = { email: email.trim(), roleId };
      if (this.eventRole()) input.eventIds = eventIds;
      if (this.booksStalls()) input.exhibitorId = exhibitorId;
      this.created.set(await firstValueFrom(this.api.invite(this.data.slug, input)));
      this.invitedAny.set(true);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected another(): void {
    this.created.set(null);
    this.form.controls.email.reset('');
  }
}
