import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { eventScoped, isOpen } from '../../../core/events/event-rules';
import { EventsApi } from '../../../core/events/events-api.service';
import type { EventView, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { ExhibitorDialogComponent, ExhibitorDialogData } from './exhibitor-dialog.component';

/**
 * The companies that take stalls, and the events they are registered for. Seeing them needs
 * `bookings.view`; every change `bookings.manage`. Event-scoped members see only the
 * exhibitors of their own events.
 */
@Component({
  selector: 'app-exhibitors-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    EmptyStateComponent,
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
          <button mat-flat-button (click)="create()">
            <mat-icon>add_business</mat-icon>New exhibitor
          </button>
        }
      </app-page-header>

      <section class="panel panel-flush" aria-label="Exhibitors">
        <div class="toolbar">
          @if (canSeeEvents()) {
            <mat-form-field class="inline-field event-filter">
              <mat-label>Event</mat-label>
              <mat-select [value]="eventFilter()" (selectionChange)="setEvent($event.value)">
                <mat-option value="">Every event</mat-option>
                @for (event of events(); track event.id) {
                  <mat-option [value]="event.id">{{ event.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <span class="count muted" aria-live="polite"
            >{{ exhibitors().length }}
            {{ exhibitors().length === 1 ? 'exhibitor' : 'exhibitors' }}</span
          >
        </div>

        <div class="progress">
          @if (loading()) {
            <mat-progress-bar mode="indeterminate" />
          }
        </div>

        @if (exhibitors().length) {
          <div class="table-wrap">
            <table mat-table [dataSource]="exhibitors()">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Company</th>
                <td mat-cell *matCellDef="let x">
                  <span class="company">
                    <b>{{ x.name }}</b>
                    @if (x.gstin) {
                      <code class="muted">GSTIN {{ x.gstin }}</code>
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="contact">
                <th mat-header-cell *matHeaderCellDef>Contact</th>
                <td mat-cell *matCellDef="let x">
                  <span class="contact">
                    @if (x.contactName) {
                      <span>{{ x.contactName }}</span>
                    } @else {
                      <span class="muted">No contact name</span>
                    }
                    @if (x.email) {
                      <span class="muted">{{ x.email }}</span>
                    }
                    @if (x.phone) {
                      <span class="muted">{{ x.phone }}</span>
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="events">
                <th mat-header-cell *matHeaderCellDef>Events</th>
                <td mat-cell *matCellDef="let x">
                  <span class="chips">
                    @for (id of x.eventIds; track id) {
                      @if (eventsById().get(id); as event) {
                        <a
                          class="status-chip is-neutral"
                          [routerLink]="['/', slug(), 'events', id]"
                          >{{ event.name }}</a
                        >
                      }
                    } @empty {
                      <span class="muted">None</span>
                    }
                    @if (unnamedEvents(x); as count) {
                      <span class="muted">{{ count }} {{ count === 1 ? 'event' : 'events' }}</span>
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef>
                  <span class="cdk-visually-hidden">Actions</span>
                </th>
                <td mat-cell *matCellDef="let x" class="actions-cell">
                  <button
                    mat-icon-button
                    [matMenuTriggerFor]="rowMenu"
                    [matMenuTriggerData]="{ x: x }"
                    [attr.aria-label]="'Actions for ' + x.name"
                  >
                    <mat-icon>more_vert</mat-icon>
                  </button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns()"></tr>
              <tr mat-row *matRowDef="let row; columns: columns()"></tr>
            </table>
          </div>
        } @else if (failed()) {
          <app-empty-state
            icon="cloud_off"
            heading="The exhibitors could not be loaded"
            text="Check your connection, then try again."
          >
            <button mat-stroked-button (click)="load()">Try again</button>
          </app-empty-state>
        } @else if (loaded()) {
          @if (eventFilter()) {
            <app-empty-state
              icon="filter_alt_off"
              heading="No exhibitors registered for this event"
              text="Clear the filter to see exhibitors for every event."
            >
              <button mat-stroked-button (click)="setEvent('')">Show all events</button>
            </app-empty-state>
          } @else {
            <app-empty-state
              icon="storefront"
              heading="No exhibitors yet"
              [text]="
                canManage()
                  ? 'Add the first company that takes stalls, then register it for events.'
                  : 'Exhibitors appear here once they are added.'
              "
            >
              @if (canManage()) {
                <button mat-flat-button (click)="create()">New exhibitor</button>
              }
            </app-empty-state>
          }
        }
      </section>

      <mat-menu #rowMenu="matMenu" xPosition="before">
        <ng-template matMenuContent let-x="x">
          <button mat-menu-item (click)="edit(x)"><mat-icon>edit</mat-icon>Edit</button>
          @if (canSeeEvents()) {
            <button
              mat-menu-item
              [matMenuTriggerFor]="registerMenu"
              [matMenuTriggerData]="{ x: x }"
            >
              <mat-icon>how_to_reg</mat-icon>Register for an event
            </button>
          }
          @if (wholeOrganisation()) {
            <span
              [matTooltip]="x.eventIds.length ? 'Unregister it from its events first' : ''"
              matTooltipPosition="left"
            >
              <button
                mat-menu-item
                class="danger"
                [disabled]="x.eventIds.length > 0"
                (click)="remove(x)"
              >
                <mat-icon>delete</mat-icon>Delete
              </button>
            </span>
          }
        </ng-template>
      </mat-menu>
      <mat-menu #registerMenu="matMenu">
        <ng-template matMenuContent let-x="x">
          @for (event of registrable(x); track event.id) {
            <button mat-menu-item (click)="register(x, event)">{{ event.name }}</button>
          } @empty {
            <button mat-menu-item disabled>No other draft or scheduled events</button>
          }
        </ng-template>
      </mat-menu>
    </div>
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 18px 22px;
      border-bottom: 1px solid var(--card-border);
    }
    .event-filter {
      flex: 0 1 320px;
      --mat-form-field-container-height: 40px;
      --mat-form-field-container-vertical-padding: 8px;
    }
    .count {
      margin-left: auto;
      font: var(--mat-sys-label-large);
    }
    .progress {
      height: 4px;
    }
    .company,
    .contact {
      display: grid;
      gap: 2px;
      padding: 6px 0;
    }
    /* The company name leads its row, in the display face. */
    .company b {
      font-family: var(--app-display-font);
      font-size: 1.0625rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    code {
      font-size: 12px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    a.status-chip {
      text-decoration: none;
      transition:
        border-color 150ms ease-out,
        color 150ms ease-out;
    }
    a.status-chip:hover {
      border-color: var(--mat-sys-primary);
      color: var(--mat-sys-primary);
    }
    .actions-cell {
      width: 56px;
      text-align: right;
    }
    .mat-mdc-cell:first-child,
    .mat-mdc-header-cell:first-child {
      padding-left: 20px;
    }
    .mat-mdc-menu-item.danger {
      color: var(--mat-sys-error);
    }
    @media (max-width: 700px) {
      .count {
        margin-left: 0;
        width: 100%;
      }
    }
  `,
})
export class ExhibitorsPageComponent {
  private readonly api = inject(ExhibitorsApi);
  private readonly eventsApi = inject(EventsApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly exhibitors = signal<ExhibitorView[]>([]);
  protected readonly events = signal<EventView[]>([]);
  protected readonly eventFilter = signal('');
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);

  protected readonly slug = computed(() => this.context.slug());
  protected readonly canManage = computed(() => this.context.can('bookings.manage'));
  protected readonly canSeeEvents = computed(() => this.context.can('events.view'));
  /** Deleting exhibitors is for members of the whole organisation. */
  protected readonly wholeOrganisation = computed(() => {
    const ctx = this.context.context();
    return !!ctx && !eventScoped(ctx.membership);
  });
  protected readonly columns = computed(() =>
    this.canManage() ? ['name', 'contact', 'events', 'actions'] : ['name', 'contact', 'events'],
  );
  protected readonly eventsById = computed(() => new Map(this.events().map((e) => [e.id, e])));
  /** Exhibitors join draft and scheduled events only. */
  private readonly openEvents = computed(() => this.events().filter((e) => isOpen(e.status)));

  constructor() {
    void this.load();
    void this.loadEvents();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.exhibitors.set(
        await firstValueFrom(this.api.exhibitors(this.slug(), this.eventFilter() || undefined)),
      );
      this.loaded.set(true);
    } catch {
      // The error interceptor has shown it.
      this.exhibitors.set([]);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEvents(): Promise<void> {
    if (!this.canSeeEvents()) return;
    try {
      this.events.set(await firstValueFrom(this.eventsApi.events(this.slug())));
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected setEvent(eventId: string): void {
    this.eventFilter.set(eventId);
    void this.load();
  }

  /** Registrations to events the member cannot list (without `events.view`). */
  protected unnamedEvents(exhibitor: ExhibitorView): number {
    return exhibitor.eventIds.filter((id) => !this.eventsById().has(id)).length;
  }

  protected registrable(exhibitor: ExhibitorView): EventView[] {
    return this.openEvents().filter((e) => !exhibitor.eventIds.includes(e.id));
  }

  protected create(): void {
    const scoped = !this.wholeOrganisation();
    const data: ExhibitorDialogData = {
      slug: this.slug(),
      events: this.openEvents(),
      eventId: this.eventFilter() || undefined,
      eventRequired: scoped ? 'You can add exhibitors to your own events only' : undefined,
    };
    this.dialog
      .open(ExhibitorDialogComponent, { data, maxWidth: '95vw' })
      .afterClosed()
      .subscribe((saved?: ExhibitorView) => {
        if (saved) {
          this.notifier.success(`${saved.name} created.`);
          void this.load();
        }
      });
  }

  protected edit(exhibitor: ExhibitorView): void {
    const data: ExhibitorDialogData = { slug: this.slug(), exhibitor, events: [] };
    this.dialog
      .open(ExhibitorDialogComponent, { data, maxWidth: '95vw' })
      .afterClosed()
      .subscribe((saved?: ExhibitorView) => {
        if (saved) {
          this.notifier.success(`${saved.name} saved.`);
          void this.load();
        }
      });
  }

  protected async register(exhibitor: ExhibitorView, event: EventView): Promise<void> {
    try {
      await firstValueFrom(this.api.register(this.slug(), event.id, exhibitor.id));
      this.notifier.success(`${exhibitor.name} registered for ${event.name}.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async remove(exhibitor: ExhibitorView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${exhibitor.name}?`,
      message: 'The company and its contact details are removed. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteExhibitor(this.slug(), exhibitor.id));
      this.notifier.success(`${exhibitor.name} deleted.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    }
  }
}
