import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';

/** The signed-in person's menu: who they are, and sign out. */
@Component({
  selector: 'app-account-menu',
  imports: [MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as user) {
      <button
        mat-icon-button
        [matMenuTriggerFor]="menu"
        [attr.aria-label]="'Account of ' + user.name"
      >
        <span class="avatar" aria-hidden="true">{{ user.name.charAt(0).toUpperCase() }}</span>
      </button>
      <mat-menu #menu="matMenu" xPosition="before">
        <div class="who">
          <b>{{ user.name }}</b>
          <span class="muted">{{ user.email }}</span>
        </div>
        <mat-divider />
        <ng-content />
        <button mat-menu-item (click)="signOut()">
          <mat-icon>logout</mat-icon>
          <span>Sign out</span>
        </button>
      </mat-menu>
    }
  `,
  styles: `
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      font: var(--mat-sys-title-small);
    }
    .who {
      display: grid;
      padding: 12px 16px;
      gap: 2px;
    }
  `,
})
export class AccountMenuComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Where to land after signing out. */
  readonly signedOutUrl = input.required<string>();

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl(this.signedOutUrl(), { replaceUrl: true });
  }
}
