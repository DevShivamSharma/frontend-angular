import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import type { AssignableRoleView, CreatedInvitation } from '../../../core/api/api.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { SelectModule } from 'primeng/select';

export interface InviteDialogData {
  slug: string;
  roles: AssignableRoleView[];
}

/** Invites one person with one role. Closes with true once an invitation exists. */
@Component({
  selector: 'app-invite-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CopyLinkComponent,
    FieldComponent,
    InputTextModule,
    SelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Invite someone</h2>
    @if (created(); as invitation) {
      <div class="dialog-content stack">
        <p>{{ invitation.email }} is invited as {{ invitation.role.name }}.</p>
        @if (invitation.inviteUrl) {
          <p class="muted">
            Email is not connected yet: pass this link on yourself. It works once, for 7 days.
          </p>
          <app-copy-link [url]="invitation.inviteUrl" />
        }
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" (click)="another()">Invite another</button>
        <button pButton (click)="ref.close(true)">Done</button>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="submit()">
        <div class="dialog-content stack">
          <app-field label="Email" error="A valid email address" for="invite-dialog-email">
            <input
              id="invite-dialog-email"
              pInputText
              type="email"
              formControlName="email"
              cdkFocusInitial
            />
          </app-field>
          <app-field label="Role" for="invite-role" error="Choose a role">
            <p-select
              inputId="invite-role"
              formControlName="roleId"
              [options]="roles"
              optionLabel="name"
              optionValue="id"
              optionDisabled="disabled"
              placeholder="Choose a role"
            >
              <ng-template #item let-role>
                <span>
                  {{ role.name }}
                  @if (!role.assignable) {
                    <span class="muted"> — {{ role.reason }}</span>
                  }
                </span>
              </ng-template>
            </p-select>
          </app-field>
        </div>
        <div class="dialog-actions">
          <button pButton [text]="true" type="button" (click)="ref.close(invitedAny())">
            Cancel
          </button>
          <button pButton type="submit" [disabled]="busy()">Send invitation</button>
        </div>
      </form>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
  `,
})
export class InviteDialogComponent {
  protected readonly data = dialogData<InviteDialogData>();
  private readonly api = inject(OrgApi);
  protected readonly ref = inject(DialogRef);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    roleId: [
      this.data.roles.find((role) => role.assignable && !role.isLocked)?.id ?? '',
      Validators.required,
    ],
  });
  protected readonly busy = signal(false);
  /** Roles the inviter may not give are listed, with the reason, but cannot be chosen. */
  protected readonly roles = this.data.roles.map((role) => ({
    ...role,
    disabled: !role.assignable,
  }));
  protected readonly created = signal<CreatedInvitation | null>(null);
  /** Closing after any invitation was made tells the page to refresh. */
  protected readonly invitedAny = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const { email, roleId } = this.form.getRawValue();
      this.created.set(await firstValueFrom(this.api.invite(this.data.slug, email.trim(), roleId)));
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
