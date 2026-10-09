import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { firstValueFrom } from 'rxjs';

import type { AuditEntry, OrganisationSummary } from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { AuditTableComponent } from '../../../shared/audit-table.component';
import { FieldComponent } from '../../../shared/field.component';
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
    PaginatorModule,
    ProgressBarModule,
    SelectModule,
    AuditTableComponent,
    FieldComponent,
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
        <app-field label="Organisation" for="audit-org" class="inline-field">
          <p-select
            inputId="audit-org"
            [options]="organisationOptions()"
            optionLabel="label"
            optionValue="value"
            [filter]="true"
            filterBy="label"
            [ngModel]="organisationId()"
            (ngModelChange)="organisationId.set($event); reload()"
          />
        </app-field>
        <app-field label="About" for="audit-action" class="inline-field">
          <p-select
            inputId="audit-action"
            [options]="filters"
            optionLabel="label"
            optionValue="value"
            [ngModel]="action()"
            (ngModelChange)="action.set($event); reload()"
          />
        </app-field>
      </div>
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      <div class="panel panel-flush">
        <app-audit-table [entries]="entries()" [organisations]="organisationNames()" />
        <p-paginator
          [totalRecords]="total()"
          [first]="(page() - 1) * pageSize"
          [rows]="pageSize"
          [alwaysShow]="false"
          (onPageChange)="onPage($event)"
        />
      </div>
    </div>
  `,
})
export class AdminAuditPageComponent {
  private readonly api = inject(AdminApi);

  protected readonly filters = ACTION_FILTERS;
  protected readonly pageSize = 50;
  protected readonly organisations = signal<OrganisationSummary[]>([]);
  protected readonly organisationId = signal('');
  protected readonly action = signal('');
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly organisationOptions = computed(() => [
    { value: '', label: 'All' },
    ...this.organisations().map((org) => ({ value: org.id, label: org.name })),
  ]);
  protected readonly organisationNames = computed(() =>
    Object.fromEntries(this.organisations().map((org) => [org.id, org.name])),
  );

  constructor() {
    this.api.organisations({ page: 1, pageSize: 100 }).subscribe({
      next: (result) => this.organisations.set(result.items),
      error: () => undefined, // The error interceptor has shown it.
    });
    void this.load();
  }

  protected reload(): void {
    this.page.set(1);
    void this.load();
  }

  protected onPage(event: PaginatorState): void {
    this.page.set((event.page ?? 0) + 1);
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
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }
}
