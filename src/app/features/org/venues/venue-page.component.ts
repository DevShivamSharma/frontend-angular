import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { HallView, VenueView } from '../../../core/api/api.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { HallDialogComponent, HallDialogData } from './hall-dialog.component';
import { ItpoImportDialogComponent, ItpoImportDialogData } from './itpo-import-dialog.component';
import { VenueDialogComponent, VenueDialogData } from './venue-dialog.component';

/** One venue and its halls, with the ways to add a hall. */
@Component({
  selector: 'app-venue-page',
  imports: [
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a mat-button class="back" [routerLink]="['..']"><mat-icon>arrow_back</mat-icon>Venues</a>
      @if (venue(); as v) {
        <app-page-header [heading]="v.name" [subheading]="v.address ?? ''">
          @if (canManage()) {
            <button mat-stroked-button (click)="editVenue(v)"><mat-icon>edit</mat-icon>Edit</button>
            <button
              mat-button
              class="danger"
              (click)="deleteVenue(v)"
              [disabled]="halls().length > 0"
              [title]="halls().length ? 'Only a venue without halls can be deleted' : ''"
            >
              <mat-icon>delete</mat-icon>Delete
            </button>
          }
          @if (canAdd()) {
            <button mat-flat-button [matMenuTriggerFor]="addMenu">
              <mat-icon>add</mat-icon>Add hall
            </button>
          }
        </app-page-header>
      }

      <mat-menu #addMenu="matMenu" xPosition="before" class="add-hall-menu">
        @if (canManage()) {
          <button mat-menu-item (click)="createHall()">
            <mat-icon>crop_free</mat-icon>
            <span class="item"
              ><b>Draw by size</b
              ><span class="muted">No floor plan: width × depth in metres</span></span
            >
          </button>
        }
        @if (canImport()) {
          <button mat-menu-item (click)="importItpo()">
            <mat-icon>table_view</mat-icon>
            <span class="item"
              ><b>Import from ITPO</b
              ><span class="muted">T_HALL_LAYOUTS export, CSV or JSON</span></span
            >
          </button>
          <a mat-menu-item [routerLink]="['import-plan']">
            <mat-icon>picture_as_pdf</mat-icon>
            <span class="item"
              ><b>Import a floor plan</b
              ><span class="muted">PDF, DXF or image: the grid becomes the floor</span></span
            >
          </a>
        }
      </mat-menu>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (!loading() && venue() && !halls().length) {
        <div class="panel">
          <app-empty-state
            icon="grid_on"
            heading="No halls in this venue"
            text="Import the hall's floor plan, draw it by its size when there is no plan, or import halls from ITPO."
          >
            @if (canManage()) {
              <button mat-flat-button (click)="createHall()">Draw by size</button>
            }
            @if (canImport()) {
              <a mat-stroked-button [routerLink]="['import-plan']">Import a floor plan</a>
              <button mat-stroked-button (click)="importItpo()">Import from ITPO</button>
            }
          </app-empty-state>
        </div>
      }

      @if (halls().length) {
        <div class="row list-bar" [class.selecting]="selecting()">
          @if (selecting()) {
            <mat-checkbox
              [checked]="allSelected()"
              [indeterminate]="selected().size > 0 && !allSelected()"
              (change)="selectAll($event.checked)"
              >{{ selected().size }} of {{ halls().length }} selected</mat-checkbox
            >
            <span class="spacer"></span>
            <button mat-button (click)="stopSelecting()">Cancel</button>
            <button
              mat-flat-button
              class="danger"
              [disabled]="!selected().size || busy()"
              (click)="deleteSelected()"
            >
              <mat-icon>delete</mat-icon>Delete {{ selected().size || '' }}
            </button>
          } @else {
            <span class="muted"
              >{{ halls().length }} {{ halls().length === 1 ? 'hall' : 'halls' }}</span
            >
            <span class="spacer"></span>
            @if (canManage()) {
              <button mat-button (click)="selecting.set(true)">
                <mat-icon>checklist</mat-icon>Select
              </button>
            }
          }
        </div>
        <ul class="halls">
          @for (hall of halls(); track hall.id) {
            <li>
              @if (selecting()) {
                <label class="hall panel" [class.checked]="selected().has(hall.id)">
                  <mat-checkbox
                    [checked]="selected().has(hall.id)"
                    (change)="toggle(hall.id, $event.checked)"
                    [aria-label]="'Select ' + hall.name"
                  />
                  <ng-container
                    [ngTemplateOutlet]="hallCard"
                    [ngTemplateOutletContext]="{ $implicit: hall }"
                  />
                </label>
              } @else {
                <a class="hall panel" [routerLink]="['halls', hall.id]">
                  <ng-container
                    [ngTemplateOutlet]="hallCard"
                    [ngTemplateOutletContext]="{ $implicit: hall }"
                  />
                </a>
              }
            </li>
          }
        </ul>
      }

      <ng-template #hallCard let-hall>
        <span class="shape" aria-hidden="true">
          <svg
            [attr.viewBox]="'0 0 ' + hall.width + ' ' + hall.depth"
            preserveAspectRatio="xMidYMid meet"
          >
            <rect [attr.width]="hall.width" [attr.height]="hall.depth" />
          </svg>
        </span>
        <span class="body">
          <span class="name">
            {{ hall.name }}
            @if (hall.code) {
              <span class="status-chip is-neutral">{{ hall.code }}</span>
            }
          </span>
          <span class="muted facts">
            {{ hall.width | number: '1.0-2' }} × {{ hall.depth | number: '1.0-2' }} m ·
            {{ hall.floorArea | number: '1.0-0' }} m² open
            @if (hall.level) {
              · {{ hall.level }}
            }
          </span>
          <span class="muted small">
            @if (hall.source) {
              ITPO hall {{ hall.source.externalId }} ·
            }
            Version {{ hall.currentVersion }} · updated
            {{ hall.updatedAt | date: 'd MMM y' }}
          </span>
        </span>
      </ng-template>
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .item {
      display: grid;
      line-height: 1.3;
      padding: 4px 0;
    }
    .item .muted {
      font: var(--mat-sys-body-small);
    }
    .halls {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .hall {
      display: flex;
      gap: 16px;
      align-items: center;
      color: inherit;
      text-decoration: none;
      height: 100%;
      box-sizing: border-box;
    }
    .list-bar {
      min-height: 44px;
      margin-bottom: -8px;
    }
    .list-bar.selecting {
      position: sticky;
      top: env(safe-area-inset-top, 0px);
      z-index: 2;
      padding: 4px 8px 4px 4px;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      box-shadow: var(--mat-sys-level2);
    }
    label.hall {
      cursor: pointer;
    }
    .hall.checked {
      border-color: var(--mat-sys-primary);
      box-shadow: inset 0 0 0 1px var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-high);
    }
    .hall:hover,
    .hall:focus-visible {
      border-color: var(--mat-sys-primary);
    }
    .shape {
      flex: none;
      width: 72px;
      height: 56px;
    }
    .shape svg {
      width: 100%;
      height: 100%;
    }
    .shape rect {
      fill: var(--mat-sys-primary-container);
      stroke: var(--mat-sys-primary);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font: var(--mat-sys-title-medium);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .facts {
      font-variant-numeric: tabular-nums;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class VenuePageComponent implements OnInit {
  /** From the route. */
  readonly venueId = input.required<string>();

  private readonly api = inject(VenuesApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly venue = signal<VenueView | null>(null);
  protected readonly halls = signal<HallView[]>([]);
  protected readonly loading = signal(false);
  protected readonly canManage = computed(() => this.context.can('venues.manage'));
  protected readonly canImport = computed(() => this.context.can('halls.import'));
  protected readonly canAdd = computed(() => this.canManage() || this.canImport());

  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly allSelected = computed(
    () => this.halls().length > 0 && this.selected().size === this.halls().length,
  );

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const slug = this.context.slug();
      const [venue, halls] = await Promise.all([
        firstValueFrom(this.api.venue(slug, this.venueId())),
        firstValueFrom(this.api.halls(slug, this.venueId())),
      ]);
      this.venue.set(venue);
      this.halls.set(halls);
    } catch (error) {
      this.notifier.error(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(hallId: string, on: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (on) next.add(hallId);
      else next.delete(hallId);
      return next;
    });
  }

  protected selectAll(on: boolean): void {
    this.selected.set(on ? new Set(this.halls().map((h) => h.id)) : new Set());
  }

  protected stopSelecting(): void {
    this.selecting.set(false);
    this.selected.set(new Set());
  }

  protected async deleteSelected(): Promise<void> {
    const ids = [...this.selected()];
    const names = this.halls()
      .filter((h) => this.selected().has(h.id))
      .map((h) => h.name);
    const shown =
      names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
    const confirmed = await this.confirm.confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'hall' : 'halls'}?`,
      message: `${shown}. Each hall and all its floor versions are deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      const { deleted } = await firstValueFrom(
        this.api.deleteHalls(this.context.slug(), this.venueId(), ids),
      );
      this.notifier.success(`${deleted} ${deleted === 1 ? 'hall' : 'halls'} deleted.`);
      this.stopSelecting();
      await this.load();
    } catch (error) {
      this.notifier.error(error);
      await this.load();
      this.selected.update(
        (s) => new Set([...s].filter((id) => this.halls().some((h) => h.id === id))),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected createHall(): void {
    const data: HallDialogData = { slug: this.context.slug(), venueId: this.venueId() };
    this.dialog
      .open(HallDialogComponent, { data })
      .afterClosed()
      .subscribe((hall?: HallView) => {
        if (hall) {
          this.notifier.success(`${hall.name} created.`);
          void this.router.navigate([...this.venueLink(), 'halls', hall.id]);
        }
      });
  }

  protected importItpo(): void {
    const data: ItpoImportDialogData = {
      slug: this.context.slug(),
      venueId: this.venueId(),
      venueName: this.venue()?.name ?? 'this venue',
    };
    this.dialog
      .open(ItpoImportDialogComponent, { data, maxWidth: '760px', width: '95vw' })
      .afterClosed()
      .subscribe((saved?: boolean) => {
        if (saved) void this.load();
      });
  }

  protected editVenue(venue: VenueView): void {
    const data: VenueDialogData = { slug: this.context.slug(), venue };
    this.dialog
      .open(VenueDialogComponent, { data })
      .afterClosed()
      .subscribe((saved?: VenueView) => {
        if (saved) this.venue.set(saved);
      });
  }

  protected async deleteVenue(venue: VenueView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${venue.name}?`,
      message: 'The venue has no halls. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteVenue(this.context.slug(), venue.id));
      this.notifier.success(`${venue.name} deleted.`);
      void this.router.navigate(['/', this.context.slug(), 'venues']);
    } catch (error) {
      this.notifier.error(error);
    }
  }

  private venueLink(): string[] {
    return ['/', this.context.slug(), 'venues', this.venueId()];
  }
}
