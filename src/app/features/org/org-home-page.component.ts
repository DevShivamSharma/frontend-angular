import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../shared/icon.component';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OrgContextStore } from '../../core/org/org.stores';

interface ModuleCard {
  title: string;
  icon: string;
  text: string;
  permission: string;
}

/** What comes next, shown to the roles that will use it. */
const UPCOMING: ModuleCard[] = [
  {
    title: 'Venues and halls',
    icon: 'map',
    text: 'Manage venues and halls, draw halls by size, or import venue JSON files.',
    permission: 'venues.view',
  },
  {
    title: 'Stall layouts',
    icon: 'grid_view',
    text: 'Draft stalls with CAD tools, import an architect’s PDF, review and publish.',
    permission: 'layouts.view',
  },
  {
    title: 'Pricing',
    icon: 'sell',
    text: 'Rate cards by area, category, corner and open sides.',
    permission: 'pricing.view',
  },
  {
    title: 'Bookings',
    icon: 'confirmation_number',
    text: 'Holds, bookings and payments, in your own portal or through your system.',
    permission: 'bookings.view',
  },
];

@Component({
  selector: 'app-org-home-page',
  imports: [RouterLink, ButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.context(); as ctx) {
      <div class="page">
        <header>
          <h1>Welcome, {{ firstName() }}</h1>
          <p class="muted">
            You are {{ ctx.membership.role.name }} at {{ ctx.organisation.name }}.
          </p>
        </header>

        <div class="quick">
          @if (context.eventScoped()) {
            <div class="card">
              <div class="card-body">
                <app-icon name="event" />
                <h2>My events</h2>
                <p class="muted">The halls you plan stalls on, and the rules for each hall.</p>
              </div>
              <div class="card-actions">
                <a pButton [text]="true" [routerLink]="['events']">Open my events</a>
              </div>
            </div>
          } @else if (context.can('events.view')) {
            <div class="card">
              <div class="card-body">
                <app-icon name="event" />
                <h2>Events</h2>
                <p class="muted">
                  Your own events, and organisers’ events on the halls they booked.
                </p>
              </div>
              <div class="card-actions">
                <a pButton [text]="true" [routerLink]="['events', 'internal']">Internal</a>
                <a pButton [text]="true" [routerLink]="['events', 'external']">External</a>
              </div>
            </div>
          }
          @if (context.can('team.view')) {
            <div class="card">
              <div class="card-body">
                <app-icon name="group" />
                <h2>Team</h2>
                <p class="muted">Who works here, with which role. Invite people.</p>
              </div>
              <div class="card-actions">
                <a pButton [text]="true" [routerLink]="['team']">Open team</a>
              </div>
            </div>
          }
          @if (context.can('org.settings.view')) {
            <div class="card">
              <div class="card-body">
                <app-icon name="palette" />
                <h2>Branding and details</h2>
                <p class="muted">Logo, colours, languages, invoice and email details.</p>
              </div>
              <div class="card-actions">
                <a pButton [text]="true" [routerLink]="['settings']">Open settings</a>
              </div>
            </div>
          }
        </div>

        @if (upcoming().length) {
          <section>
            <h2 class="section-title">Coming next</h2>
            <div class="upcoming">
              @for (card of upcoming(); track card.title) {
                <div class="module">
                  <app-icon [name]="card.icon" />
                  <div>
                    <b>{{ card.title }}</b>
                    <p class="muted">{{ card.text }}</p>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: `
    h1 {
      font: var(--app-headline-medium);
    }
    header p {
      margin: 4px 0 0;
    }
    .quick,
    .upcoming {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .quick app-icon {
      color: var(--app-primary);
    }
    .quick h2 {
      font: var(--app-title-medium);
      margin: 8px 0 4px;
    }
    .quick p,
    .module p {
      margin: 0;
    }
    .module {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-radius: 12px;
      background: var(--app-surface-container-low);
    }
    .module app-icon {
      flex: none;
      color: var(--app-tertiary);
    }
  `,
})
export class OrgHomePageComponent {
  protected readonly context = inject(OrgContextStore);
  private readonly user = inject(AuthService).user;

  protected readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  protected readonly upcoming = computed(() =>
    UPCOMING.filter((card) => this.context.can(card.permission)),
  );
}
