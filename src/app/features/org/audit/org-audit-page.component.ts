import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import type { AuditEntry } from '../../../core/api/api.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { Notifier } from '../../../core/ui/notifier.service';
import { AuditTableComponent } from '../../../shared/audit-table.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

@Component({
  selector: 'app-org-audit-page',
  imports: [MatPaginatorModule, MatProgressBarModule, AuditTableComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Audit log"
        subheading="Who changed what in this organisation, newest first."
      />
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <app-audit-table [entries]="entries()" />
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
export class OrgAuditPageComponent {
  private readonly api = inject(OrgApi);
  private readonly context = inject(OrgContextStore);
  private readonly notifier = inject(Notifier);

  protected readonly pageSize = 50;
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);

  constructor() {
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
        this.api.audit(this.context.slug(), this.page(), this.pageSize),
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
