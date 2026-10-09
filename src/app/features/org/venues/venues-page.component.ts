import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { VenueView } from '../../../core/api/api.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { Notifier } from '../../../core/ui/notifier.service';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { VenueDialogComponent, VenueDialogData } from './venue-dialog.component';
import { AppDialog } from '../../../core/ui/app-dialog.service';

/** The organisation's venues; each holds the halls stalls are planned in. */
@Component({
  selector: 'app-venues-page',
  imports: [
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header heading="Venues" subheading="Exhibition grounds and the halls inside them.">
        @if (canManage()) {
          <button pButton (click)="create()"><app-icon name="add" />New venue</button>
        }
      </app-page-header>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (!loading() && !venues().length) {
        <div class="panel">
          <app-empty-state
            icon="location_city"
            heading="No venues yet"
            text="Add a venue, then draw its halls by size or import a venue JSON file."
          >
            @if (canManage()) {
              <button pButton (click)="create()">New venue</button>
            }
          </app-empty-state>
        </div>
      }

      <ul class="cards">
        @for (venue of venues(); track venue.id) {
          <li>
            <a class="card panel" [routerLink]="[venue.id]">
              <span class="icon" aria-hidden="true"><app-icon name="location_city" /></span>
              <span class="body">
                <span class="name">
                  {{ venue.name }}
                  @if (venue.code) {
                    <span class="status-chip is-neutral">{{ venue.code }}</span>
                  }
                </span>
                @if (venue.address) {
                  <span class="muted address">{{ venue.address }}</span>
                }
                <span class="muted"
                  >{{ venue.hallCount }} {{ venue.hallCount === 1 ? 'hall' : 'halls' }}</span
                >
              </span>
              <app-icon class="chevron" name="chevron_right" />
            </a>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 16px;
      color: inherit;
      text-decoration: none;
      height: 100%;
      box-sizing: border-box;
      transition: border-color 120ms;
      flex-direction: inherit;
    }
    .card:hover,
    .card:focus-visible {
      border-color: var(--app-primary);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      flex: none;
      border-radius: 12px;
      background: var(--app-secondary-container);
      color: var(--app-on-secondary-container);
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .name {
      font: var(--app-title-medium);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .address {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chevron {
      color: var(--app-on-surface-variant);
    }
  `,
})
export class VenuesPageComponent {
  private readonly api = inject(VenuesApi);
  private readonly dialog = inject(AppDialog);
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
    this.dialog.open<VenueView>(VenueDialogComponent, { data }).subscribe((venue?: VenueView) => {
      if (venue) {
        this.notifier.success(`${venue.name} created.`);
        void this.load();
      }
    });
  }
}
