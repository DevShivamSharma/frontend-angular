import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  BOOKING_MODES,
  OrganisationStatus,
  OrganisationSummary,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { TimeAgoPipe } from '../../../shared/time-ago.pipe';

@Component({
  selector: 'app-organisations-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
    BrandMarkComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    TimeAgoPipe,
  ],
  templateUrl: './organisations-page.component.html',
  styleUrl: './organisations-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganisationsPageComponent {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly notifier = inject(Notifier);

  protected readonly columns = ['name', 'status', 'booking', 'people', 'created', 'open'];
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

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
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
        error: (error: unknown) => {
          this.loading.set(false);
          this.notifier.error(error);
        },
      });
  }
}
