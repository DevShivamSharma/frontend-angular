import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { CardSkeletonComponent } from '../../../../shared/ui/card-skeleton/card-skeleton.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import {
  CategoryDialogComponent,
  NewCategoryRequest,
} from '../../components/category-dialog/category-dialog.component';
import { CategoriesApiService } from '../../data/categories-api.service';
import { Category, CategoryGroup, CategoryQuery } from '../../data/categories.models';
import { categoryGroups } from '../../domain/category-groups';

const PAGE_SIZE = 15;

/** The product categories ITPO keeps, by group: look them up, switch them on or off, and add new ones. */
@Component({
  selector: 'app-categories-page',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    PaginatorModule,
    ToggleSwitchModule,
    CardSkeletonComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    CategoryDialogComponent,
  ],
  templateUrl: './categories-page.component.html',
  styleUrl: './categories-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesPageComponent {
  private readonly api = inject(CategoriesApiService);
  private readonly notifier = inject(NotifierService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required(CategoryDialogComponent);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly statusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  protected readonly groups = signal<CategoryGroup[]>([]);
  protected readonly group = signal<string | null>(null);
  protected readonly status = signal<CategoryQuery['status']>('all');
  protected readonly groupsFailed = signal(false);

  protected readonly categories = signal<Category[]>([]);
  protected readonly total = signal(0);
  protected readonly first = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly creating = signal(false);
  protected readonly createFailure = signal<string | null>(null);
  protected readonly groupName = computed(
    () => this.groups().find((g) => g.slug === this.group())?.name ?? '',
  );

  private request: Subscription | null = null;

  constructor() {
    this.api
      .groups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          const own = categoryGroups(groups);
          this.groups.set(own);
          this.group.set(own[0]?.slug ?? null);
          this.fetch(0);
        },
        error: (error: unknown) => {
          this.groupsFailed.set(true);
          this.loading.set(false);
          this.notifier.fromError(error, 'The categories could not be loaded');
        },
      });
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetch(0));
  }

  protected chooseGroup(slug: string): void {
    this.group.set(slug);
    this.fetch(0);
  }

  protected chooseStatus(status: CategoryQuery['status']): void {
    this.status.set(status);
    this.fetch(0);
  }

  protected onPage(event: PaginatorState): void {
    if (this.group()) {
      this.fetch(event.first ?? 0);
      window.scrollTo({ top: 0 });
    }
  }

  protected retry(): void {
    this.fetch(this.first());
  }

  protected openNew(): void {
    this.createFailure.set(null);
    this.dialog().open(this.group());
  }

  protected async create(request: NewCategoryRequest): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Create category',
      message: `Create "${request.name.trim()}" in ${this.groups().find((g) => g.slug === request.group)?.name ?? 'the group'}?`,
      acceptLabel: 'Create',
    });
    if (!go) {
      return;
    }
    this.creating.set(true);
    this.createFailure.set(null);
    this.api.create(request.group, request).subscribe({
      next: (category) => {
        this.creating.set(false);
        this.dialog().visible.set(false);
        this.notifier.success('Category created', category.name);
        this.group.set(request.group);
        this.fetch(0);
      },
      error: (error: unknown) => {
        this.creating.set(false);
        this.createFailure.set(
          error instanceof ApiError ? error.message : 'The category could not be created.',
        );
      },
    });
  }

  /** The switch moved when it was clicked; it stays so only if the user confirms and ITPO accepts. */
  protected async toggle(category: Category, active: boolean): Promise<void> {
    const go = await this.confirm.ask({
      header: active ? 'Activate category' : 'Deactivate category',
      message: active
        ? `Offer "${category.name}" again?`
        : `Stop offering "${category.name}"? Events that already use it keep it.`,
      acceptLabel: active ? 'Activate' : 'Deactivate',
      danger: !active,
    });
    if (!go) {
      this.categories.update((list) => [...list]);
      return;
    }
    this.api.setActive(category.id, active).subscribe({
      next: (updated) => {
        this.categories.update((list) =>
          list.map((c) => (c.id === category.id ? { ...c, active: updated.active } : c)),
        );
        this.notifier.success(
          active ? 'Category activated' : 'Category deactivated',
          category.name,
        );
        if (this.status() !== 'all') {
          this.fetch(this.first());
        }
      },
      error: (error: unknown) => {
        this.categories.update((list) => [...list]);
        this.notifier.fromError(error, 'The category could not be changed');
      },
    });
  }

  private fetch(first: number): void {
    const group = this.group();
    if (!group) {
      return;
    }
    this.request?.unsubscribe();
    this.first.set(first);
    this.loading.set(true);
    this.failed.set(false);
    this.request = this.api
      .list({
        group,
        page: Math.floor(first / PAGE_SIZE) + 1,
        size: PAGE_SIZE,
        search: this.search.value.trim() || undefined,
        status: this.status(),
      })
      .subscribe({
        next: (page) => {
          this.categories.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.categories.set([]);
          this.notifier.fromError(error, 'The categories could not be loaded');
        },
      });
  }
}
