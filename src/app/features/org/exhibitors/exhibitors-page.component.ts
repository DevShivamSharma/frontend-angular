import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventView, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { ExhibitorDialogComponent, ExhibitorDialogData } from './exhibitor-dialog.component';
import {
  ExhibitorPeopleDialogComponent,
  ExhibitorPeopleDialogData,
} from './exhibitor-people-dialog.component';

/**
 * The companies that take stalls, and the events they are registered for (ported from
 * `@feature/rules`). Seeing them needs `bookings.view`, changing them `bookings.manage`;
 * organisers see only the exhibitors of their own events and delete none.
 */
@Component({
  selector: 'app-exhibitors-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    SelectModule,
    TableModule,
    TooltipModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Exhibitors"
        subheading="Companies that take stalls, and the events they are registered for."
      >
        @if (canManage()) {
          <button pButton (click)="create()"><app-icon name="add_business" />New exhibitor</button>
        }
      </app-page-header>

      <div class="toolbar">
        <p-select
          inputId="exhibitors-event"
          ariaLabel="Event"
          [options]="eventOptions()"
          optionLabel="name"
          optionValue="id"
          [ngModel]="eventFilter()"
          (ngModelChange)="setEvent($event)"
        />
        <span class="muted" aria-live="polite"
          >{{ exhibitors().length }} {{ exhibitors().length === 1 ? 'exhibitor' : 'exhibitors' }}</span
        >
      </div>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (failed()) {
        <div class="panel">
          <app-empty-state
            icon="error"
            heading="The exhibitors could not be loaded"
            text="Check your connection, then try again."
          >
            <button pButton [outlined]="true" (click)="load()">Try again</button>
          </app-empty-state>
        </div>
      } @else if (!loading() && !exhibitors().length) {
        <div class="panel">
          @if (eventFilter()) {
            <app-empty-state
              icon="search_off"
              heading="No exhibitor is registered for this event"
              text="Register exhibitors on the event's page, or show every event."
            >
              <button pButton [outlined]="true" (click)="setEvent('')">Every event</button>
            </app-empty-state>
          } @else {
            <app-empty-state
              icon="storefront"
              heading="No exhibitors yet"
              [text]="
                canManage()
                  ? 'Add the companies that take stalls, then register them for events.'
                  : 'Exhibitors appear here once they are added.'
              "
            />
          }
        </div>
      }

      @if (exhibitors().length) {
        <div class="table-wrap">
          <p-table [value]="exhibitors()" [paginator]="exhibitors().length > 25" [rows]="25">
            <ng-template #header>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Events</th>
                <th><span class="visually-hidden">Actions</span></th>
              </tr>
            </ng-template>
            <ng-template #body let-x>
              <tr>
                <td>
                  <b>{{ x.name }}</b>
                  @if (x.gstin) {
                    <br /><span class="muted small">GSTIN {{ x.gstin }}</span>
                  }
                </td>
                <td>
                  {{ x.contactName ?? '' }}
                  @if (x.email) {
                    <br /><span class="muted small">{{ x.email }}</span>
                  }
                  @if (x.phone) {
                    <br /><span class="muted small">{{ x.phone }}</span>
                  }
                </td>
                <td>
                  <span class="chips">
                    @for (id of x.eventIds; track id) {
                      @if (eventsById().get(id); as e) {
                        <a class="status-chip is-neutral" [routerLink]="['/', slug(), 'events', id]">{{
                          e.name
                        }}</a>
                      }
                    } @empty {
                      <span class="muted">None</span>
                    }
                  </span>
                </td>
                <td class="actions">
                  <button
                    pButton
                    [text]="true"
                    [rounded]="true"
                    (click)="people(x)"
                    [attr.aria-label]="'People of ' + x.name"
                    pTooltip="People who book for it"
                  >
                    <app-icon name="group" />
                  </button>
                  @if (canManage()) {
                    <button
                      pButton
                      [text]="true"
                      [rounded]="true"
                      (click)="edit(x)"
                      [attr.aria-label]="'Edit ' + x.name"
                      pTooltip="Edit"
                    >
                      <app-icon name="edit" />
                    </button>
                    @if (!eventScoped()) {
                      <button
                        pButton
                        [text]="true"
                        [rounded]="true"
                        severity="danger"
                        (click)="remove(x)"
                        [disabled]="x.eventIds.length > 0"
                        [attr.aria-label]="'Delete ' + x.name"
                        [pTooltip]="
                          x.eventIds.length ? 'Registered for events: take it off them first' : 'Delete'
                        "
                      >
                        <app-icon name="delete" />
                      </button>
                    }
                  }
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      }
    </div>
  `,
  styles: `
    .toolbar {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    a.status-chip {
      text-decoration: none;
    }
    .small {
      font: var(--app-body-small);
    }
    .actions {
      text-align: right;
      white-space: nowrap;
    }
  `,
})
export class ExhibitorsPageComponent {
  private readonly api = inject(ExhibitorsApi);
  private readonly eventsApi = inject(EventsApi);
  private readonly dialog = inject(AppDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly eventScoped = this.context.eventScoped;
  protected readonly canManage = computed(() => this.context.can('bookings.manage'));
  protected readonly exhibitors = signal<ExhibitorView[]>([]);
  protected readonly events = signal<EventView[]>([]);
  protected readonly eventFilter = signal('');
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly eventsById = computed(() => new Map(this.events().map((e) => [e.id, e])));
  protected readonly eventOptions = computed(() => [
    { id: '', name: 'Every event' },
    ...this.events(),
  ]);
  /** Exhibitors join drafts and scheduled events only. */
  private readonly openEvents = computed(() =>
    this.events().filter((e) => e.status === 'draft' || e.status === 'scheduled'),
  );

  constructor() {
    void this.load();
    void this.loadEvents();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.exhibitors.set(
        await firstValueFrom(this.api.list(this.slug(), this.eventFilter() || undefined)),
      );
    } catch {
      // The error interceptor has shown it.
      this.exhibitors.set([]);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEvents(): Promise<void> {
    if (!this.context.can('events.view')) return;
    try {
      this.events.set(await firstValueFrom(this.eventsApi.events(this.slug())));
    } catch {
      // The error interceptor has shown it; the filter then offers every event only.
    }
  }

  protected setEvent(eventId: string | null): void {
    this.eventFilter.set(eventId ?? '');
    void this.load();
  }

  protected create(): void {
    const data: ExhibitorDialogData = {
      slug: this.slug(),
      events: this.openEvents(),
      eventRequired: this.eventScoped(),
    };
    this.dialog
      .open<ExhibitorView>(ExhibitorDialogComponent, { data, width: 'min(640px, 96vw)' })
      .subscribe((saved) => {
        if (!saved) return;
        this.notifier.success(`${saved.name} added.`);
        void this.load();
      });
  }

  protected edit(exhibitor: ExhibitorView): void {
    const data: ExhibitorDialogData = {
      slug: this.slug(),
      exhibitor,
      events: [],
      eventRequired: false,
    };
    this.dialog
      .open<ExhibitorView>(ExhibitorDialogComponent, { data, width: 'min(640px, 96vw)' })
      .subscribe((saved) => {
        if (!saved) return;
        this.notifier.success(`${saved.name} saved.`);
        void this.load();
      });
  }

  protected people(exhibitor: ExhibitorView): void {
    const data: ExhibitorPeopleDialogData = {
      slug: this.slug(),
      exhibitor,
      canInvite: this.canManage(),
    };
    this.dialog.open(ExhibitorPeopleDialogComponent, { data });
  }

  protected async remove(exhibitor: ExhibitorView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${exhibitor.name}?`,
      message: 'The company and its contact details go. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.delete(this.slug(), exhibitor.id));
      this.notifier.success(`${exhibitor.name} deleted.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }
}
