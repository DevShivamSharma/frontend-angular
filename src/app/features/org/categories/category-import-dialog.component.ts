import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { firstValueFrom } from 'rxjs';

import { CategoriesApi } from '../../../core/categories/categories-api.service';
import type { CategoryImportResult } from '../../../core/categories/categories.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import { CategoryCsvRow, importable, readCategoryCsv } from './category-csv';

/** Largest file read, so a wrong file cannot freeze the page. */
const MAX_BYTES = 1024 * 1024;

/**
 * Adds categories from a CSV: the file is read here and shown row by row; names already listed
 * are skipped by the server. Closes with what the server did.
 */
@Component({
  selector: 'app-category-import-dialog',
  imports: [ButtonModule, MessageModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Import categories</h2>
    <div class="dialog-content stack">
      <p class="muted">
        A CSV file with a header row: <code>name</code> and, if you like, <code>status</code> (<code
          >active</code
        >
        or <code>inactive</code>; blank is active). Names already listed are skipped.
      </p>
      <pre class="sample">
name,status
Premium,active
Corner,active
Pavilion,inactive</pre>
      <label class="file">
        <input type="file" accept=".csv,text/csv" (change)="read($event)" />
        <span pButton [outlined]="true"><app-icon name="upload_file" />Choose a CSV file</span>
        @if (fileName()) {
          <span class="muted">{{ fileName() }}</span>
        }
      </label>
      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }
      @if (rows().length) {
        <p>
          <b>{{ ready() }}</b> to import
          @if (rows().length - ready()) {
            · <span class="bad">{{ rows().length - ready() }} with a problem</span>
          }
        </p>
        <div class="table-wrap">
          <table class="preview">
            <thead>
              <tr>
                <th>Line</th>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.line) {
                <tr [class.bad]="r.problem">
                  <td class="nums">{{ r.line }}</td>
                  <td>{{ r.name || '—' }}</td>
                  <td>{{ r.status === 'active' ? 'Active' : 'Inactive' }}</td>
                  <td>{{ r.problem ?? '' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="submit()" [disabled]="busy() || !ready()">
        Import {{ ready() || '' }} {{ ready() === 1 ? 'category' : 'categories' }}
      </button>
    </div>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 12px;
      min-width: min(520px, 84vw);
    }
    p {
      margin: 0;
    }
    .sample {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--app-surface-container);
      font-size: 12px;
    }
    .file {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
    }
    .file input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .file:focus-within span[pButton] {
      outline: 2px solid var(--app-primary);
      outline-offset: 2px;
    }
    .table-wrap {
      max-height: 280px;
      overflow: auto;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
    }
    .preview {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .preview th,
    .preview td {
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid var(--app-outline-variant);
    }
    .bad {
      color: var(--app-error);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class CategoryImportDialogComponent {
  protected readonly data = dialogData<{ slug: string }>();
  private readonly api = inject(CategoriesApi);
  protected readonly ref = inject(DialogRef);

  protected readonly fileName = signal('');
  protected readonly rows = signal<CategoryCsvRow[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly ready = computed(() => importable(this.rows()).length);

  protected async read(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    if (file.size > MAX_BYTES) {
      this.rows.set([]);
      this.error.set('The file is larger than 1 MB. A categories CSV is far smaller.');
      return;
    }
    const { rows, error } = readCategoryCsv(await file.text());
    this.rows.set(rows);
    this.error.set(error);
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.api.import(this.data.slug, importable(this.rows())));
      this.ref.close(result satisfies CategoryImportResult);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
