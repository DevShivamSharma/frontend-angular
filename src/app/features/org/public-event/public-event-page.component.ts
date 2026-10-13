import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import { errorMessage, httpStatus } from '../../../core/api/http-error';
import { PublicOrgStore } from '../../../core/org/org.stores';
import { PublicEventsApi } from '../../../core/public-events/public-events-api.service';
import type { PublicEventView } from '../../../core/public-events/public-events.models';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { formatDays } from '../events/event-dates';
import { PublicBarComponent } from './public-bar.component';

/**
 * An event as anyone with the link sees it: when it is, whether stalls can be booked, and its
 * halls with how many stalls are free. No sign-in; nothing about who booked what.
 */
@Component({
  selector: 'app-public-event-page',
  imports: [
    DecimalPipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    PublicBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-bar />
    <main class="page">
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      } @else if (loadError(); as message) {
        <div class="panel">
          <app-empty-state icon="error" heading="This event could not be opened" [text]="message">
            @if (!notFound()) {
              <button pButton (click)="load()"><app-icon name="restart_alt" />Try again</button>
            }
          </app-empty-state>
        </div>
      } @else if (view(); as v) {
        <app-page-header
          [heading]="v.event.name"
          [subheading]="
            (v.event.organiserName ? 'Organised by ' + v.event.organiserName + ' · ' : '') + days(v)
          "
        >
          <span meta class="chips">
            <span
              class="status-chip"
              [class.is-positive]="v.bookingOpen"
              [class.is-neutral]="!v.bookingOpen"
            >
              {{ v.bookingOpen ? 'Booking open' : 'Booking closed' }}
            </span>
          </span>
        </app-page-header>

        @if (v.closedReason) {
          <p class="notice" role="status"><app-icon name="info" />{{ v.closedReason }}</p>
        }

        <section class="panel">
          <h2 class="section-title">
            Halls <span class="count">{{ v.halls.length }}</span>
          </h2>
          @if (!v.halls.length) {
            <app-empty-state
              icon="meeting_room"
              heading="No stall map yet"
              text="The organiser has not published the stall plan of any hall yet. Check back soon."
            />
          } @else {
            <ul class="halls">
              @for (h of v.halls; track h.hallId) {
                <li>
                  <a class="hall" [routerLink]="['halls', h.hallId]">
                    <span class="hall-top">
                      <span class="hall-icon" aria-hidden="true"
                        ><app-icon name="meeting_room"
                      /></span>
                      <b>{{ h.name }}</b>
                    </span>
                    <span class="muted"
                      >{{ h.floorArea | number: '1.0-0' }} m² · {{ h.width | number: '1.0-1' }} ×
                      {{ h.depth | number: '1.0-1' }} m</span
                    >
                    <span class="hall-foot">
                      <span
                        class="status-chip"
                        [class.is-positive]="h.freeStalls > 0"
                        [class.is-neutral]="h.freeStalls === 0"
                      >
                        {{ h.freeStalls }} of {{ h.totalStalls }} stalls free
                      </span>
                      <span class="open">View map <app-icon name="chevron_right" /></span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .notice {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 12px;
      border-radius: 12px;
      background: var(--app-surface-container-high);
    }
    .count {
      font: var(--app-label-medium);
      color: var(--app-on-surface-variant);
    }
    .halls {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .hall {
      display: grid;
      gap: 8px;
      padding: 16px;
      height: 100%;
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid var(--app-outline-variant);
      color: inherit;
      text-decoration: none;
    }
    .hall:hover,
    .hall:focus-visible {
      background: var(--app-surface-container-high);
    }
    .hall-top,
    .hall-foot {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .hall-foot {
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .hall-icon {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--app-primary-container);
      color: var(--app-on-primary-container);
    }
    .open {
      display: inline-flex;
      align-items: center;
      color: var(--app-primary);
      font: var(--app-label-large);
    }
  `,
})
export class PublicEventPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(PublicEventsApi);
  private readonly org = inject(PublicOrgStore).config;

  protected readonly view = signal<PublicEventView | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** An unknown or unpublished event has nothing to retry. */
  protected readonly notFound = signal(false);

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => void this.load());
    });
  }

  protected days(v: PublicEventView): string {
    return formatDays(v.event.startsOn, v.event.endsOn);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    try {
      this.view.set(await firstValueFrom(this.api.event(this.org()?.slug ?? '', this.eventId())));
    } catch (error) {
      this.notFound.set(httpStatus(error) === 404);
      this.loadError.set(errorMessage(error, 'Something went wrong. Please try again.'));
    } finally {
      this.loading.set(false);
    }
  }
}
