import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';

import { errorMessage } from '../../core/api/http-error';
import { AuthService } from '../../core/auth/auth.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from './auth-layout.component';
import { safeReturnUrl } from './safe-return-url';

/** Sign-in, for an organisation (`/<org>/login`) or for the platform console (`/admin/login`). */
@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    AuthLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="Sign in" [subheading]="subheading()">
      @if (denied()) {
        <p class="notice" role="alert">This account cannot open the platform console.</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
        <mat-form-field>
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="username" required />
          <mat-error>Enter a valid email address</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Password</mat-label>
          <input
            matInput
            [type]="showPassword() ? 'text' : 'password'"
            formControlName="password"
            autocomplete="current-password"
            required
          />
          <button
            mat-icon-button
            matSuffix
            type="button"
            (click)="showPassword.set(!showPassword())"
            [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
          >
            <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          <mat-error>Enter your password</mat-error>
        </mat-form-field>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <button mat-flat-button type="submit" [disabled]="busy()">Sign in</button>
        <a mat-button [routerLink]="['..', 'forgot-password']">Forgot your password?</a>
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
      color: var(--mat-sys-error);
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
  protected readonly error = signal<string | null>(null);
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
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
      const org = this.org();
      const target = org
        ? safeReturnUrl(this.returnUrl() ?? null, `/${org.slug}`)
        : safeReturnUrl(this.returnUrl() ?? null, '/admin');
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
