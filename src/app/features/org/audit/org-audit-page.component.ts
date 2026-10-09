import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import type { AuditEntry } from '../../../core/api/api.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { AuditTableComponent } from '../../../shared/audit-table.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

@Component({
  selector: 'app-org-audit-page',
  imports: [PaginatorModule, ProgressBarModule, AuditTableComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Audit log"
        subheading="Who changed what in this organisation, newest first."
      />
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      <div class="panel panel-flush">
        <app-audit-table [entries]="entries()" />
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
export class OrgAuditPageComponent {
  private readonly api = inject(OrgApi);
  private readonly context = inject(OrgContextStore);

  protected readonly pageSize = 50;
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);

  constructor() {
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
        this.api.audit(this.context.slug(), this.page(), this.pageSize),
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
