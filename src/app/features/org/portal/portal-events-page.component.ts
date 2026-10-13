import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import { EVENT_STATUS_LABELS } from '../../../core/bookings/booking-rules';
import type { PortalEventView, PortalView } from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

/**
 * The exhibitor portal's first page: the events the exhibitor's company is registered for, and
 * each one's halls. Published halls — the actionable ones — come first; unpublished halls are
 * folded into a quiet summary so they never bury the halls an exhibitor can book at.
 */
@Component({
  selector: 'app-portal-events-page',
  imports: [
    DatePipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="My events"
        [subheading]="portal()?.exhibitor?.name ?? 'The events you can book stalls at.'"
      />

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="Your events could not be loaded" [text]="message">
            <button pButton (click)="load()"><app-icon name="restart_alt" />Try again</button>
          </app-empty-state>
        </div>
      } @else if (portal(); as p) {
        @if (p.closedReason) {
          <p class="notice" role="status"><app-icon name="lock" />{{ p.closedReason }}</p>
        }
        @if (!p.events.length) {
          <div class="panel">
            <app-empty-state
              icon="event"
              heading="No events yet"
              text="The organiser registers your company for an event. Once they do, it appears here."
            />
          </div>
        } @else {
          @for (e of p.events; track e.id) {
            <section class="event-card panel">
              <!-- Event header -->
              <div class="event-header">
                <div class="event-title-row">
                  <h2 class="event-name">{{ e.name }}</h2>
                  <span
                    class="status-chip"
                    [class.is-positive]="e.status === 'scheduled'"
                    [class.is-neutral]="e.status === 'draft'"
                    [class.is-warning]="e.status === 'cancelled'"
                    >{{ statusLabels[e.status] }}</span
                  >
                </div>
                <div class="event-meta">
                  <span class="meta-item">
                    <i class="pi pi-calendar meta-icon"></i>
                    {{ e.startsOn | date: 'd MMM y' }} – {{ e.endsOn | date: 'd MMM y' }}
                  </span>
                  @if (e.organiserName) {
                    <span class="meta-item">
                      <i class="pi pi-building meta-icon"></i>
                      {{ e.organiserName }}
                    </span>
                  }
                </div>
              </div>

              @if (e.closedReason) {
                <p class="notice" role="status"><app-icon name="info" />{{ e.closedReason }}</p>
              }

              <!-- Halls: published ones first — these are the actionable ones -->
              @if (!e.halls.length) {
                <p class="muted no-halls">No hall of this event is open for stalls yet.</p>
              } @else {
                @if (published(e).length) {
                  <div class="halls-section">
                    <div class="halls-section-label">
                      Available to book
                      <span class="halls-count">{{ published(e).length }}</span>
                    </div>
                    <ul class="halls">
                      @for (h of published(e); track h.hallId) {
                        <li>
                          <a
                            class="hall"
                            [routerLink]="['/', slug(), 'portal', 'events', e.id, 'halls', h.hallId]"
                          >
                            <span class="hall-name-row">
                              <app-icon name="meeting_room" />
                              <b class="hall-name">{{ h.name }}</b>
                            </span>
                            <span class="hall-actions">
                              <span class="stall-count" [class.has-free]="h.freeStalls > 0">
                                @if (h.freeStalls > 0) {
                                  {{ h.freeStalls }}
                                  {{ h.freeStalls === 1 ? 'stall' : 'stalls' }} free
                                } @else {
                                  All stalls taken
                                }
                              </span>
                              <span class="hall-cta">
                                Choose a stall
                                <app-icon name="arrow_forward" />
                              </span>
                            </span>
                          </a>
                        </li>
                      }
                    </ul>
                  </div>
                } @else {
                  <p class="muted no-halls">
                    No hall is open for booking yet. The organiser publishes a hall's stall plan
                    when it goes on sale.
                  </p>
                }

                <!-- Unpublished halls — a quiet summary, not a wall of dead rows -->
                @if (unpublished(e).length) {
                  <div class="halls-section">
                    <div class="halls-section-label dimmed">
                      Not yet published
                      <span class="halls-count">{{ unpublished(e).length }}</span>
                    </div>
                    <ul class="halls-dimmed">
                      @for (h of unpublished(e); track h.hallId) {
                        <li class="hall-dim-row">
                          <i class="pi pi-lock dim-icon"></i>
                          {{ h.name }}
                        </li>
                      }
                    </ul>
                  </div>
                }
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    /* ── Event card ── */
    .event-card {
      display: grid;
      gap: 20px;
    }

    .event-header {
      display: grid;
      gap: 4px;
    }

    .event-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .event-name {
      font: var(--app-title-large);
      margin: 0;
    }

    .event-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
    }

    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .meta-icon {
      font-size: 0.7rem;
    }

    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }

    .no-halls {
      margin: 0;
    }

    /* ── Halls sections ── */
    .halls-section {
      display: grid;
      gap: 8px;
    }

    .halls-section-label {
      font: var(--app-label-large);
      color: var(--app-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .halls-section-label.dimmed {
      opacity: 0.6;
    }

    .halls-count {
      font: var(--app-label-small);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }

    /* ── Published halls: the whole row is the way in ── */
    .halls {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .hall {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 16px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      color: inherit;
      text-decoration: none;
      transition:
        border-color 150ms ease,
        box-shadow 150ms ease;
    }

    .hall:hover,
    .hall:focus-visible {
      border-color: var(--app-primary);
      box-shadow: var(--app-level1);
    }

    .hall-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      color: var(--app-on-surface-variant);
    }

    .hall-name {
      font: var(--app-body-medium);
      font-weight: 600;
      color: var(--app-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hall-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .stall-count {
      font: var(--app-label-medium);
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--app-surface-container-highest);
      color: var(--app-on-surface-variant);
      white-space: nowrap;
    }

    .stall-count.has-free {
      background: color-mix(in srgb, #16a34a 12%, transparent);
      color: #16a34a;
    }

    .hall-cta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font: var(--app-label-large);
      color: var(--app-primary);
      white-space: nowrap;
    }

    .hall-cta app-icon {
      transition: transform 150ms ease;
    }

    .hall:hover .hall-cta app-icon {
      transform: translateX(3px);
    }

    /* ── Unpublished halls: de-emphasised chips ── */
    .halls-dimmed {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .hall-dim-row {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
      opacity: 0.65;
      border-radius: 6px;
      background: color-mix(in srgb, var(--app-on-surface) 4%, transparent);
    }

    .dim-icon {
      font-size: 0.6rem;
    }
  `,
})
export class PortalEventsPageComponent implements OnInit {
  private readonly api = inject(PortalApi);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly statusLabels = EVENT_STATUS_LABELS;
  protected readonly portal = signal<PortalView | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /** Published halls for an event — the ones with actionable stalls. */
  protected published(e: PortalEventView): PortalEventView['halls'] {
    return e.halls.filter((h) => h.published);
  }

  /** Unpublished halls — shown as a de-emphasised summary. */
  protected unpublished(e: PortalEventView): PortalEventView['halls'] {
    return e.halls.filter((h) => !h.published);
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.portal.set(await firstValueFrom(this.api.portal(this.slug())));
    } catch (error) {
      this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }
}
