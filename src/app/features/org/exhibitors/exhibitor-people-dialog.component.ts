import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import type { ExhibitorPeople, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { FieldComponent } from '../../../shared/field.component';

export interface ExhibitorPeopleDialogData {
  slug: string;
  exhibitor: ExhibitorView;
  /** Members with `bookings.manage` invite; others only see who books for it. */
  canInvite: boolean;
}

/**
 * The people who sign in to book stalls for an exhibitor, and inviting another (docs/15 §9 Q13:
 * invite-only). They see the events the exhibitor is registered for; the portal where they book
 * comes with M5.
 */
@Component({
  selector: 'app-exhibitor-people-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    ProgressBarModule,
    CopyLinkComponent,
    FieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">People of {{ data.exhibitor.name }}</h2>
    <div class="dialog-content stack">
      <p class="muted">
        They sign in at your address and book stalls for {{ data.exhibitor.name }} at the events
        it is registered for, once exhibitor booking opens.
      </p>
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      @if (people(); as p) {
        <ul class="people">
          @for (m of p.members; track m.id) {
            <li>
              <b>{{ m.user.name }}</b> <span class="muted small">{{ m.user.email }}</span>
            </li>
          }
          @for (i of p.invitations; track i.id) {
            <li>
              <b>{{ i.email }}</b>
              <span class="muted small">{{ i.expired ? 'invitation expired' : 'invited' }}</span>
            </li>
          }
          @if (!p.members.length && !p.invitations.length) {
            <li class="muted">Nobody yet.</li>
          }
        </ul>
      }
      @if (data.canInvite) {
        @if (data.exhibitor.eventIds.length) {
          <form class="invite" (ngSubmit)="invite()">
            <app-field class="grow" label="Email" for="exhibitor-person-email">
              <input
                id="exhibitor-person-email"
                pInputText
                type="email"
                name="email"
                [(ngModel)]="email"
                required
              />
            </app-field>
            <button pButton type="submit" [disabled]="busy() || !email.trim()">Invite</button>
          </form>
        } @else {
          <p class="muted small">
            Register {{ data.exhibitor.name }} for an event first: its people see only the events
            it takes part in.
          </p>
        }
        @if (lastLink(); as link) {
          <div class="link">
            <span class="muted small">Send this link to {{ link.email }}:</span>
            <app-copy-link [url]="link.url" />
          </div>
        }
      }
    </div>
    <div class="dialog-actions">
      <button pButton type="button" (click)="ref.close()">Done</button>
    </div>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 8px;
      min-width: min(480px, 84vw);
    }
    p {
      margin: 0;
    }
    .people {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .invite {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .grow {
      flex: 1 1 auto;
    }
    .invite button {
      margin-top: 24px;
    }
    .small {
      font: var(--app-body-small);
    }
    .link {
      display: grid;
      gap: 4px;
    }
  `,
})
export class ExhibitorPeopleDialogComponent {
  protected readonly data = dialogData<ExhibitorPeopleDialogData>();
  private readonly api = inject(ExhibitorsApi);
  private readonly notifier = inject(Notifier);
  protected readonly ref = inject(DialogRef);

  protected readonly people = signal<ExhibitorPeople | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly lastLink = signal<{ email: string; url: string } | null>(null);
  protected email = '';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.people.set(await firstValueFrom(this.api.people(this.data.slug, this.data.exhibitor.id)));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected async invite(): Promise<void> {
    const email = this.email.trim();
    if (!email) return;
    this.busy.set(true);
    try {
      const invitation = await firstValueFrom(
        this.api.invitePerson(this.data.slug, this.data.exhibitor.id, email),
      );
      this.notifier.success(`Invitation for ${email} created.`);
      this.lastLink.set(invitation.inviteUrl ? { email, url: invitation.inviteUrl } : null);
      this.email = '';
      await this.load();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
