import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from './auth-layout.component';
import { safeReturnUrl } from './safe-return-url';
import { FieldComponent } from '../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';

/** Sign-in, for an organisation (`/<org>/login`) or for the platform console (`/admin/login`). */
@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    AuthLayoutComponent,
    FieldComponent,
    InputTextModule,
    InputGroupModule,
    InputGroupAddonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="Sign in" [subheading]="subheading()">
      @if (denied()) {
        <p class="notice" role="alert">This account cannot open the platform console.</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
        <app-field label="Email" error="Enter a valid email address" for="login-email">
          <input
            id="login-email"
            pInputText
            type="email"
            formControlName="email"
            autocomplete="username"
            required
          />
        </app-field>
        <app-field label="Password" for="login-password" error="Enter your password">
          <p-inputgroup>
            <input
              id="login-password"
              pInputText
              [type]="showPassword() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="current-password"
              required
            />
            <p-inputgroup-addon>
              <button
                pButton
                type="button"
                [text]="true"
                severity="secondary"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
              >
                <app-icon [name]="showPassword() ? 'visibility_off' : 'visibility'" />
              </button>
            </p-inputgroup-addon>
          </p-inputgroup>
        </app-field>
        @if (busy()) {
          <p-progressbar mode="indeterminate" />
        }
        <button pButton type="submit" label="Sign in" [disabled]="busy()"></button>
        <a pButton [text]="true" [routerLink]="['..', 'forgot-password']">Forgot your password?</a>
      </form>
    </app-auth-layout>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
    }
    .error,
    .notice {
      margin: 0 0 8px;
      color: var(--app-error);
    }
  `,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly org = inject(PublicOrgStore).config;

  readonly returnUrl = input<string>();
  readonly denied = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly subheading = computed(() =>
    this.org() ? `Use the account ${this.org()!.name} invited you with.` : 'Super Admin only.',
  );

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
      const org = this.org();
      const target = org
        ? safeReturnUrl(this.returnUrl() ?? null, `/${org.slug}`)
        : safeReturnUrl(this.returnUrl() ?? null, '/admin');
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
