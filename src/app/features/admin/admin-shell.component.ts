import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { AccountMenuComponent } from '../../shared/account-menu.component';
import { NavItem, ShellLayoutComponent } from '../../shared/shell-layout.component';

@Component({
  selector: 'app-admin-shell',
  imports: [ShellLayoutComponent, AccountMenuComponent, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell-layout [navItems]="nav">
      <a brand routerLink="/admin" class="brand" aria-label="Platform admin, overview">
        <span class="mark" aria-hidden="true"><mat-icon>stadium</mat-icon></span>
        <span class="titles">
          <span class="name">Venue Platform</span>
          <span class="role">Super Admin console</span>
        </span>
      </a>
      <app-account-menu account signedOutUrl="/admin/login" />
    </app-shell-layout>
  `,
  styles: `
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      color: inherit;
      text-decoration: none;
      border-radius: 10px;
    }
    .brand:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 4px;
    }
    .mark {
      display: grid;
      place-items: center;
      flex: none;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(
        135deg,
        var(--mat-sys-primary),
        color-mix(in srgb, var(--mat-sys-primary) 55%, var(--mat-sys-tertiary))
      );
      color: var(--mat-sys-on-primary);
    }
    .titles {
      display: grid;
      line-height: 1.2;
    }
    .name {
      font: var(--mat-sys-title-medium);
    }
    .role {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      letter-spacing: 0.04em;
    }
    @media (max-width: 480px) {
      .role {
        display: none;
      }
    }
  `,
})
export class AdminShellComponent {
  protected readonly nav: NavItem[] = [
    { label: 'Overview', icon: 'space_dashboard', link: ['/admin/overview'] },
    { label: 'Organisations', icon: 'domain', link: ['/admin/organisations'], group: 'Tenants' },
    {
      label: 'Roles and permissions',
      icon: 'shield_person',
      link: ['/admin/roles'],
      group: 'Access',
    },
    { label: 'Audit log', icon: 'history', link: ['/admin/audit'], group: 'Monitoring' },
  ];
}
