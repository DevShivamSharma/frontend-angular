import { DatePipe, DecimalPipe } from '@angular/common';
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
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type {
  FloorAreaKind,
  FloorVersionView,
  HallDetailView,
  HallFloor,
  HallView,
} from '../../../core/api/api.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import {
  AREA_COLORS,
  AREA_LABELS,
  FloorViewComponent,
  geometryArea,
} from '../../../shared/floor/floor-view.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { HallDialogComponent, HallDialogData } from './hall-dialog.component';

const SOURCE_LABELS: Record<FloorVersionView['source'], string> = {
  blank: 'Drawn by size',
  itpo: 'Imported from ITPO',
  restore: 'Restored',
  drawing: 'Imported from a plan',
  json: 'Imported from JSON',
  csv: 'Imported from CSV',
};

/** One hall: its floor to scale, what blocks stalls on it, and its floor versions. */
@Component({
  selector: 'app-hall-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    FloorViewComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (hall(); as h) {
        <a mat-button class="back" [routerLink]="['/', slug(), 'venues', h.venue.id]">
          <mat-icon>arrow_back</mat-icon>{{ h.venue.name }}
        </a>
        <app-page-header [heading]="h.name">
          <span meta class="meta">
            @if (h.code) {
              <span class="status-chip is-neutral">{{ h.code }}</span>
            }
            @if (h.level) {
              <span class="status-chip is-neutral">{{ h.level }}</span>
            }
            @if (h.source) {
              <span class="status-chip">{{ h.source.system.toUpperCase() }} import</span>
            }
          </span>
          @if (canManage()) {
            <button mat-stroked-button (click)="edit(h)">
              <mat-icon>edit</mat-icon>Edit details
            </button>
            <button mat-button class="danger" (click)="remove(h)">
              <mat-icon>delete</mat-icon>Delete
            </button>
          }
        </app-page-header>
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (hall(); as h) {
        <div class="layout">
          <section class="panel plan" aria-label="Floor plan">
            <div class="row plan-bar">
              <span class="facts">
                <b
                  >{{ shown().width | number: '1.0-2' }} ×
                  {{ shown().depth | number: '1.0-2' }} m</b
                >
                @if (viewing() === h.currentVersion) {
                  <span class="muted">
                    · {{ h.floorArea | number: '1.0-0' }} m² open for stalls</span
                  >
                }
              </span>
              <span class="spacer"></span>
              @if (viewing() !== h.currentVersion) {
                <span class="status-chip is-warning">Viewing version {{ viewing() }}</span>
                <button mat-button (click)="viewVersion(h.currentVersion)">Back to current</button>
              }
              <mat-slide-toggle [checked]="labels()" (change)="labels.set($event.checked)">
                Labels
              </mat-slide-toggle>
            </div>
            <app-floor-view [floor]="shown()" [showLabels]="labels()" />
          </section>

          <aside class="side">
            <section class="panel">
              <h2 class="section-title">On this floor</h2>
              @if (kinds().length) {
                <ul class="kinds">
                  @for (k of kinds(); track k.kind) {
                    <li>
                      <span class="swatch" [style.background]="k.color"></span>
                      <span>{{ k.label }}</span>
                      <span class="spacer"></span>
                      <span class="muted count">{{ k.count }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="muted">Open floor: nothing blocks stalls.</p>
              }
              @if (zones().length) {
                <h3 class="subtitle">Foyers</h3>
                <ul class="kinds">
                  @for (z of zones(); track z.id) {
                    <li>
                      <span class="swatch zone"></span>
                      <span>{{ z.name }}</span>
                      @if (z.kind === 'circulation') {
                        <span class="muted">circulation</span>
                      }
                      @if (z.shared) {
                        <span class="status-chip is-neutral">Shared</span>
                      }
                      <span class="spacer"></span>
                      <span class="muted count">{{ z.area | number: '1.0-0' }} m²</span>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="panel">
              <h2 class="section-title">Floor versions</h2>
              <ol class="versions" reversed>
                @for (v of h.versions; track v.version) {
                  <li [class.active]="v.version === viewing()">
                    <div class="v-head">
                      <b>Version {{ v.version }}</b>
                      @if (v.current) {
                        <span class="status-chip is-positive">Current</span>
                      }
                    </div>
                    <span class="muted small">
                      {{ versionText(v) }}<br />
                      {{ v.createdAt | date: 'd MMM y, HH:mm'
                      }}{{ v.createdBy ? ' · ' + v.createdBy.name : '' }}
                    </span>
                    <div class="v-actions">
                      @if (v.version !== viewing()) {
                        <button mat-button (click)="viewVersion(v.version)">View</button>
                      }
                      @if (!v.current && canManage()) {
                        <button mat-button (click)="restore(v)">Restore</button>
                      }
                    </div>
                  </li>
                }
              </ol>
            </section>
          </aside>
        </div>
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 16px;
      align-items: start;
    }
    .plan-bar {
      margin-bottom: 12px;
    }
    .facts {
      font-variant-numeric: tabular-nums;
    }
    .side {
      display: grid;
      gap: 16px;
    }
    .kinds,
    .versions {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .kinds li {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      flex: none;
      border: 1px solid rgb(0 0 0 / 0.2);
    }
    .count {
      font-variant-numeric: tabular-nums;
    }
    .subtitle {
      font: var(--mat-sys-title-small);
      margin: 16px 0 8px;
    }
    .swatch.zone {
      background: #4aa9db;
    }
    .versions li {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .versions li.active {
      border-color: var(--mat-sys-primary);
    }
    .v-head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .v-actions {
      display: flex;
      gap: 4px;
      margin: 4px -8px -6px;
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class HallPageComponent implements OnInit {
  /** From the route. */
  readonly hallId = input.required<string>();

  private readonly api = inject(VenuesApi);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly hall = signal<HallDetailView | null>(null);
  /** The floor on screen: the current one, or an older version being looked at. */
  private readonly other = signal<{ version: number; floor: HallFloor } | null>(null);
  protected readonly loading = signal(false);
  protected readonly labels = signal(true);
  protected readonly canManage = computed(() => this.context.can('venues.manage'));

  protected readonly viewing = computed(
    () => this.other()?.version ?? this.hall()?.currentVersion ?? 0,
  );
  protected readonly shown = computed(() => this.other()?.floor ?? this.hall()!.floor);
  protected readonly kinds = computed(() => {
    const counts = new Map<FloorAreaKind, number>();
    for (const area of this.shown().geometry?.objects ?? this.shown().areas) {
      if (area.kind !== 'outside') counts.set(area.kind, (counts.get(area.kind) ?? 0) + 1);
    }
    return [...counts].map(([kind, count]) => ({
      kind,
      count,
      label: AREA_LABELS[kind],
      color: AREA_COLORS[kind],
    }));
  });
  /** The foyers and circulation saved with the floor, measured from their own outlines. */
  protected readonly zones = computed(() =>
    (this.shown().geometry?.zones ?? []).map((z) => ({ ...z, area: geometryArea(z.geometry) })),
  );

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.hall.set(await firstValueFrom(this.api.hall(this.slug(), this.hallId())));
      this.other.set(null);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  /** Where a version came from, and its note when the note says more than that. */
  protected versionText(v: FloorVersionView): string {
    const label = SOURCE_LABELS[v.source] ?? v.source;
    return v.note && v.note.toLowerCase() !== label.toLowerCase() ? `${label} — ${v.note}` : label;
  }

  protected async viewVersion(version: number): Promise<void> {
    const hall = this.hall();
    if (!hall) return;
    if (version === hall.currentVersion) {
      this.other.set(null);
      return;
    }
    try {
      this.other.set(await firstValueFrom(this.api.floorVersion(this.slug(), hall.id, version)));
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async restore(version: FloorVersionView): Promise<void> {
    const hall = this.hall();
    if (!hall) return;
    const confirmed = await this.confirm.confirm({
      title: `Restore version ${version.version}?`,
      message: `Its floor becomes version ${hall.currentVersion + 1}, the current one. Nothing is lost: every version stays.`,
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    try {
      this.hall.set(
        await firstValueFrom(this.api.restoreVersion(this.slug(), hall.id, version.version)),
      );
      this.other.set(null);
      this.notifier.success(`Version ${version.version} restored.`);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected edit(hall: HallDetailView): void {
    const manual =
      hall.floor.geometry?.source.documentId === 'manual' ||
      hall.versions.find((v) => v.current)?.source === 'blank';
    const data: HallDialogData = {
      slug: this.slug(),
      venueId: hall.venue.id,
      hall,
      ...(manual ? { floor: hall.floor } : {}),
    };
    this.dialog
      .open(HallDialogComponent, { data, ...(manual ? { width: '1100px', maxWidth: '95vw' } : {}) })
      .afterClosed()
      .subscribe((saved?: HallView) => {
        if (saved) void this.load();
      });
  }

  protected async remove(hall: HallDetailView): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${hall.name}?`,
      message: 'The hall and all its floor versions are deleted. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteHall(this.slug(), hall.id));
      this.notifier.success(`${hall.name} deleted.`);
      void this.router.navigate(['/', this.slug(), 'venues', hall.venue.id]);
    } catch {
      // The error interceptor has shown it.
    }
  }
}
