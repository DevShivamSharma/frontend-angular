import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

import type { AuditEntry, OrganisationSummary } from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { AuditTableComponent } from '../../../shared/audit-table.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

const ACTION_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'organisation.', label: 'Organisations' },
  { value: 'role.', label: 'Roles' },
  { value: 'invitation.', label: 'Invitations' },
  { value: 'membership.', label: 'Members' },
  { value: 'auth.', label: 'Sign-ins and passwords' },
];

@Component({
  selector: 'app-admin-audit-page',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    AuditTableComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Audit log"
        subheading="Every administrative change on the platform, newest first."
      />
      <div class="row">
        <mat-form-field class="inline-field">
          <mat-label>Organisation</mat-label>
          <mat-select
            [ngModel]="organisationId()"
            (ngModelChange)="organisationId.set($event); reload()"
          >
            <mat-option value="">All</mat-option>
            @for (org of organisations(); track org.id) {
              <mat-option [value]="org.id">{{ org.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="inline-field">
          <mat-label>About</mat-label>
          <mat-select [ngModel]="action()" (ngModelChange)="action.set($event); reload()">
            @for (filter of filters; track filter.value) {
              <mat-option [value]="filter.value">{{ filter.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <app-audit-table [entries]="entries()" [organisations]="organisationNames()" />
      <mat-paginator
        [length]="total()"
        [pageIndex]="page() - 1"
        [pageSize]="pageSize"
        [hidePageSize]="true"
        (page)="onPage($event)"
      />
    </div>
  `,
})
export class AdminAuditPageComponent {
  private readonly api = inject(AdminApi);
  private readonly notifier = inject(Notifier);

  protected readonly filters = ACTION_FILTERS;
  protected readonly pageSize = 50;
  protected readonly organisations = signal<OrganisationSummary[]>([]);
  protected readonly organisationId = signal('');
  protected readonly action = signal('');
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly organisationNames = computed(() =>
    Object.fromEntries(this.organisations().map((org) => [org.id, org.name])),
  );

  constructor() {
    this.api.organisations({ page: 1, pageSize: 100 }).subscribe({
      next: (result) => this.organisations.set(result.items),
      error: (error: unknown) => this.notifier.error(error),
    });
    void this.load();
  }

  protected reload(): void {
    this.page.set(1);
    void this.load();
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await firstValueFrom(
        this.api.audit({
          organisationId: this.organisationId() || undefined,
          action: this.action() || undefined,
          page: this.page(),
          pageSize: this.pageSize,
        }),
      );
      this.entries.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      this.notifier.error(error);
    } finally {
      this.loading.set(false);
    }
  }
}
