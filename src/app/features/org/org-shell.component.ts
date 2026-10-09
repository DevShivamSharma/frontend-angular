import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OrgContextStore, PublicOrgStore } from '../../core/org/org.stores';
import { AccountMenuComponent } from '../../shared/account-menu.component';
import { BrandMarkComponent } from '../../shared/brand-mark.component';
import { IconComponent } from '../../shared/icon.component';
import { NavItem, ShellLayoutComponent } from '../../shared/shell-layout.component';

/** The signed-in workspace of one organisation, in its own look. */
@Component({
  selector: 'app-org-shell',
  imports: [
    RouterLink,
    ButtonModule,
    IconComponent,
    PopoverModule,
    AccountMenuComponent,
    BrandMarkComponent,
    ShellLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (org(); as o) {
      <app-shell-layout [navItems]="nav()">
        <a brand [routerLink]="['/', o.slug]" class="brand">
          <app-brand-mark
            [name]="o.name"
            [logoUrl]="o.branding.logoUrl"
            [logoDarkUrl]="o.branding.logoDarkUrl"
            [size]="32"
          />
        </a>
        <ng-container account>
          @if (otherOrganisations().length) {
            <button
              pButton
              type="button"
              [text]="true"
              severity="secondary"
              class="switcher"
              aria-haspopup="menu"
              (click)="switcher.toggle($event)"
            >
              <app-icon name="swap_horiz" />
              <span class="switcher-label">Switch</span>
            </button>
            <p-popover #switcher>
              <div class="menu" role="menu">
                <p class="menu-title">Your organisations</p>
                @for (membership of auth.memberships(); track membership.id) {
                  <button
                    type="button"
                    class="menu-item"
                    role="menuitem"
                    (click)="switcher.hide(); switchTo(membership.organisation.slug)"
                    [disabled]="membership.organisation.slug === o.slug"
                  >
                    <app-icon
                      [name]="membership.organisation.slug === o.slug ? 'check' : 'domain'"
                    />
                    <span>{{ membership.organisation.name }}</span>
                  </button>
                }
              </div>
            </p-popover>
          }
          <span class="role muted">{{ context.context()?.membership?.role?.name }}</span>
          <app-account-menu [signedOutUrl]="'/' + o.slug + '/login'" />
        </ng-container>
      </app-shell-layout>
    }
  `,
  styles: `
    .brand {
      display: inline-flex;
      color: inherit;
      text-decoration: none;
      min-width: 0;
    }
    .role {
      font: var(--app-label-medium);
    }
    .menu {
      display: grid;
      min-width: 220px;
    }
    .menu-title {
      margin: 4px 8px 8px;
      font: var(--app-label-medium);
      color: var(--app-on-surface-variant);
    }
    @media (max-width: 600px) {
      .role,
      .switcher-label {
        display: none;
      }
    }
  `,
})
export class OrgShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly context = inject(OrgContextStore);
  private readonly router = inject(Router);

  protected readonly org = inject(PublicOrgStore).config;
  protected readonly otherOrganisations = computed(() =>
    this.auth.memberships().filter((m) => m.organisation.slug !== this.org()?.slug),
  );

  /** Only what the member's role allows appears in the navigation. */
  protected readonly nav = computed<NavItem[]>(() => {
    const slug = this.context.slug();
    const items: NavItem[] = [{ label: 'Home', icon: 'home', link: ['/', slug], exact: true }];
    if (this.context.eventScoped()) {
      items.push({ label: 'My events', icon: 'event', link: ['/', slug, 'events'] });
      return items;
    }
    if (this.context.can('events.view')) {
      items.push(
        { label: 'Internal events', icon: 'event', link: ['/', slug, 'events', 'internal'] },
        {
          label: 'External events',
          icon: 'event_available',
          link: ['/', slug, 'events', 'external'],
        },
      );
    }
    if (this.context.can('venues.view')) {
      items.push({ label: 'Venues', icon: 'location_city', link: ['/', slug, 'venues'] });
    }
    if (this.context.can('categories.manage')) {
      items.push({ label: 'Categories', icon: 'category', link: ['/', slug, 'categories'] });
    }
    if (this.context.can('rules.view')) {
      items.push({ label: 'Rules', icon: 'rule', link: ['/', slug, 'rules'] });
    }
    if (this.context.can('team.view')) {
      items.push({ label: 'Team', icon: 'group', link: ['/', slug, 'team'] });
    }
    if (this.context.can('org.settings.view')) {
      items.push({ label: 'Settings', icon: 'tune', link: ['/', slug, 'settings'] });
    }
    if (this.context.can('audit.view')) {
      items.push({ label: 'Audit log', icon: 'history', link: ['/', slug, 'audit'] });
    }
    return items;
  });

  protected switchTo(slug: string): void {
    void this.router.navigate(['/', slug]);
  }
}
