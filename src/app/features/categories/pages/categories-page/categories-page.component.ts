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
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Subscription, forkJoin, map, of } from 'rxjs';

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

/** A group holds this many categories at most on one read; ITPO's groups hold far fewer. */
const GROUP_SIZE = 200;
/** The group filter's "every group". */
const ALL = 'all';

type Status = CategoryQuery['status'];
type View = 'categories' | 'groups';
type CategoriesDisplay = 'list' | 'grid';

/** One group of the list: its categories that pass the search and the status. */
interface Section {
  group: CategoryGroup;
  categories: Category[];
}

/**
 * The product categories ITPO keeps, in their groups, on one card: the rail on the left steps
 * between the categories and the groups (and jumps to a group), the list on the right searches,
 * filters by group and status, and switches categories on or off.
 */
@Component({
  selector: 'app-categories-page',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TooltipModule,
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
  /** Placeholder columns while the list loads: name, status. */
  protected readonly skeleton = [{ width: '60%' }, { width: '7rem' }];

  protected readonly displayOptions = [
    { label: 'List', value: 'list', icon: 'pi pi-list' },
    { label: 'Grid', value: 'grid', icon: 'pi pi-th-large' },
  ];
  protected readonly view = signal<View>('categories');
  /** The categories as a list or a grid; kept between visits, as on the Halls page. */
  protected readonly display = signal<CategoriesDisplay>(readDisplay());
  /** Bumped to draw the switches as the data has them, after a change was declined or refused. */
  protected readonly redraw = signal(0);

  protected readonly groups = signal<CategoryGroup[]>([]);
  /** Every group's categories, by group slug. */
  private readonly byGroup = signal<ReadonlyMap<string, Category[]>>(new Map());
  protected readonly group = signal<string>(ALL);
  protected readonly status = signal<Status>('all');
  protected readonly query = signal('');

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly creating = signal(false);
  protected readonly createFailure = signal<string | null>(null);

  /** Every category, for the rail's counts. */
  private readonly all = computed(() => [...this.byGroup().values()].flat());
  protected readonly totalCount = computed(() => this.all().length);
  protected readonly activeCount = computed(() => this.all().filter((c) => c.active).length);
  protected readonly groupCount = (slug: string) => this.byGroup().get(slug)?.length ?? 0;

  /** The group picker: every group, then each with its count. */
  protected readonly groupOptions = computed(() => [
    { label: `All groups (${this.totalCount()})`, value: ALL },
    ...this.groups().map((g) => ({
      label: `${g.name} (${this.groupCount(g.slug)})`,
      value: g.slug,
    })),
  ]);

  /** The chosen groups' categories that match the search, before the status filter. */
  private readonly searched = computed(() => {
    const words = this.query().trim().toLowerCase();
    const chosen = this.group();
    return this.groups()
      .filter((g) => chosen === ALL || g.slug === chosen)
      .map((group) => ({
        group,
        categories: (this.byGroup().get(group.slug) ?? []).filter(
          (c) =>
            !words ||
            c.name.toLowerCase().includes(words) ||
            (c.description ?? '').toLowerCase().includes(words),
        ),
      }));
  });

  /** All / Active / Inactive, each with how many of the searched categories it shows. */
  protected readonly statusOptions = computed(() => {
    const list = this.searched().flatMap((s) => s.categories);
    const active = list.filter((c) => c.active).length;
    return [
      { label: 'All', value: 'all', count: list.length },
      { label: 'Active', value: 'active', count: active },
      { label: 'Inactive', value: 'inactive', count: list.length - active },
    ];
  });

  /** The list: each chosen group with its categories that pass the search and the status. */
  protected readonly sections = computed<Section[]>(() => {
    const status = this.status();
    return this.searched()
      .map(({ group, categories }) => ({
        group,
        categories: categories.filter(
          (c) => status === 'all' || (status === 'active' ? c.active : !c.active),
        ),
      }))
      .filter((s) => s.categories.length);
  });
  protected readonly shownCount = computed(() =>
    this.sections().reduce((n, s) => n + s.categories.length, 0),
  );
  protected readonly filtered = computed(
    () => !!this.query().trim() || this.status() !== 'all' || this.group() !== ALL,
  );

  private request: Subscription | null = null;
  private readonly url = new UrlState();

  constructor() {
    this.query.set(this.url.text('q'));
    const statusInUrl = this.url.text('status');
    if (statusInUrl === 'active' || statusInUrl === 'inactive') this.status.set(statusInUrl);
    if (this.url.text('view') === 'groups') this.view.set('groups');
    this.group.set(this.url.text('group') || ALL);
    this.load();
  }

  /** The active groups that hold categories, then every one's categories. */
  protected load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    this.request = this.api
      .groups()
      .pipe(map(categoryGroups), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          this.groups.set(groups);
          if (this.group() !== ALL && !groups.some((g) => g.slug === this.group())) {
            this.group.set(ALL);
          }
          this.loadCategories(groups);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private loadCategories(groups: CategoryGroup[]): void {
    const reads = groups.map((g) =>
      this.api
        .list({ group: g.slug, page: 1, size: GROUP_SIZE, status: 'all' })
        .pipe(map((page) => [g.slug, page.items] as const)),
    );
    this.request = (reads.length ? forkJoin(reads) : of([]))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => {
          this.byGroup.set(new Map(entries));
          this.loading.set(false);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.loading.set(false);
    this.failed.set(true);
    this.notifier.fromError(error, 'The categories could not be loaded');
  }

  protected chooseView(view: View): void {
    this.view.set(view);
    this.remember();
  }

  /** From the rail: the categories of one group. */
  protected showGroup(slug: string): void {
    this.view.set('categories');
    this.group.set(slug);
    this.remember();
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
    this.remember();
  }

  protected chooseStatus(status: Status): void {
    this.status.set(status);
    this.remember();
  }

  protected search(query: string): void {
    this.query.set(query);
    this.remember();
  }

  /** A group's line under its heading: what it says of itself, else who books from it. */
  protected groupNote(group: CategoryGroup): string {
    return group.description ?? `For exhibitors booking ${group.name}`;
  }

  protected openNew(): void {
    this.createFailure.set(null);
    this.dialog().open(this.group() === ALL ? (this.groups()[0]?.slug ?? null) : this.group());
  }

  protected async create(request: NewCategoryRequest): Promise<void> {
    const group = this.groups().find((g) => g.slug === request.group);
    const go = await this.confirm.ask({
      header: 'Create category',
      message: `Create "${request.name.trim()}" in ${group?.name ?? 'the group'}?`,
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
        this.byGroup.update((all) =>
          new Map(all).set(request.group, [...(all.get(request.group) ?? []), category]),
        );
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
        this.replace(category.id, (c) => ({ ...c, active: updated.active }));
        this.notifier.success(
          active ? 'Category activated' : 'Category deactivated',
          category.name,
        );
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
        this.byGroup.update(
          (all) =>
            new Map(
              [...all].map(([slug, list]) => [slug, list.filter((c) => c.id !== category.id)]),
            ),
        );
      },
      error: (error: unknown) =>
        this.notifier.fromError(error, 'The category could not be deleted'),
    });
  }

  private replace(id: number, change: (c: Category) => Category): void {
    this.byGroup.update(
      (all) =>
        new Map(
          [...all].map(([slug, list]) => [slug, list.map((c) => (c.id === id ? change(c) : c))]),
        ),
    );
  }

  /** The address keeps the view and the filters, so a reload or a shared link shows the same. */
  private remember(): void {
    this.url.write({
      view: this.view() === 'groups' ? 'groups' : null,
      group: this.group() === ALL ? null : this.group(),
      q: this.query().trim(),
      status: this.status() === 'all' ? null : this.status(),
    });
  }
}

const DISPLAY_KEY = 'ems.categories-display';

function readDisplay(): CategoriesDisplay {
  try {
    return localStorage.getItem(DISPLAY_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}
