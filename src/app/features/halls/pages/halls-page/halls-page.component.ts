import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { UrlState } from '../../../../core/navigation/url-state';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { ImageFallbackDirective } from '../../../../shared/ui/placeholder-image/image-fallback.directive';
import { PLACEHOLDER_IMAGE } from '../../../../shared/ui/placeholder-image/placeholder-image';
import { CardSkeletonComponent } from '../../../../shared/ui/card-skeleton/card-skeleton.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { TableSkeletonComponent } from '../../../../shared/ui/table-skeleton/table-skeleton.component';
import { ItpoHall } from '../../data/halls.models';
import { ItpoHallsApiService } from '../../data/itpo-halls-api.service';

const PAGE_SIZE = 10;

/** The halls ITPO has, as SelfCare lists them, with a way to create a new one. */
@Component({
  selector: 'app-halls-page',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    PaginatorModule,
    SelectButtonModule,
    TagModule,
    CardSkeletonComponent,
    TableSkeletonComponent,
    ImageFallbackDirective,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './halls-page.component.html',
  styleUrl: './halls-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallsPageComponent {
  private readonly api = inject(ItpoHallsApiService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly placeholder = PLACEHOLDER_IMAGE;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly view = signal<'list' | 'grid'>('grid');
  protected readonly viewOptions = [
    { label: 'List', value: 'list', icon: 'pi pi-list' },
    { label: 'Grid', value: 'grid', icon: 'pi pi-th-large' },
  ];
  protected readonly tableSkeleton = [
    { width: '2rem' },
    { width: '35%' },
    { width: '20%', hideSmall: true },
    { width: '8rem', hideSmall: true },
    { width: '7rem' },
    { width: '10rem', hideSmall: true },
  ];

  protected readonly halls = signal<ItpoHall[]>([]);
  protected readonly total = signal(0);
  protected readonly first = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly isSearching = computed(() => this.search.value.trim().length > 0);

  private request: Subscription | null = null;
  private readonly url = new UrlState();

  constructor() {
    this.search.setValue(this.url.text('q'), { emitEvent: false });
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetch(0));
    this.fetch(this.url.firstRow('page', PAGE_SIZE));
  }

  protected onPage(event: PaginatorState): void {
    this.fetch(event.first ?? 0);
    window.scrollTo({ top: 0 });
  }

  protected retry(): void {
    this.fetch(this.first());
  }

  /** The cover picture (else the first) as a small image for the row; none when the hall has no pictures. */
  protected thumbnail(hall: ItpoHall): string | null {
    return (hall.images.find((image) => image.kind === 'cover') ?? hall.images[0])?.url ?? null;
  }

  /** The page of halls that starts at row `first`, for the current search. Replaces a request still in flight. */
  private fetch(first: number): void {
    this.request?.unsubscribe();
    this.first.set(first);
    this.url.write({ q: this.search.value.trim(), page: Math.floor(first / PAGE_SIZE) + 1 });
    this.loading.set(true);
    this.failed.set(false);

    this.request = this.api
      .halls({
        page: Math.floor(first / PAGE_SIZE) + 1,
        size: PAGE_SIZE,
        search: this.search.value.trim() || undefined,
      })
      .subscribe({
        next: (page) => {
          this.halls.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.halls.set([]);
          this.notifier.fromError(error, 'The halls could not be loaded');
        },
      });
  }
}
