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
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { UrlState } from '../../../../core/navigation/url-state';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { CardSkeletonComponent } from '../../../../shared/ui/card-skeleton/card-skeleton.component';
import { TableSkeletonComponent } from '../../../../shared/ui/table-skeleton/table-skeleton.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import {
  CategoryDialogComponent,
  NewCategoryRequest,
} from '../../components/category-dialog/category-dialog.component';
import { CategoriesApiService } from '../../data/categories-api.service';
import { Category, CategoryGroup, CategoryQuery } from '../../data/categories.models';
import { categoryGroups } from '../../domain/category-groups';
import { GroupsPanelComponent } from '../../components/groups-panel/groups-panel.component';

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
    TabsModule,
    TooltipModule,
    PaginatorModule,
    ToggleSwitchModule,
    TableSkeletonComponent,
    CardSkeletonComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    CategoryDialogComponent,
    GroupsPanelComponent,
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
  protected readonly groupsPanel = viewChild(GroupsPanelComponent);
  /** Placeholder columns while the list loads: number, name, status, action. */
  protected readonly skeleton = [
    { width: '1.5rem' },
    { width: '60%' },
    { width: '7rem' },
    { width: '2rem' },
  ];

  protected readonly pageSize = PAGE_SIZE;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly statusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  protected readonly viewOptions = [
    { label: 'Categories', value: 'categories' },
    { label: 'Groups', value: 'groups' },
  ];
  protected readonly view = signal<'categories' | 'groups'>('categories');
  protected readonly displayOptions = [
    { label: 'List', value: 'list', icon: 'pi pi-list' },
    { label: 'Grid', value: 'grid', icon: 'pi pi-th-large' },
  ];
  /** The categories as a list or a grid; kept between visits, as on the Halls page. */
  protected readonly display = signal<CategoriesDisplay>(readDisplay());
  /** Bumped to draw the switches as the data has them, after a change was declined or refused. */
  protected readonly redraw = signal(0);
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
  private readonly url = new UrlState();
  /** The row a reloaded or shared address starts at, used once. */
  private startAt = this.url.firstRow('page', PAGE_SIZE);

  constructor() {
    this.search.setValue(this.url.text('q'), { emitEvent: false });
    const statusInUrl = this.url.text('status');
    if (statusInUrl === 'active' || statusInUrl === 'inactive') this.status.set(statusInUrl);
    if (this.url.text('view') === 'groups') this.view.set('groups');
    this.loadGroups(true);
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetch(0));
  }

  /** The active groups, which the picker offers; again after the group master switched one. */
  protected loadGroups(first = false): void {
    this.api
      .groups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          const own = categoryGroups(groups);
          this.groups.set(own);
          const wanted = first ? this.url.text('group') : this.group();
          const chosen = own.find((g) => g.slug === wanted)?.slug ?? own[0]?.slug ?? null;
          const moved = chosen !== this.group();
          this.group.set(chosen);
          this.groupsFailed.set(false);
          if (first) {
            this.fetch(this.startAt);
            this.startAt = 0;
          } else if (moved) {
            this.fetch(0);
          }
        },
        error: (error: unknown) => {
          this.groupsFailed.set(true);
          this.loading.set(false);
          this.notifier.fromError(error, 'The categories could not be loaded');
        },
      });
  }

  protected chooseView(view: 'categories' | 'groups'): void {
    this.view.set(view);
    this.url.write({ view: view === 'groups' ? 'groups' : null });
  }

  protected chooseDisplay(display: CategoriesDisplay): void {
    this.display.set(display);
    try {
      localStorage.setItem(DISPLAY_KEY, display);
    } catch {
      // Storage may be blocked; the view still changes for this visit.
    }
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
      this.redraw.update((n) => n + 1);
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
        this.redraw.update((n) => n + 1);
        this.notifier.fromError(error, 'The category could not be changed');
      },
    });
  }

  protected async remove(category: Category): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Delete category',
      message: `Delete "${category.name}" for good? It cannot be brought back. To only stop offering it, deactivate it instead.`,
      acceptLabel: 'Delete',
      danger: true,
    });
    if (!go) {
      return;
    }
    this.api.deleteCategory(category.id).subscribe({
      next: () => {
        this.notifier.success('Category deleted', category.name);
        const left = this.categories().length - 1;
        this.fetch(left <= 0 && this.first() > 0 ? this.first() - PAGE_SIZE : this.first());
      },
      error: (error: unknown) =>
        this.notifier.fromError(error, 'The category could not be deleted'),
    });
  }

  private fetch(first: number): void {
    const group = this.group();
    if (!group) {
      return;
    }
    this.request?.unsubscribe();
    this.first.set(first);
    this.url.write({
      view: this.view() === 'groups' ? 'groups' : null,
      group: group === this.groups()[0]?.slug ? null : group,
      q: this.search.value.trim(),
      status: this.status() === 'all' ? null : this.status(),
      page: Math.floor(first / PAGE_SIZE) + 1,
    });
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

type CategoriesDisplay = 'list' | 'grid';

const DISPLAY_KEY = 'ems.categories-display';

function readDisplay(): CategoriesDisplay {
  try {
    return localStorage.getItem(DISPLAY_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}
