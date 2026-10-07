import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api/http-error';
import { OrgApi } from '../../core/org/org-api.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from './auth-layout.component';

@Component({
  selector: 'app-forgot-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    AuthLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout
      heading="Reset your password"
      subheading="We will email you a link to choose a new one."
    >
      @if (sent()) {
        <p role="status">
          If an account exists for <b>{{ form.controls.email.value }}</b
          >, a link is on its way. It works once, for one hour.
        </p>
        <a mat-flat-button [routerLink]="['..', 'login']">Back to sign in</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <mat-form-field>
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="username" />
            <mat-error>Enter a valid email address</mat-error>
          </mat-form-field>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button type="submit" [disabled]="busy()">Send the link</button>
          <a mat-button [routerLink]="['..', 'login']">Back to sign in</a>
        </form>
      }
    </app-auth-layout>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ForgotPasswordPageComponent {
  private readonly api = inject(OrgApi);
  private readonly org = inject(PublicOrgStore).config;

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.api.forgotPassword(this.form.getRawValue().email, this.org()?.slug),
      );
      this.sent.set(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
