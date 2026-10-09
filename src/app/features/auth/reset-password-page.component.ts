import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { OrgApi } from '../../core/org/org-api.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { PASSWORD_MIN, passwordsMatch, passwordValidators } from './password-rules';
import { FieldComponent } from '../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-reset-password-page',
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
    <app-auth-layout heading="Choose a new password">
      @if (!token()) {
        <p class="error" role="alert">This link is incomplete. Open it again from the email.</p>
      } @else if (done()) {
        <p role="status">Your password is changed. You are signed out on every device.</p>
        <a pButton [routerLink]="['..', 'login']">Sign in</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <app-field
            label="New password"
            for="reset-password"
            [hint]="'At least ' + min + ' characters'"
            [error]="'At least ' + min + ' characters'"
          >
            <input
              id="reset-password"
              pInputText
              type="password"
              formControlName="password"
              autocomplete="new-password"
            />
          </app-field>
          <app-field label="Repeat it" for="reset-password-confirm">
            <input
              id="reset-password-confirm"
              pInputText
              type="password"
              formControlName="confirm"
              autocomplete="new-password"
            />
          </app-field>
          @if (form.hasError('mismatch') && form.controls.confirm.touched) {
            <p class="error">The two passwords differ.</p>
          }
          <button pButton type="submit" [disabled]="busy()">Save the password</button>
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
      margin: 0 0 8px;
      color: var(--app-error);
    }
  `,
})
export class ResetPasswordPageComponent {
  private readonly api = inject(OrgApi);

  readonly token = input<string>();

  protected readonly min = PASSWORD_MIN;
  protected readonly form = inject(NonNullableFormBuilder).group(
    { password: ['', passwordValidators], confirm: [''] },
    { validators: passwordsMatch },
  );
  protected readonly busy = signal(false);
  protected readonly done = signal(false);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.resetPassword(this.token()!, this.form.getRawValue().password));
      this.done.set(true);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
