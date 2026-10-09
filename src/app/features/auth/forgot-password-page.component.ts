import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { OrgApi } from '../../core/org/org-api.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from './auth-layout.component';
import { FieldComponent } from '../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-forgot-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    AuthLayoutComponent,
    FieldComponent,
    InputTextModule,
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
        <a pButton [routerLink]="['..', 'login']">Back to sign in</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <app-field label="Email" error="Enter a valid email address" for="forgot-password-email">
            <input
              id="forgot-password-email"
              pInputText
              type="email"
              formControlName="email"
              autocomplete="username"
            />
          </app-field>
          <button pButton type="submit" [disabled]="busy()">Send the link</button>
          <a pButton [text]="true" [routerLink]="['..', 'login']">Back to sign in</a>
        </form>
      }
    </app-auth-layout>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
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

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.forgotPassword(this.form.getRawValue().email, this.org()?.slug),
      );
      this.sent.set(true);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
