import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { TagModule } from 'primeng/tag';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { UrlState } from '../../../../core/navigation/url-state';
import { AuthService } from '../../../../core/auth/auth.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { ImageFallbackDirective } from '../../../../shared/ui/placeholder-image/image-fallback.directive';
import { PLACEHOLDER_IMAGE } from '../../../../shared/ui/placeholder-image/placeholder-image';
import { CardSkeletonComponent } from '../../../../shared/ui/card-skeleton/card-skeleton.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { statusSeverity } from '../../domain/event-status';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';
import { EventListKind, EventSummary } from '../../data/events.models';

const PAGE_SIZE = 15;

/**
 * A list of events, internal (ITPO's own) or external (booked by organisations), as the route says.
 * ITPO staff see every external event; an organiser sees only those their organisation booked.
 */
@Component({
  selector: 'app-events-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    TitleCasePipe,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    PaginatorModule,
    TagModule,
    CardSkeletonComponent,
    ImageFallbackDirective,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './events-page.component.html',
  styleUrl: './events-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsPageComponent {
  private readonly api = inject(ItpoEventsApiService);
  private readonly auth = inject(AuthService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly placeholder = PLACEHOLDER_IMAGE;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly search = new FormControl('', { nonNullable: true });

  protected readonly isStaff = this.auth.isStaff;
  /** Which events this page lists; set by the route. */
  readonly kind = input.required<EventListKind>();
  protected readonly title = computed(() =>
    this.kind() === 'internal'
      ? 'Internal events'
      : this.isStaff()
        ? 'External events'
        : 'Your events',
  );
  protected readonly subtitle = computed(() =>
    this.kind() === 'internal'
      ? 'Events ITPO organises itself, and the halls and rules they use.'
      : this.isStaff()
        ? 'Events booked by organisations.'
        : 'The events your organisation has booked.',
  );
  /** Where an event of this list is opened: under the menu item it belongs to. */
  protected readonly base = computed(() =>
    this.kind() === 'internal' ? '/events' : '/external-events',
  );
  protected readonly canCreate = computed(() => this.isStaff() && this.kind() === 'internal');

  protected readonly events = signal<EventSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly first = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  private request: Subscription | null = null;
  private readonly url = new UrlState();
  /** The row a reloaded or shared address starts at, used once. */
  private startAt = this.url.firstRow('page', PAGE_SIZE);

  constructor() {
    this.search.setValue(this.url.text('q'), { emitEvent: false });
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetch(0));
    // The kind comes from the route, so it is read once it is set (and again if it changes).
    effect(() => {
      this.kind();
      untracked(() => {
        this.fetch(this.startAt);
        this.startAt = 0;
      });
    });
  }

  protected onPage(event: PaginatorState): void {
    this.fetch(event.first ?? 0);
    window.scrollTo({ top: 0 });
  }

  protected retry(): void {
    this.fetch(this.first());
  }

  protected readonly severity = statusSeverity;

  private fetch(first: number): void {
    this.request?.unsubscribe();
    this.first.set(first);
    this.url.write({ q: this.search.value.trim(), page: Math.floor(first / PAGE_SIZE) + 1 });
    this.loading.set(true);
    this.failed.set(false);
    this.request = this.api
      .events({
        kind: this.kind(),
        page: Math.floor(first / PAGE_SIZE) + 1,
        size: PAGE_SIZE,
        keyword: this.search.value.trim() || undefined,
      })
      .subscribe({
        next: (page) => {
          this.events.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.events.set([]);
          this.notifier.fromError(error, 'The events could not be loaded');
        },
      });
  }
}
