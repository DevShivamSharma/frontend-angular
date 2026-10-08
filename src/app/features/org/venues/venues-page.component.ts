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
            <a class="card panel" [routerLink]="[venue.id]">
              <span class="icon" aria-hidden="true"><mat-icon>location_city</mat-icon></span>
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
              <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
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
    }
    .card:hover,
    .card:focus-visible {
      border-color: var(--mat-sys-primary);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      flex: none;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .name {
      font: var(--mat-sys-title-medium);
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
      color: var(--mat-sys-on-surface-variant);
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
    } catch (error) {
      this.notifier.error(error);
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
