import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OrgContextStore, PublicOrgStore } from '../../core/org/org.stores';
import { AccountMenuComponent } from '../../shared/account-menu.component';
import { BrandMarkComponent } from '../../shared/brand-mark.component';
import { NavItem, ShellLayoutComponent } from '../../shared/shell-layout.component';

/** The signed-in workspace of one organisation, in its own look. */
@Component({
  selector: 'app-org-shell',
  imports: [
    RouterLink,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
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
            <button mat-button [matMenuTriggerFor]="switcher" class="switcher">
              <mat-icon>swap_horiz</mat-icon>
              <span class="switcher-label">Switch</span>
            </button>
            <mat-menu #switcher="matMenu" xPosition="before">
              <p class="menu-title">Your organisations</p>
              @for (membership of auth.memberships(); track membership.id) {
                <button
                  mat-menu-item
                  (click)="switchTo(membership.organisation.slug)"
                  [disabled]="membership.organisation.slug === o.slug"
                >
                  <mat-icon>{{
                    membership.organisation.slug === o.slug ? 'check' : 'domain'
                  }}</mat-icon>
                  <span>{{ membership.organisation.name }}</span>
                </button>
              }
            </mat-menu>
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
      font: var(--mat-sys-label-medium);
    }
    .menu-title {
      margin: 8px 16px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
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
