import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';

import { IconComponent } from './icon.component';
import { Router } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';

/** The signed-in person's menu: who they are, and sign out. */
@Component({
  selector: 'app-account-menu',
  imports: [ButtonModule, IconComponent, PopoverModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as user) {
      <button
        pButton
        [text]="true"
        [rounded]="true"
        severity="secondary"
        (click)="menu.toggle($event)"
        aria-haspopup="menu"
        [attr.aria-label]="'Account of ' + user.name"
      >
        <span class="avatar" aria-hidden="true">{{ user.name.charAt(0).toUpperCase() }}</span>
      </button>
      <p-popover #menu>
        <div class="menu" role="menu">
          <div class="who">
            <b>{{ user.name }}</b>
            <span class="muted">{{ user.email }}</span>
          </div>
          <ng-content />
          <button type="button" class="menu-item" role="menuitem" (click)="menu.hide(); signOut()">
            <app-icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </p-popover>
    }
  `,
  styles: `
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--app-primary-container);
      color: var(--app-on-primary-container);
      font: var(--app-title-small);
    }
    .menu {
      display: grid;
      min-width: 240px;
    }
    .who {
      display: grid;
      padding: 4px 8px 10px;
      margin-bottom: 4px;
      gap: 2px;
      border-bottom: 1px solid var(--app-outline-variant);
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
