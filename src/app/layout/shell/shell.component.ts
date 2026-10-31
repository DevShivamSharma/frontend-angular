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
import { firstValueFrom } from 'rxjs';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { MenuModule } from 'primeng/menu';

import { AuthService } from '../../core/auth/auth.service';
import { TooltipModule } from 'primeng/tooltip';
import { AppDialog } from '../../core/dialog/app-dialog.service';
import { NotifierService } from '../../core/notification/notifier.service';

import { LayoutService } from '../../core/layout/layout.service';
import {
  PlansApiService,
  type MyPlanReview,
  type PendingPlanReview,
} from '../../features/planner/data/plans-api.service';
import { RejectDialogComponent } from '../../features/planner/components/reject-dialog/reject-dialog.component';
import type {
  RejectDialogData,
  RejectDialogResult,
} from '../../features/planner/components/reject-dialog/reject-dialog.component';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ThemeMode, ThemeService } from '../../core/theme/theme.service';
import { BrandLogosComponent } from '../../shared/ui/brand-logos/brand-logos.component';
import { groupNav, NAV_ITEMS } from '../nav-items';

/** The frame of every signed-in page: top bar, navigation (a drawer on small screens) and content. */
@Component({
  selector: 'app-shell',
  imports: [
    BrandLogosComponent,
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
  private readonly dialogs = inject(AppDialog);
  private readonly notify = inject(NotifierService);

  private readonly plans = inject(PlansApiService);
  private readonly router = inject(Router);

  /** Submitted external hall plans that ITPO staff can review from the event page. */
  protected readonly pendingReviews = signal<PendingPlanReview[]>([]);
  private readonly pendingCountFallback = signal<number | null>(null);
  protected readonly pending = computed(
    () => this.pendingReviews().length || this.pendingCountFallback() || 0,
  );
  protected readonly notificationLoadFailed = signal(false);
  protected readonly canReviewPlans = computed(() => {
    const roles = this.auth.user()?.roles ?? [];
    return roles.includes('itpo_admin') || roles.includes('super_admin');
  });
  protected readonly reviewing = signal<{
    eventHallId: string;
    action: 'approve' | 'reject';
  } | null>(null);

  /** ITPO's answers on the organiser's own hall plans. */
  protected readonly myReviews = signal<MyPlanReview[]>([]);
  /** When the organiser last opened the bell; answers after it count as new. */
  private readonly reviewsSeenAt = signal(readSeenAt());
  protected readonly unseenReviews = computed(
    () => this.myReviews().filter((r) => Date.parse(r.reviewedAt) > this.reviewsSeenAt()).length,
  );

  protected readonly user = this.auth.user;
  protected readonly displayName = this.auth.displayName;
  protected readonly isStaff = this.auth.isStaff;
  protected readonly drawerOpen = signal(false);

  protected readonly navGroups = computed(() =>
    groupNav(
      this.auth.isStaff()
        ? NAV_ITEMS
        : NAV_ITEMS.filter((item) => !item.staffOnly).map((item) => ({
            ...item,
            label: item.organiserLabel ?? item.label,
          })),
    ),
  );

  private readonly layout = inject(LayoutService);
  /** The sidebar shows only icons; kept between visits, because a user who shrank it wants it so. */
  protected readonly collapsed = signal(readCollapsed());
  /** Icons only: by the person's choice, or because the page open needs the width. */
  protected readonly compact = computed(() => this.collapsed() || this.layout.focus());

  constructor() {
    const refresh = this.auth.isStaff() ? () => this.refreshPending() : () => this.refreshMine();
    refresh();
    // After each page change, and every minute: the other side may have acted meanwhile.
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) refresh();
    });
    const timer = setInterval(refresh, 60_000);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearInterval(timer);
    });
  }

  protected refreshMine(): void {
    this.plans.myReviews().subscribe({
      next: (reviews) => {
        this.myReviews.set(reviews);
        this.notificationLoadFailed.set(false);
      },
      error: () => this.notificationLoadFailed.set(true),
    });
  }

  /** Opening the bell marks every answer shown as seen. */
  protected markReviewsSeen(menu: HTMLDetailsElement): void {
    if (!menu.open) return;
    const now = Date.now();
    this.reviewsSeenAt.set(now);
    try {
      localStorage.setItem(REVIEWS_SEEN_KEY, String(now));
    } catch {
      // Storage may be blocked; the badge clears for this visit only.
    }
  }

  protected refreshPending(): void {
    this.plans.pendingReviews().subscribe({
      next: (reviews) => {
        this.pendingReviews.set(reviews);
        this.pendingCountFallback.set(null);
        this.notificationLoadFailed.set(false);
      },
      error: () => {
        // Older deployed EMS versions expose only the count endpoint. Keep the badge useful there.
        this.plans.pendingCount().subscribe({
          next: (count) => {
            this.pendingCountFallback.set(count);
            this.notificationLoadFailed.set(false);
          },
          error: () => this.notificationLoadFailed.set(true),
        });
      },
    });
  }

  protected async approvePending(review: PendingPlanReview): Promise<void> {
    if (!this.canReviewPlans() || this.reviewing()) return;
    const approved = await this.confirm.ask({
      header: 'Approve the plan',
      message: `Approve the stall plan for ${review.eventName} · ${review.hallName}? The organiser will be notified and can publish it.`,
      acceptLabel: 'Approve',
    });
    if (approved) await this.submitPendingReview(review, 'approve');
  }

  protected async rejectPending(review: PendingPlanReview): Promise<void> {
    if (!this.canReviewPlans() || this.reviewing()) return;
    const sent = await firstValueFrom(
      this.dialogs.open<RejectDialogResult, RejectDialogData>(RejectDialogComponent, {
        data: { hallName: review.hallName } satisfies RejectDialogData,
        width: 'min(560px, 96vw)',
      }),
      { defaultValue: undefined },
    );
    if (sent) await this.submitPendingReview(review, 'reject', sent);
  }

  private async submitPendingReview(
    review: PendingPlanReview,
    action: 'approve' | 'reject',
    rejection?: RejectDialogResult,
  ): Promise<void> {
    if (this.reviewing()) return;
    this.reviewing.set({ eventHallId: review.eventHallId, action });
    try {
      const statuses = await firstValueFrom(this.plans.planStatuses(review.eventId));
      const hall = statuses.find((status) => status.eventHallId === review.eventHallId);
      if (!hall?.canApprove || hall.status !== 'pending' || !hall.review) {
        throw new Error('This plan is no longer waiting for approval. Refresh notifications and try again.');
      }

      if (action === 'approve') {
        await firstValueFrom(
          this.plans.approve(review.eventId, review.eventHallId, hall.review.revision),
        );
        this.notify.success('Plan approved', review.hallName);
      } else {
        if (!rejection) return;
        await firstValueFrom(
          this.plans.reject(
            review.eventId,
            review.eventHallId,
            hall.review.revision,
            rejection.note,
            rejection.files,
          ),
        );
        this.notify.success('Sent back to the organiser', review.hallName);
      }

      this.pendingReviews.update((items) =>
        items.filter((item) => item.eventHallId !== review.eventHallId),
      );
      this.pendingCountFallback.set(null);
      this.refreshPending();
    } catch (error) {
      this.notify.fromError(error, action === 'approve' ? 'The plan could not be approved' : 'The plan could not be rejected');
      this.refreshPending();
    } finally {
      this.reviewing.set(null);
    }
  }

  protected closeNotifications(menu: HTMLDetailsElement, event: Event): void {
    event.preventDefault();
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }

  protected closeNotificationsOnOutside(menu: HTMLDetailsElement, event: Event): void {
    if (event.target instanceof Node && !menu.contains(event.target)) {
      menu.open = false;
    }
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
    { label: 'Log out', icon: 'pi pi-sign-out', command: () => this.signOut() },
  ]);

  protected toggleCollapsed(): void {
    // Open for the person, even on a page that asked for the width.
    if (this.layout.focus() && this.compact()) this.layout.focus.set(false);
    const next = !this.compact();
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
      header: 'Log out',
      message: 'Log out of the portal?',
      acceptLabel: 'Log out',
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

const REVIEWS_SEEN_KEY = 'ems.reviews-seen-at';

function readSeenAt(): number {
  try {
    return Number(localStorage.getItem(REVIEWS_SEEN_KEY)) || 0;
  } catch {
    return 0;
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
