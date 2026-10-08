import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { VenueView } from '../../../core/api/api.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { Notifier } from '../../../core/ui/notifier.service';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { VenueDialogComponent, VenueDialogData } from './venue-dialog.component';

/** The organisation's venues; each holds the halls stalls are planned in. */
@Component({
  selector: 'app-venues-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header heading="Venues" subheading="Exhibition grounds and the halls inside them.">
        @if (canManage()) {
          <button mat-flat-button (click)="create()"><mat-icon>add</mat-icon>New venue</button>
        }
      </app-page-header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (!loading() && !venues().length) {
        <div class="panel">
          <app-empty-state
            icon="location_city"
            heading="No venues yet"
            text="Add a venue, then draw its halls by size or import a venue JSON file."
          >
            @if (canManage()) {
              <button mat-flat-button (click)="create()">New venue</button>
            }
          </app-empty-state>
        </div>
      }

      <ul class="cards">
        @for (venue of venues(); track venue.id) {
          <li>
            <a class="card panel card-link" [routerLink]="[venue.id]">
              <span class="card-top">
                <span class="card-icon" aria-hidden="true"><mat-icon>location_city</mat-icon></span>
                @if (venue.code) {
                  <span class="status-chip is-neutral">{{ venue.code }}</span>
                }
              </span>
              <span class="body">
                <span class="name">{{ venue.name }}</span>
                @if (venue.address) {
                  <span class="muted address">{{ venue.address }}</span>
                }
              </span>
              <span class="card-foot">
                <span class="count"
                  >{{ venue.hallCount }}
                  <span class="muted">{{ venue.hallCount === 1 ? 'hall' : 'halls' }}</span></span
                >
                <mat-icon class="go" aria-hidden="true">arrow_forward</mat-icon>
              </span>
            </a>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    /* A gapless grid: with an odd count the first venue takes the whole first row. */
    .cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-auto-flow: dense;
      gap: 16px;
    }
    @media (min-width: 760px) {
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .cards > li:first-child:nth-last-child(odd) {
        grid-column: 1 / -1;
      }
    }
    /* Lift, edge and corner glow on hover come from the shared card-link class. */
    .card {
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 18px;
      min-height: 210px;
      height: 100%;
      box-sizing: border-box;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .body {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .name {
      font-family: var(--app-display-font);
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }
    .address {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-foot {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    /* The number of halls, large, in the display face. */
    .count {
      font-family: var(--app-display-font);
      font-size: 2rem;
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
    }
    .count .muted {
      margin-left: 4px;
      font: var(--mat-sys-body-large);
      letter-spacing: 0;
    }
    .go {
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      transition:
        transform 200ms ease-out,
        color 200ms ease-out;
    }
    .card:hover .go,
    .card:focus-visible .go {
      transform: translateX(4px);
      color: var(--mat-sys-primary);
    }
    @media (prefers-reduced-motion: reduce) {
      .go {
        transition: none;
      }
      .card:hover .go,
      .card:focus-visible .go {
        transform: none;
      }
    }
  `,
})
export class VenuesPageComponent {
  private readonly api = inject(VenuesApi);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly venues = signal<VenueView[]>([]);
  protected readonly loading = signal(false);
  protected readonly canManage = computed(() => this.context.can('venues.manage'));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.venues.set(await firstValueFrom(this.api.venues(this.context.slug())));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected create(): void {
    const data: VenueDialogData = { slug: this.context.slug() };
    this.dialog
      .open(VenueDialogComponent, { data })
      .afterClosed()
      .subscribe((venue?: VenueView) => {
        if (venue) {
          this.notifier.success(`${venue.name} created.`);
          void this.load();
        }
      });
  }
}
