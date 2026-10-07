import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api/http-error';
import { OrgApi } from '../../core/org/org-api.service';
import { AuthLayoutComponent } from './auth-layout.component';
import { PASSWORD_MIN, passwordsMatch, passwordValidators } from './password-rules';

@Component({
  selector: 'app-reset-password-page',
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
    <app-auth-layout heading="Choose a new password">
      @if (!token()) {
        <p class="error" role="alert">This link is incomplete. Open it again from the email.</p>
      } @else if (done()) {
        <p role="status">Your password is changed. You are signed out on every device.</p>
        <a mat-flat-button [routerLink]="['..', 'login']">Sign in</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <mat-form-field>
            <mat-label>New password</mat-label>
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
            <input matInput type="password" formControlName="confirm" autocomplete="new-password" />
          </mat-form-field>
          @if (form.hasError('mismatch') && form.controls.confirm.touched) {
            <p class="error">The two passwords differ.</p>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button type="submit" [disabled]="busy()">Save the password</button>
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
      color: var(--mat-sys-error);
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
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.resetPassword(this.token()!, this.form.getRawValue().password));
      this.done.set(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
