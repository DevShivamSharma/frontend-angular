import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconComponent } from '../../shared/icon.component';
import { RouterLink } from '@angular/router';

import { AccountMenuComponent } from '../../shared/account-menu.component';
import { NavItem, ShellLayoutComponent } from '../../shared/shell-layout.component';

@Component({
  selector: 'app-admin-shell',
  imports: [ShellLayoutComponent, AccountMenuComponent, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell-layout [navItems]="nav">
      <a brand routerLink="/admin" class="brand" aria-label="Platform admin, overview">
        <span class="mark" aria-hidden="true"><app-icon name="stadium" /></span>
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
      outline: 2px solid var(--app-primary);
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
        var(--app-primary),
        color-mix(in srgb, var(--app-primary) 55%, var(--app-tertiary))
      );
      color: var(--app-on-primary);
    }
    .titles {
      display: grid;
      line-height: 1.2;
    }
    .name {
      font: var(--app-title-medium);
    }
    .role {
      font: var(--app-label-small);
      color: var(--app-on-surface-variant);
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
