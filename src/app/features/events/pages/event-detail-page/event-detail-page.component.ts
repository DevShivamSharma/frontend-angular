import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';

import { AuthService } from '../../../../core/auth/auth.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { EventDetailsCardComponent } from '../../components/event-details-card/event-details-card.component';
import { EventHallsTabComponent } from '../../components/event-halls-tab/event-halls-tab.component';
import { EventProgressComponent } from '../../components/event-progress/event-progress.component';
import { EventActivityTabComponent } from '../../components/event-activity-tab/event-activity-tab.component';
import { EventConfigTabComponent } from '../../components/event-config-tab/event-config-tab.component';
import { EventRulesTabComponent } from '../../components/event-rules-tab/event-rules-tab.component';
import { statusSeverity } from '../../domain/event-status';
import { EventDetailStore } from '../../state/event-detail.store';

/** One event: its details, its halls and its planning rules, each under its own tab. */
@Component({
  selector: 'app-event-detail-page',
  imports: [
    RouterLink,
    ButtonModule,
    SkeletonModule,
    TabsModule,
    TagModule,
    EmptyStateComponent,
    PageHeaderComponent,
    EventDetailsCardComponent,
    EventHallsTabComponent,
    EventActivityTabComponent,
    EventConfigTabComponent,
    EventProgressComponent,
    EventRulesTabComponent,
  ],
  providers: [EventDetailStore],
  templateUrl: './event-detail-page.component.html',
  styleUrl: './event-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailPageComponent implements OnInit {
  /** From the route. */
  readonly eventId = input.required<string>();
  /** The tab shown, from the address so a reload or a shared link opens the same one. */
  readonly tab = input('halls', {
    // The router sets an input to undefined when its query parameter is not in the address.
    transform: (value: string | undefined) => value ?? 'halls',
  });

  protected readonly store = inject(EventDetailStore);
  protected readonly auth = inject(AuthService);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  protected readonly severity = statusSeverity;
  /** What the booking setup still lacks, for its tab's badge (0 hides it). */
  protected readonly bookingIncomplete = signal(0);

  /** Back to the list the event belongs to. */
  protected readonly back = computed(() =>
    this.store.summary()?.kind === 'internal'
      ? { link: '/events', label: 'Internal events' }
      : { link: '/external-events', label: 'External events' },
  );

  /** Who it is for, its booking id, its dates and its type: what tells one event from another. */
  protected readonly subtitle = computed(() => {
    const event = this.store.summary();
    if (!event) {
      return '';
    }
    const day = (date: string | null) => (date ? formatDate(date, 'd MMM y', this.locale) : null);
    const dates = [day(event.startDate), day(event.endDate)].filter(Boolean).join(' – ');
    const organiser = event.organisation ? `Organised by ${event.organisation}` : null;
    return [organiser, event.bookingId, dates, event.eventType].filter(Boolean).join(' · ');
  });

  /** The stats beside the title: what the app knows about the event's halls. */
  protected readonly stalls = computed(() =>
    this.store.halls().reduce((total, hall) => total + hall.stallCount, 0),
  );
  private readonly rulesTab = viewChild(EventRulesTabComponent);

  constructor() {
    // The rules are read when their tab is first shown, however it was reached.
    effect(() => {
      if (this.tab() === 'rules') {
        this.rulesTab()?.ensureLoaded();
      }
    });
  }

  ngOnInit(): void {
    this.store.load(this.eventId());
  }

  /** The progress strip's button: the tab that does the next step. */
  protected readonly goToTab = (tab: string): void => this.onTab(tab);

  protected onTab(value: string | number | undefined): void {
    if (typeof value === 'string') {
      void this.router.navigate([], {
        queryParams: { tab: value === 'halls' ? null : value },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }
}
