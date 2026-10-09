import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { CategoriesApi } from '../../../core/categories/categories-api.service';
import type {
  CategoryImportResult,
  CategoryView,
} from '../../../core/categories/categories.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { CategoryDialogComponent, CategoryDialogData } from './category-dialog.component';
import { CategoryImportDialogComponent } from './category-import-dialog.component';

/**
 * The organisation's stall categories. The Venue Admin adds them one by one or from a CSV;
 * event halls then pick which they sell, and the planner offers only those.
 */
@Component({
  selector: 'app-categories-page',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    ProgressBarModule,
    TableModule,
    ToggleSwitchModule,
    TooltipModule,
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Stall categories"
        subheading="What stalls are sold as. Event halls pick from the active ones."
      >
        <button pButton [outlined]="true" (click)="import()">
          <app-icon name="upload_file" />Import CSV
        </button>
        <button pButton (click)="create()"><app-icon name="add" />New category</button>
      </app-page-header>

      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }

      @if (!loading() && !categories().length) {
        <div class="panel">
          <app-empty-state
            icon="category"
            heading="No categories yet"
            text="Add categories such as Premium, Corner or F&B, or import them from a CSV file."
          >
            <button pButton (click)="create()">New category</button>
          </app-empty-state>
        </div>
      }

      @if (categories().length) {
        <div class="toolbar">
          <input
            pInputText
            type="search"
            placeholder="Search categories"
            aria-label="Search categories"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
          <span class="muted nums"
            >{{ activeCount() }} active · {{ categories().length - activeCount() }} inactive</span
          >
        </div>
        <div class="table-wrap">
          <p-table [value]="shown()" [paginator]="shown().length > 25" [rows]="25">
            <ng-template #header>
              <tr>
                <th>Name</th>
                <th>Active</th>
                <th>Event halls</th>
                <th>Changed</th>
                <th><span class="visually-hidden">Actions</span></th>
              </tr>
            </ng-template>
            <ng-template #body let-c>
              <tr>
                <td>
                  <b>{{ c.name }}</b>
                </td>
                <td>
                  <p-toggleswitch
                    [ngModel]="c.status === 'active'"
                    (ngModelChange)="setActive(c, $event)"
                    [disabled]="busy()"
                    [ariaLabel]="c.name + ' active'"
                  />
                </td>
                <td class="nums">{{ c.eventHalls }}</td>
                <td class="muted">{{ c.updatedAt | date: 'd MMM y' }}</td>
                <td class="actions">
                  <button
                    pButton
                    [text]="true"
                    [rounded]="true"
                    (click)="edit(c)"
                    [attr.aria-label]="'Rename ' + c.name"
                    pTooltip="Rename"
                  >
                    <app-icon name="edit" />
                  </button>
                  <button
                    pButton
                    [text]="true"
                    [rounded]="true"
                    severity="danger"
                    (click)="remove(c)"
                    [disabled]="busy() || c.eventHalls > 0"
                    [attr.aria-label]="'Delete ' + c.name"
                    [pTooltip]="c.eventHalls ? 'Sold on event halls: make it inactive' : 'Delete'"
                  >
                    <app-icon name="delete" />
                  </button>
                </td>
              </tr>
            </ng-template>
            <ng-template #emptymessage>
              <tr>
                <td colspan="5" class="muted">No category matches “{{ query() }}”.</td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      }
    </div>
  `,
  styles: `
    .toolbar {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar input {
      width: min(320px, 100%);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .actions {
      text-align: right;
      white-space: nowrap;
    }
  `,
})
export class CategoriesPageComponent {
  private readonly api = inject(CategoriesApi);
  private readonly dialog = inject(AppDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly slug = inject(OrgContextStore).slug;

  protected readonly categories = signal<CategoryView[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q
      ? this.categories().filter((c) => c.name.toLowerCase().includes(q))
      : this.categories();
  });
  protected readonly activeCount = computed(
    () => this.categories().filter((c) => c.status === 'active').length,
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.categories.set(await firstValueFrom(this.api.list(this.slug())));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected create(): void {
    this.dialog
      .open<CategoryView>(CategoryDialogComponent, {
        data: { slug: this.slug() } satisfies CategoryDialogData,
      })
      .subscribe((saved) => {
        if (!saved) return;
        this.notifier.success(`${saved.name} added.`);
        void this.load();
      });
  }

  protected edit(category: CategoryView): void {
    this.dialog
      .open<CategoryView>(CategoryDialogComponent, {
        data: { slug: this.slug(), category } satisfies CategoryDialogData,
      })
      .subscribe((saved) => {
        if (saved) void this.load();
      });
  }

  protected import(): void {
    this.dialog
      .open<CategoryImportResult>(CategoryImportDialogComponent, {
        data: { slug: this.slug() },
        width: 'min(640px, 96vw)',
      })
      .subscribe((result) => {
        if (!result) return;
        const skipped = result.skipped.length;
        this.notifier.success(
          `${result.created} ${result.created === 1 ? 'category' : 'categories'} added` +
            (skipped ? `; ${skipped} skipped (already listed).` : '.'),
        );
        void this.load();
      });
  }

  protected async setActive(category: CategoryView, active: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.update(this.slug(), category.id, { status: active ? 'active' : 'inactive' }),
      );
      this.categories.update((list) => list.map((c) => (c.id === saved.id ? saved : c)));
    } catch {
      // The error interceptor has shown it; show the switch as it was.
      this.categories.update((list) => [...list]);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(category: CategoryView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${category.name}?`,
      message: 'No event hall sells it, so nothing else changes.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.delete(this.slug(), category.id));
      this.categories.update((list) => list.filter((c) => c.id !== category.id));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
