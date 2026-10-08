import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { InvitationPreview } from '../../core/api/api.models';
import { AuthService } from '../../core/auth/auth.service';
import { OrgApi } from '../../core/org/org-api.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { PASSWORD_MIN, passwordsMatch, passwordValidators } from './password-rules';

/**
 * Where an invitation link lands. A new person chooses a name and password; someone with an
 * account already confirms with their password. Either way they end up signed in, inside.
 */
@Component({
  selector: 'app-accept-invite-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    AuthLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview(); as invite) {
      <app-auth-layout
        [heading]="'Join ' + invite.organisation.name"
        [subheading]="'You are invited as ' + invite.role.name + ', with ' + invite.email + '.'"
      >
        <form [formGroup]="form" (ngSubmit)="submit(invite)" class="stack">
          @if (invite.accountExists) {
            <p class="muted">You already have an account. Confirm it's you to accept.</p>
            <mat-form-field>
              <mat-label>Your password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
              <mat-error>Enter your password</mat-error>
            </mat-form-field>
            <a mat-button [routerLink]="['..', 'forgot-password']">Forgot your password?</a>
          } @else {
            <mat-form-field>
              <mat-label>Your name</mat-label>
              <input matInput formControlName="name" autocomplete="name" />
              <mat-error>Enter your name</mat-error>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Choose a password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="new-password"
              />
              <mat-hint>At least {{ min }} characters</mat-hint>
              <mat-error>At least {{ min }} characters</mat-error>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Repeat it</mat-label>
              <input
                matInput
                type="password"
                formControlName="confirm"
                autocomplete="new-password"
              />
            </mat-form-field>
            @if (form.hasError('mismatch') && form.controls.confirm.touched) {
              <p class="error">The two passwords differ.</p>
            }
          }
          @if (busy()) {
            <mat-progress-bar mode="indeterminate" />
          }
          <button mat-flat-button type="submit" [disabled]="busy()">Accept and continue</button>
        </form>
      </app-auth-layout>
    } @else {
      <app-auth-layout
        [heading]="loadError() ? 'This invitation cannot be used' : 'Opening your invitation…'"
      >
        @if (loadError()) {
          <p class="error" role="alert">{{ loadError() }}</p>
          <a mat-button [routerLink]="['..', 'login']">Go to sign in</a>
        } @else {
          <mat-progress-bar mode="indeterminate" />
        }
      </app-auth-layout>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
    }
    .error {
      margin: 0 0 8px;
      color: var(--mat-sys-error);
    }
  `,
})
export class AcceptInvitePageComponent {
  private readonly api = inject(OrgApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly token = input<string>();

  protected readonly min = PASSWORD_MIN;
  protected readonly preview = signal<InvitationPreview | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = this.fb.group(
    { name: [''], password: [''], confirm: [''] },
    { validators: passwordsMatch },
  );

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const token = this.token();
      untracked(() => void this.load(token));
    });
  }

  private async load(token: string | undefined): Promise<void> {
    if (!token) {
      this.loadError.set('The link is incomplete. Open it again from the email.');
      return;
    }
    try {
      const invite = await firstValueFrom(this.api.invitationPreview(token));
      this.applyValidators(invite.accountExists);
      this.preview.set(invite);
    } catch {
      // The error interceptor has shown why.
      this.loadError.set('Ask whoever invited you to send a new invitation.');
    }
  }

  private applyValidators(accountExists: boolean): void {
    const { name, password } = this.form.controls;
    if (accountExists) {
      name.clearValidators();
      password.setValidators(Validators.required);
    } else {
      name.setValidators([Validators.required, Validators.maxLength(120)]);
      password.setValidators(passwordValidators);
    }
    name.updateValueAndValidity();
    password.updateValueAndValidity();
  }

  protected async submit(invite: InvitationPreview): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const { name, password } = this.form.getRawValue();
      const slug = await this.auth.acceptInvitation(
        this.token()!,
        invite.accountExists ? { password } : { name: name.trim(), password },
      );
      await this.router.navigate(['/', slug], { replaceUrl: true });
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
