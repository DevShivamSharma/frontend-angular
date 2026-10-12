import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import { EVENT_STATUS_LABELS } from '../../../core/bookings/booking-rules';
import type { PortalView } from '../../../core/bookings/bookings.models';
import { PortalApi } from '../../../core/bookings/portal-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

/**
 * The exhibitor portal's first page: the events the exhibitor's company is registered for, and
 * each one's halls. A hall opens on its published plan, where free stalls are held.
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
            <section class="panel">
              <div class="head">
                <h2 class="section-title">{{ e.name }}</h2>
                <span
                  class="status-chip"
                  [class.is-positive]="e.status === 'scheduled'"
                  [class.is-neutral]="e.status === 'draft'"
                  [class.is-warning]="e.status === 'cancelled'"
                  >{{ statusLabels[e.status] }}</span
                >
              </div>
              <p class="muted small">
                {{ e.startsOn | date: 'd MMM y' }} - {{ e.endsOn | date: 'd MMM y' }}
                @if (e.organiserName) {
                  · organised by {{ e.organiserName }}
                }
              </p>
              @if (e.closedReason) {
                <p class="notice" role="status"><app-icon name="info" />{{ e.closedReason }}</p>
              }
              @if (!e.halls.length) {
                <p class="muted">No hall of this event is open for stalls yet.</p>
              } @else {
                <ul class="halls">
                  @for (h of e.halls; track h.hallId) {
                    <li class="hall">
                      <b>{{ h.name }}</b>
                      @if (h.published) {
                        <span class="muted"
                          >{{ h.freeStalls }}
                          {{ h.freeStalls === 1 ? 'stall' : 'stalls' }} free</span
                        >
                        <a
                          pButton
                          [outlined]="true"
                          [routerLink]="['/', slug(), 'portal', 'events', e.id, 'halls', h.hallId]"
                          >Choose a stall</a
                        >
                      } @else {
                        <span class="muted">Not published yet</span>
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .head .section-title {
      margin: 0;
    }
    .small {
      margin: 4px 0 12px;
      font: var(--app-body-small);
    }
    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0 0 12px;
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
    .halls {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .hall {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 8px 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
    }
    .hall b {
      flex: 1;
      min-width: 0;
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
