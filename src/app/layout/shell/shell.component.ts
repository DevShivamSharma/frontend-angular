import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { MenuModule } from 'primeng/menu';

import { AuthService } from '../../core/auth/auth.service';
import { TooltipModule } from 'primeng/tooltip';

import { PlansApiService } from '../../features/planner/data/plans-api.service';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ThemeMode, ThemeService } from '../../core/theme/theme.service';
import { groupNav, NAV_ITEMS } from '../nav-items';

/** The frame of every signed-in page: top bar, navigation (a drawer on small screens) and content. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgTemplateOutlet,
    ButtonModule,
    DrawerModule,
    MenuModule,
    TooltipModule,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly auth = inject(AuthService);

  private readonly theme = inject(ThemeService);
  private readonly confirm = inject(ConfirmService);

  private readonly plans = inject(PlansApiService);
  private readonly router = inject(Router);

  /** Hall plans waiting for ITPO's answer (ITPO staff). */
  protected readonly pending = signal(0);

  protected readonly user = this.auth.user;
  protected readonly displayName = this.auth.displayName;
  protected readonly drawerOpen = signal(false);

  protected readonly navGroups = computed(() =>
    groupNav(NAV_ITEMS.filter((item) => !item.staffOnly || this.auth.isStaff())),
  );

  /** The sidebar shows only icons; kept between visits, because a user who shrank it wants it so. */
  protected readonly collapsed = signal(readCollapsed());

  constructor() {
    if (this.auth.isStaff()) {
      this.refreshPending();
      // After each page change, and every minute: an organiser may have sent a hall meanwhile.
      const sub = this.router.events.subscribe((e) => {
        if (e instanceof NavigationEnd) this.refreshPending();
      });
      const timer = setInterval(() => this.refreshPending(), 60_000);
      inject(DestroyRef).onDestroy(() => {
        sub.unsubscribe();
        clearInterval(timer);
      });
    }
  }

  private refreshPending(): void {
    this.plans.pendingCount().subscribe({
      next: (count) => this.pending.set(count),
      error: () => undefined,
    });
  }

  protected readonly initials = computed(() => {
    const words = this.displayName()
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    return words.length > 1
      ? (words[0][0] + words[1][0]).toUpperCase()
      : (words[0]?.slice(0, 2).toUpperCase() ?? 'U');
  });

  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);

  protected readonly themeMenu = computed<MenuItem[]>(() =>
    (Object.keys(THEME_ICONS) as ThemeMode[]).map((mode) => ({
      label: THEME_LABELS[mode],
      icon: `pi ${THEME_ICONS[mode]}`,
      styleClass: this.theme.mode() === mode ? 'menu-item--current' : '',
      command: () => this.theme.set(mode),
    })),
  );

  protected readonly userMenu = computed<MenuItem[]>(() => [
    {
      label: this.user()?.type === 'itpo_staff' ? 'ITPO staff' : 'Organiser',
      disabled: true,
      styleClass: 'user-menu__role',
    },
    { separator: true },
    { label: 'Sign out', icon: 'pi pi-sign-out', command: () => this.signOut() },
  ]);

  protected toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage may be blocked; the sidebar still changes for this visit.
    }
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  private async signOut(): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Sign out',
      message: 'Sign out of the portal?',
      acceptLabel: 'Sign out',
      icon: 'pi pi-sign-out',
    });
    if (go) {
      this.auth.logout().subscribe();
    }
  }
}

const COLLAPSED_KEY = 'ems.sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const THEME_ICONS: Record<ThemeMode, string> = {
  light: 'pi-sun',
  dark: 'pi-moon',
  system: 'pi-desktop',
};

const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Device setting',
};
