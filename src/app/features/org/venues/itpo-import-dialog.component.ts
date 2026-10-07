import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import type { ItpoImportResult, ItpoImportRowView } from '../../../core/api/api.models';
import { errorMessage } from '../../../core/api/http-error';
import { ItpoFile, VenuesApi } from '../../../core/venues/venues-api.service';

export interface ItpoImportDialogData {
  slug: string;
  venueId: string;
  venueName: string;
}

/** Mirrors the server's limit (ITPO's whole export is under 2 MB). */
const MAX_FILE_BYTES = 12_000_000;

interface Choice {
  row: ItpoImportRowView;
  selected: boolean;
  name: string;
}

/**
 * Imports halls from an export of ITPO's `T_HALL_LAYOUTS` (CSV or JSON). Shows what each row
 * would become before anything is saved; a hall imported before gets a new floor version
 * instead of a copy. Closes with true when anything was saved.
 */
@Component({
  selector: 'app-itpo-import-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Import halls from ITPO</h2>
    <mat-dialog-content>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (result(); as r) {
        <p>
          Into {{ data.venueName }}: {{ r.created.length }} created, {{ r.updated.length }} updated
          with a new floor version, {{ r.unchanged.length }} already up to date.
        </p>
      } @else if (!choices().length) {
        <p class="muted">
          Choose an export of the <code>T_HALL_LAYOUTS</code> table (CSV with all columns, or the
          JSON SelfCare's API returns). Each row becomes one hall in {{ data.venueName }}.
        </p>
        <label
          class="drop"
          [class.over]="dragOver()"
          (dragover)="$event.preventDefault(); dragOver.set(true)"
          (dragleave)="dragOver.set(false)"
          (drop)="drop($event)"
        >
          <mat-icon aria-hidden="true">upload_file</mat-icon>
          <span><b>Choose a file</b> or drop it here</span>
          <span class="muted">.csv or .json, up to 12 MB</span>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            (change)="pick($event)"
          />
        </label>
      } @else {
        <p class="muted">
          {{ fileName() }} — {{ choices().length }} rows. Untick a hall to leave it out; names can
          be changed now or later.
        </p>
        <ul class="rows">
          @for (c of choices(); track c.row.externalId) {
            <li [class.failed]="c.row.error">
              <mat-checkbox
                [checked]="c.selected"
                [disabled]="!!c.row.error"
                (change)="toggle(c, $event.checked)"
                [aria-label]="'Import ITPO hall ' + c.row.externalId"
              />
              <div class="row-body">
                <div class="row-head">
                  <mat-form-field class="inline-field name">
                    <mat-label>Hall name</mat-label>
                    <input
                      matInput
                      [ngModel]="c.name"
                      (ngModelChange)="rename(c, $event)"
                      [disabled]="!!c.row.error"
                      maxlength="120"
                    />
                  </mat-form-field>
                  <span class="status-chip is-neutral">ITPO {{ c.row.externalId }}</span>
                  @if (c.row.existing; as e) {
                    <span class="status-chip" [class.is-positive]="e.sameFloor">
                      {{ e.sameFloor ? 'Already up to date' : 'New version of ' + e.name }}
                    </span>
                  }
                </div>
                @if (c.row.error) {
                  <p class="error">{{ c.row.error }}</p>
                } @else {
                  <p class="muted facts">
                    {{ c.row.width }} × {{ c.row.depth }} m ·
                    {{ c.row.floorArea | number: '1.0-0' }} m² open floor ·
                    {{ blocked(c.row) }} areas · {{ c.row.labels }} labels ·
                    {{ c.row.iconGroups }} icon groups
                  </p>
                  @for (w of c.row.warnings; track $index) {
                    <p class="warning"><mat-icon inline>warning</mat-icon> {{ w }}</p>
                  }
                }
              </div>
            </li>
          }
        </ul>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (result()) {
        <button mat-flat-button [mat-dialog-close]="true">Done</button>
      } @else {
        @if (choices().length) {
          <button mat-button type="button" (click)="reset()">Other file</button>
        }
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button (click)="submit()" [disabled]="busy() || !selectedCount()">
          Import {{ selectedCount() || '' }} {{ selectedCount() === 1 ? 'hall' : 'halls' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: min(640px, 85vw);
    }
    .drop {
      position: relative;
      display: grid;
      justify-items: center;
      gap: 4px;
      padding: 32px 16px;
      border: 2px dashed var(--mat-sys-outline-variant);
      border-radius: 16px;
      cursor: pointer;
      text-align: center;
    }
    .drop.over,
    .drop:focus-within {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }
    .drop input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .rows {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 8px;
    }
    .rows li {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 12px 8px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .rows li.failed {
      opacity: 0.75;
    }
    .row-body {
      flex: 1;
      min-width: 0;
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .name {
      flex: 1 1 220px;
    }
    .facts,
    .warning,
    .error {
      margin: 6px 0 0;
    }
    .facts {
      font-variant-numeric: tabular-nums;
    }
    .warning {
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ItpoImportDialogComponent {
  protected readonly data = inject<ItpoImportDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(VenuesApi);
  private readonly ref = inject(MatDialogRef<ItpoImportDialogComponent, boolean>);

  private file: ItpoFile | null = null;
  protected readonly fileName = signal('');
  protected readonly choices = signal<Choice[]>([]);
  protected readonly result = signal<ItpoImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly selectedCount = computed(
    () => this.choices().filter((c) => c.selected && c.name.trim()).length,
  );

  constructor() {
    this.ref.backdropClick().subscribe(() => this.ref.close(!!this.result()));
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.read(file);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.read(file);
  }

  private async read(file: File): Promise<void> {
    this.error.set(null);
    if (file.size > MAX_FILE_BYTES) {
      this.error.set('The file is larger than 12 MB.');
      return;
    }
    const format = /\.json$/i.test(file.name) || file.type === 'application/json' ? 'json' : 'csv';
    this.busy.set(true);
    try {
      this.file = { format, content: await file.text() };
      const preview = await firstValueFrom(
        this.api.previewItpo(this.data.slug, this.data.venueId, this.file),
      );
      this.fileName.set(file.name);
      this.choices.set(
        preview.rows.map((row) => ({
          row,
          selected: !row.error && !row.existing?.sameFloor,
          name: row.existing?.name ?? row.name,
        })),
      );
    } catch (error) {
      this.file = null;
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(choice: Choice, selected: boolean): void {
    this.choices.update((all) => all.map((c) => (c === choice ? { ...c, selected } : c)));
  }

  protected rename(choice: Choice, name: string): void {
    this.choices.update((all) => all.map((c) => (c.row === choice.row ? { ...c, name } : c)));
  }

  protected blocked(row: ItpoImportRowView): number {
    if (!row.counts) return 0;
    return Object.entries(row.counts)
      .filter(([kind]) => kind !== 'outside')
      .reduce((sum, [, n]) => sum + n, 0);
  }

  protected reset(): void {
    this.file = null;
    this.choices.set([]);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    if (!this.file) return;
    const halls = this.choices()
      .filter((c) => c.selected && c.name.trim())
      .map((c) => ({ externalId: c.row.externalId, name: c.name.trim(), code: null, level: null }));
    this.busy.set(true);
    this.error.set(null);
    try {
      this.result.set(
        await firstValueFrom(
          this.api.importItpo(this.data.slug, this.data.venueId, this.file, halls),
        ),
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
