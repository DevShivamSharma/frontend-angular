import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  BOOKING_MODES,
  OrganisationStatus,
  OrganisationSummary,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { TimeAgoPipe } from '../../../shared/time-ago.pipe';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-organisations-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    IconComponent,
    PaginatorModule,
    IconFieldModule,
    InputIconModule,
    ProgressBarModule,
    TooltipModule,
    BrandMarkComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    TimeAgoPipe,
    InputTextModule,
    SelectButtonModule,
    TableModule,
    FormsModule,
  ],
  templateUrl: './organisations-page.component.html',
  styleUrl: './organisations-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganisationsPageComponent {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);

  protected readonly statusOptions = [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
  ];
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly status = signal<OrganisationStatus | ''>('');
  protected readonly rows = signal<OrganisationSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });
    this.load();
  }

  protected get filtered(): boolean {
    return Boolean(this.search.value.trim() || this.status());
  }

  protected setStatus(status: OrganisationStatus | ''): void {
    this.status.set(status);
    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    this.status.set('');
    this.search.setValue('');
  }

  protected onPage(event: PaginatorState): void {
    this.page.set((event.page ?? 0) + 1);
    this.pageSize.set(event.rows ?? this.pageSize());
    this.load();
  }

  /** Mouse users can click anywhere on a row; keyboard users follow the name link. */
  protected open(org: OrganisationSummary, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button')) {
      return;
    }
    void this.router.navigate(['/admin/organisations', org.id]);
  }

  protected bookingLabel(mode: string): string {
    return BOOKING_MODES.find((m) => m.value === mode)?.label ?? mode;
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .organisations({
        q: this.search.value.trim(),
        status: this.status(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.loading.set(false);
          this.loaded.set(true);
        },
        // The error interceptor has shown it.
        error: () => this.loading.set(false),
      });
  }
}
