import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from './icon.component';
import { ThemeToggleComponent } from './theme-toggle.component';
import { TooltipModule } from 'primeng/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

export interface NavItem {
  label: string;
  icon: string;
  link: string[];
  /** Active only on an exact URL match (for a home page). */
  exact?: boolean;
  /** Items with the same group are listed together under its heading. */
  group?: string;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const COLLAPSED_KEY = 'app.nav.collapsed';

/** Remembered per browser; storage can be unavailable (private mode), so failures are ignored. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // The preference simply is not remembered.
  }
}

/**
 * The signed-in frame: a top bar (brand projected at the start, account controls at the end)
 * and a navigation rail. On wide screens the rail collapses to icons (remembered per browser);
 * on narrow screens it becomes a drawer over the page.
 */
@Component({
  selector: 'app-shell-layout',
  imports: [
    A11yModule,
    ButtonModule,
    IconComponent,
    TooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    ThemeToggleComponent,
  ],
  templateUrl: './shell-layout.component.html',
  styleUrl: './shell-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-ready]': 'ready()' },
})
export class ShellLayoutComponent {
  readonly navItems = input.required<NavItem[]>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly toggleButton = viewChild.required<unknown, ElementRef<HTMLElement>>(
    'navToggle',
    {
      read: ElementRef,
    },
  );

  protected readonly compact = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 900px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  protected readonly collapsed = signal(readCollapsed());
  protected readonly drawerOpen = signal(false);
  /** Transitions start after the first paint, so a remembered state does not animate in. */
  protected readonly ready = signal(false);

  protected readonly railCollapsed = computed(() => this.collapsed() && !this.compact());
  protected readonly expanded = computed(() =>
    this.compact() ? this.drawerOpen() : !this.collapsed(),
  );
  protected readonly toggleLabel = computed(() => {
    if (this.compact()) {
      return this.drawerOpen() ? 'Close navigation' : 'Open navigation';
    }
    return this.collapsed() ? 'Expand navigation' : 'Collapse navigation';
  });
  protected readonly groups = computed<NavGroup[]>(() => {
    const groups: NavGroup[] = [];
    for (const item of this.navItems()) {
      const label = item.group ?? null;
      const last = groups.at(-1);
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }
    return groups;
  });

  constructor() {
    afterNextRender(() => requestAnimationFrame(() => this.ready.set(true)));

    // The drawer closes when a link is followed, or when the screen grows wide.
    inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.drawerOpen.set(false));
    effect(() => {
      if (!this.compact()) {
        this.drawerOpen.set(false);
      }
    });
  }

  protected toggle(): void {
    if (this.compact()) {
      this.drawerOpen.update((open) => !open);
      // An opened drawer takes the focus to its first link (never on page load).
      if (this.drawerOpen()) {
        setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#app-nav a')?.focus());
      }
      return;
    }
    this.collapsed.update((collapsed) => !collapsed);
    storeCollapsed(this.collapsed());
  }

  protected closeDrawer(): void {
    if (this.drawerOpen()) {
      this.drawerOpen.set(false);
      this.toggleButton().nativeElement.focus();
    }
  }
}
