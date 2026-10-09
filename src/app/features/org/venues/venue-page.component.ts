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
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
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
import { CsvImportDialogComponent, CsvImportDialogData } from './csv-import-dialog.component';
import { VenueDialogComponent, VenueDialogData } from './venue-dialog.component';
import { ImportTourComponent } from '../../../shared/import-tour/import-tour.component';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { CheckboxModule } from 'primeng/checkbox';
import { PopoverModule } from 'primeng/popover';
import { FormsModule } from '@angular/forms';

/** One venue and its halls, with the ways to add a hall. */
@Component({
  selector: 'app-venue-page',
  imports: [
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    EmptyStateComponent,
    PageHeaderComponent,
    ImportTourComponent,
    CheckboxModule,
    PopoverModule,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a pButton [text]="true" class="back" [routerLink]="['..']"
        ><app-icon name="arrow_back" />Venues</a
      >
      @if (venue(); as v) {
        <app-page-header [heading]="v.name" [subheading]="v.address ?? ''">
          @if (canImport()) {
            <app-import-tour
              mode="choose"
              [compact]="true"
              [canLocate]="false"
              (launch)="startImport($event)"
            />
          }
          @if (canManage()) {
            <button pButton [outlined]="true" (click)="editVenue(v)">
              <app-icon name="edit" />Edit
            </button>
            <button
              pButton
              [text]="true"
              severity="danger"
              (click)="deleteVenue(v)"
              [disabled]="halls().length > 0"
              [title]="halls().length ? 'Only a venue without halls can be deleted' : ''"
            >
              <app-icon name="delete" />Delete
            </button>
          }
          @if (canAdd()) {
            <button
              pButton
              type="button"
              icon="pi pi-plus"
              label="Add hall"
              aria-haspopup="menu"
              (click)="addMenu.toggle($event)"
            ></button>
          }
        </app-page-header>
      }

      <p-popover #addMenu>
        <div class="add-menu" role="menu">
          @if (canManage()) {
            <button
              type="button"
              class="menu-item"
              role="menuitem"
              (click)="addMenu.hide(); createHall()"
            >
              <app-icon name="crop_free" />
              <span class="item"
                ><b>Draw by size</b><span class="muted">Width × depth in metres</span></span
              >
            </button>
          }
          @if (canImport()) {
            <a class="menu-item" role="menuitem" [routerLink]="['import-floor-plan']"
              ><app-icon name="map" /><span class="item"
                ><b>Import from floor plan</b
                ><span class="muted">PDF, DXF or scanned image · review in Three.js</span></span
              ></a
            >
            <button
              type="button"
              class="menu-item"
              role="menuitem"
              (click)="addMenu.hide(); importCsv()"
            >
              <app-icon name="table_view" />
              <span class="item"
                ><b>Import from CSV</b
                ><span class="muted">Convert a venue CSV file into halls</span></span
              >
            </button>
          }
        </div>
      </p-popover>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (!loading() && venue() && !halls().length) {
        <div class="panel">
          <app-empty-state
            icon="grid_on"
            heading="No halls in this venue"
            text="Draw a hall by its size or import halls from a venue CSV file."
          >
            @if (canManage()) {
              <button pButton (click)="createHall()">Draw by size</button>
            }
            @if (canImport()) {
              <button pButton [outlined]="true" (click)="importCsv()">Import from CSV</button>
            }
          </app-empty-state>
        </div>
      }

      @if (halls().length) {
        <div class="row list-bar" [class.selecting]="selecting()">
          @if (selecting()) {
            <span class="check">
              <p-checkbox
                inputId="halls-select-all"
                [binary]="true"
                [ngModel]="allSelected()"
                [indeterminate]="selected().size > 0 && !allSelected()"
                (ngModelChange)="selectAll($event)"
              />
              <label for="halls-select-all"
                >{{ selected().size }} of {{ halls().length }} selected</label
              >
            </span>
            <span class="spacer"></span>
            <button pButton [text]="true" (click)="stopSelecting()">Cancel</button>
            <button
              pButton
              severity="danger"
              [disabled]="!selected().size || busy()"
              (click)="deleteSelected()"
            >
              <app-icon name="delete" />Delete {{ selected().size || '' }}
            </button>
          } @else {
            <span class="muted"
              >{{ halls().length }} {{ halls().length === 1 ? 'hall' : 'halls' }}</span
            >
            <span class="spacer"></span>
            @if (canManage()) {
              <button pButton [text]="true" (click)="selecting.set(true)">
                <app-icon name="checklist" />Select
              </button>
            }
          }
        </div>
        <ul class="halls">
          @for (hall of halls(); track hall.id) {
            <li>
              @if (selecting()) {
                <label class="hall panel" [class.checked]="selected().has(hall.id)">
                  <p-checkbox
                    [binary]="true"
                    [ngModel]="selected().has(hall.id)"
                    (ngModelChange)="toggle(hall.id, $event)"
                    [ariaLabel]="'Select ' + hall.name"
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
              {{ hall.source.system.toUpperCase() }} import ·
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
    .add-menu {
      display: grid;
      min-width: 300px;
    }
    .item {
      display: grid;
      line-height: 1.3;
      padding: 2px 0;
    }
    .item .muted {
      font: var(--app-body-small);
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
      background: var(--app-secondary-container);
      color: var(--app-on-secondary-container);
      box-shadow: var(--app-level2);
    }
    label.hall {
      cursor: pointer;
    }
    .hall.checked {
      border-color: var(--app-primary);
      box-shadow: inset 0 0 0 1px var(--app-primary);
      background: var(--app-surface-container-high);
    }
    .hall:hover,
    .hall:focus-visible {
      border-color: var(--app-primary);
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
      fill: var(--app-primary-container);
      stroke: var(--app-primary);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .body {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font: var(--app-title-medium);
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .facts {
      font-variant-numeric: tabular-nums;
    }
    .small {
      font: var(--app-body-small);
    }
  `,
})
export class VenuePageComponent implements OnInit {
  /** From the route. */
  readonly venueId = input.required<string>();

  private readonly api = inject(VenuesApi);
  private readonly dialog = inject(AppDialog);
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
    } catch {
      // The error interceptor has shown it.
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
    } catch {
      // The error interceptor has shown it; show what is left.
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
      .open<HallView>(HallDialogComponent, { data, width: 'min(1100px, 96vw)' })
      .subscribe((hall?: HallView) => {
        if (hall) {
          this.notifier.success(`${hall.name} created.`);
          void this.router.navigate([...this.venueLink(), 'halls', hall.id]);
        }
      });
  }

  protected startImport(mode: 'pdf' | 'csv'): void {
    if (mode === 'csv') this.importCsv();
    else void this.router.navigate([...this.venueLink(), 'import-floor-plan']);
  }
  protected importCsv(): void {
    const data: CsvImportDialogData = {
      slug: this.context.slug(),
      venueId: this.venueId(),
      venueName: this.venue()?.name ?? 'this venue',
    };
    this.dialog
      .open<boolean>(CsvImportDialogComponent, {
        data,
        width: 'min(1100px, 96vw)',
        dismissable: false,
      })
      .subscribe((saved?: boolean) => {
        if (saved) void this.load();
      });
  }

  protected editVenue(venue: VenueView): void {
    const data: VenueDialogData = { slug: this.context.slug(), venue };
    this.dialog.open<VenueView>(VenueDialogComponent, { data }).subscribe((saved?: VenueView) => {
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
    } catch {
      // The error interceptor has shown it.
    }
  }

  private venueLink(): string[] {
    return ['/', this.context.slug(), 'venues', this.venueId()];
  }
}
