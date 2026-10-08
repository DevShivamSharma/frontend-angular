import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
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
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule],
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
          @if (context.can('stalls.book') && ctx.membership.scope.exhibitorId) {
            <mat-card appearance="outlined">
              <mat-card-content>
                <mat-icon>add_business</mat-icon>
                <h2>Book a stall</h2>
                <p class="muted">
                  Your company's events, the free stalls of each hall, and your holds.
                </p>
              </mat-card-content>
              <mat-card-actions
                ><a mat-button [routerLink]="['portal']">Choose a stall</a></mat-card-actions
              >
            </mat-card>
          }
          @if (context.can('events.view')) {
            <mat-card appearance="outlined">
              <mat-card-content>
                <mat-icon>event</mat-icon>
                <h2>Events</h2>
                <p class="muted">
                  Events, the halls they book and their dates; internal or external.
                </p>
              </mat-card-content>
              <mat-card-actions
                ><a mat-button [routerLink]="['events']">Open events</a></mat-card-actions
              >
            </mat-card>
          }
          @if (context.can('team.view')) {
            <mat-card appearance="outlined">
              <mat-card-content>
                <mat-icon>group</mat-icon>
                <h2>Team</h2>
                <p class="muted">Who works here, with which role. Invite people.</p>
              </mat-card-content>
              <mat-card-actions
                ><a mat-button [routerLink]="['team']">Open team</a></mat-card-actions
              >
            </mat-card>
          }
          @if (context.can('org.settings.view')) {
            <mat-card appearance="outlined">
              <mat-card-content>
                <mat-icon>palette</mat-icon>
                <h2>Branding and details</h2>
                <p class="muted">Logo, colours, languages, invoice and email details.</p>
              </mat-card-content>
              <mat-card-actions
                ><a mat-button [routerLink]="['settings']">Open settings</a></mat-card-actions
              >
            </mat-card>
          }
        </div>

        @if (upcoming().length) {
          <section>
            <h2 class="section-title">Coming next</h2>
            <div class="upcoming">
              @for (card of upcoming(); track card.title) {
                <div class="module">
                  <mat-icon>{{ card.icon }}</mat-icon>
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
      font: var(--mat-sys-headline-medium);
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
    .quick mat-icon {
      color: var(--mat-sys-primary);
    }
    .quick h2 {
      font: var(--mat-sys-title-medium);
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
      background: var(--mat-sys-surface-container-low);
    }
    .module mat-icon {
      flex: none;
      color: var(--mat-sys-tertiary);
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
