import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { AuditApiService, AuditEntry } from '../../../audit/data/audit-api.service';

const PAGE_SIZE = 50;
const MAX_PAGES_PER_FETCH = 5;

/** The audit trail of one event, newest first. The audit endpoint is for ITPO staff. */
@Component({
  selector: 'app-event-activity-tab',
  imports: [DatePipe, ButtonModule, SkeletonModule, EmptyStateComponent],
  templateUrl: './event-activity-tab.component.html',
  styleUrl: './event-activity-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventActivityTabComponent {
  private readonly audit = inject(AuditApiService);
  private readonly notifier = inject(NotifierService);

  readonly eventId = input.required<string>();
  /** The audit endpoint filters by the event's name. */
  readonly eventName = input.required<string>();

  protected readonly items = signal<AuditEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly failed = signal(false);
  protected readonly forbidden = signal(false);
  private readonly actions = signal<Array<{ id: string; label: string }>>([]);
  private name = '';
  private page = 0;
  private loadedId = '';

  constructor() {
    // Loads again if the event changes; the load itself is not tracked.
    effect(() => {
      this.loadedId = this.eventId();
      this.name = this.eventName();
      untracked(() => void this.load());
    });
  }

  protected actionLabel(id: string): string {
    return this.actions().find((a) => a.id === id)?.label ?? id;
  }

  protected async load(): Promise<void> {
    this.items.set([]);
    this.hasMore.set(false);
    this.failed.set(false);
    this.forbidden.set(false);
    this.page = 0;
    // An empty name filter would return every entry of the audit trail.
    if (!this.name) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      this.actions.set(await firstValueFrom(this.audit.actions()).catch(() => []));
      await this.fetchNext();
    } catch (error) {
      this.fail(error);
    }
    this.loading.set(false);
  }

  protected async loadMore(): Promise<void> {
    this.loadingMore.set(true);
    try {
      await this.fetchNext();
    } catch (error) {
      this.notifier.fromError(error, 'More activity could not be loaded');
    }
    this.loadingMore.set(false);
  }

  /**
   * The name filter is a text match, so only the entries of this very event are kept. A page can
   * hold none of them (another event with a like name): read on, a few pages at most, until one
   * does or none are left, so "Load more" never sits under nothing.
   */
  private async fetchNext(): Promise<void> {
    for (let read = 0; read < MAX_PAGES_PER_FETCH; read++) {
      const page = await firstValueFrom(
        this.audit.list({ page: this.page + 1, size: PAGE_SIZE, event: this.name }),
      );
      this.page = page.page || this.page + 1;
      this.hasMore.set(this.page * PAGE_SIZE < page.total);
      const mine = page.items.filter((e) => e.event.id === this.loadedId);
      this.items.update((all) => [...all, ...mine]);
      if (mine.length || !this.hasMore()) return;
    }
  }

  private fail(error: unknown): void {
    this.hasMore.set(false);
    if (error instanceof ApiError && error.code === 403) this.forbidden.set(true);
    else this.failed.set(true);
  }
}
