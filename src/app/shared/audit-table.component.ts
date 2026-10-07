import { DatePipe, KeyValuePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { AuditEntry } from '../core/api/api.models';
import { auditIcon, auditIsWarning, auditLabel } from './audit-labels';
import { TimeAgoPipe } from './time-ago.pipe';

/** The audit log as a table. */
@Component({
  selector: 'app-audit-table',
  imports: [MatIconModule, MatTableModule, MatTooltipModule, DatePipe, KeyValuePipe, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-wrap">
      <table mat-table [dataSource]="entries()">
        <ng-container matColumnDef="when">
          <th mat-header-cell *matHeaderCellDef>When</th>
          <td mat-cell *matCellDef="let e">
            <span class="when" [matTooltip]="(e.createdAt | date: 'd MMM y, HH:mm:ss') ?? ''">
              {{ e.createdAt | timeAgo }}
              <span class="muted">{{ e.createdAt | date: 'd MMM, HH:mm' }}</span>
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="organisation">
          <th mat-header-cell *matHeaderCellDef>Organisation</th>
          <td mat-cell *matCellDef="let e">{{ organisationName()(e.organisationId) }}</td>
        </ng-container>
        <ng-container matColumnDef="who">
          <th mat-header-cell *matHeaderCellDef>Who</th>
          <td mat-cell *matCellDef="let e">{{ e.actorEmail ?? 'System' }}</td>
        </ng-container>
        <ng-container matColumnDef="action">
          <th mat-header-cell *matHeaderCellDef>What</th>
          <td mat-cell *matCellDef="let e">
            <span class="action">
              <span class="action-icon" [class.is-warning]="warning(e.action)" aria-hidden="true">
                <mat-icon>{{ icon(e.action) }}</mat-icon>
              </span>
              <span class="action-text">
                {{ label(e.action) }}
                <code class="muted">{{ e.action }}</code>
              </span>
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="details">
          <th mat-header-cell *matHeaderCellDef>Details</th>
          <td mat-cell *matCellDef="let e" class="details">
            @for (item of e.metadata | keyvalue; track item.key) {
              <span
                ><b>{{ item.key }}</b> {{ format(item.value) }}</span
              >
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns()"></tr>
        <tr mat-row *matRowDef="let row; columns: columns()"></tr>
      </table>
      @if (!entries().length) {
        <p class="empty-state">Nothing recorded yet.</p>
      }
    </div>
  `,
  styles: `
    .when,
    .action-text {
      display: grid;
    }
    .when .muted {
      font: var(--mat-sys-body-small);
    }
    .action {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
    }
    .action-icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .action-icon mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .action-icon.is-warning {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    code {
      font-size: 11px;
    }
    .details span {
      display: block;
      max-width: 420px;
      overflow-wrap: anywhere;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class AuditTableComponent {
  readonly entries = input.required<AuditEntry[]>();
  /** Organisation names by id; when given, an Organisation column is shown. */
  readonly organisations = input<Record<string, string> | null>(null);

  protected readonly columns = computed(() =>
    this.organisations()
      ? ['when', 'organisation', 'who', 'action', 'details']
      : ['when', 'who', 'action', 'details'],
  );
  protected readonly organisationName = computed(() => {
    const names = this.organisations() ?? {};
    return (id: string | null) => (id ? (names[id] ?? '—') : 'Platform');
  });

  protected readonly label = auditLabel;
  protected readonly icon = auditIcon;
  protected readonly warning = auditIsWarning;

  protected format(value: unknown): string {
    if (value === null || value === undefined) {
      return '—';
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}
