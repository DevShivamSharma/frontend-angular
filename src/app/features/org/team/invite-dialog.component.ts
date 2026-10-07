import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { AssignableRoleView, CreatedInvitation } from '../../../core/api/api.models';
import { errorMessage } from '../../../core/api/http-error';
import { OrgApi } from '../../../core/org/org-api.service';
import { CopyLinkComponent } from '../../../shared/copy-link.component';

export interface InviteDialogData {
  slug: string;
  roles: AssignableRoleView[];
}

/** Invites one person with one role. Closes with true once an invitation exists. */
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
            <mat-error>Choose a role</mat-error>
          </mat-form-field>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
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
    .error {
      color: var(--mat-sys-error);
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
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly created = signal<CreatedInvitation | null>(null);
  /** Closing after any invitation was made tells the page to refresh. */
  protected readonly invitedAny = signal(false);

  constructor() {
    this.ref.backdropClick().subscribe(() => this.ref.close(this.invitedAny()));
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const { email, roleId } = this.form.getRawValue();
      this.created.set(await firstValueFrom(this.api.invite(this.data.slug, email.trim(), roleId)));
      this.invitedAny.set(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected another(): void {
    this.created.set(null);
    this.form.controls.email.reset('');
  }
}
