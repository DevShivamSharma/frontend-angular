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
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { InvitationPreview } from '../../core/api/api.models';
import { AuthService } from '../../core/auth/auth.service';
import { OrgApi } from '../../core/org/org-api.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { PASSWORD_MIN, passwordsMatch, passwordValidators } from './password-rules';
import { FieldComponent } from '../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';

/**
 * Where an invitation link lands. A new person chooses a name and password; someone with an
 * account already confirms with their password. Either way they end up signed in, inside.
 */
@Component({
  selector: 'app-accept-invite-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    AuthLayoutComponent,
    FieldComponent,
    InputTextModule,
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
            <app-field
              label="Your password"
              error="Enter your password"
              for="accept-invite-password"
            >
              <input
                id="accept-invite-password"
                pInputText
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
            </app-field>
            <a pButton [text]="true" [routerLink]="['..', 'forgot-password']"
              >Forgot your password?</a
            >
          } @else {
            <app-field label="Your name" error="Enter your name" for="accept-invite-name">
              <input
                id="accept-invite-name"
                pInputText
                formControlName="name"
                autocomplete="name"
              />
            </app-field>
            <app-field
              label="Choose a password"
              for="accept-invite-new-password"
              [hint]="'At least ' + min + ' characters'"
              [error]="'At least ' + min + ' characters'"
            >
              <input
                id="accept-invite-new-password"
                pInputText
                type="password"
                formControlName="password"
                autocomplete="new-password"
              />
            </app-field>
            <app-field label="Repeat it" for="accept-invite-confirm">
              <input
                id="accept-invite-confirm"
                pInputText
                type="password"
                formControlName="confirm"
                autocomplete="new-password"
              />
            </app-field>
            @if (form.hasError('mismatch') && form.controls.confirm.touched) {
              <p class="error">The two passwords differ.</p>
            }
          }
          @if (busy()) {
            <p-progressbar mode="indeterminate" />
          }
          <button pButton type="submit" [disabled]="busy()">Accept and continue</button>
        </form>
      </app-auth-layout>
    } @else {
      <app-auth-layout
        [heading]="loadError() ? 'This invitation cannot be used' : 'Opening your invitation…'"
      >
        @if (loadError()) {
          <p class="error" role="alert">{{ loadError() }}</p>
          <a pButton [text]="true" [routerLink]="['..', 'login']">Go to sign in</a>
        } @else {
          <p-progressbar mode="indeterminate" />
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
      color: var(--app-error);
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
