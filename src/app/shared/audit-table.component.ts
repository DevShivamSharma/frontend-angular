import { DatePipe, KeyValuePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from './icon.component';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import type { AuditEntry } from '../core/api/api.models';
import { auditIcon, auditIsWarning, auditLabel } from './audit-labels';
import { TimeAgoPipe } from './time-ago.pipe';

/** The audit log as a table. */
@Component({
  selector: 'app-audit-table',
  imports: [IconComponent, TableModule, TooltipModule, DatePipe, KeyValuePipe, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-table [value]="entries()" styleClass="audit" [tableStyle]="{ 'min-width': '720px' }">
      <ng-template #header>
        <tr>
          <th>When</th>
          @if (organisations()) {
            <th>Organisation</th>
          }
          <th>Who</th>
          <th>What</th>
          <th>Details</th>
        </tr>
      </ng-template>
      <ng-template #body let-e>
        <tr>
          <td>
            <span class="when" [pTooltip]="(e.createdAt | date: 'd MMM y, HH:mm:ss') ?? ''">
              {{ e.createdAt | timeAgo }}
              <span class="muted">{{ e.createdAt | date: 'd MMM, HH:mm' }}</span>
            </span>
          </td>
          @if (organisations()) {
            <td>{{ organisationName()(e.organisationId) }}</td>
          }
          <td>{{ e.actorEmail ?? 'System' }}</td>
          <td>
            <span class="action">
              <span class="action-icon" [class.is-warning]="warning(e.action)" aria-hidden="true">
                <app-icon [name]="icon(e.action)" />
              </span>
              <span class="action-text">
                {{ label(e.action) }}
                <code class="muted">{{ e.action }}</code>
              </span>
            </span>
          </td>
          <td class="details">
            @for (item of e.metadata | keyvalue; track item.key) {
              <span
                ><b>{{ item.key }}</b> {{ format(item.value) }}</span
              >
            }
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr>
          <td [attr.colspan]="organisations() ? 5 : 4" class="empty-state">
            Nothing recorded yet.
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    .when,
    .action-text {
      display: grid;
    }
    .when .muted {
      font: var(--app-body-small);
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
      background: var(--app-secondary-container);
      color: var(--app-on-secondary-container);
    }
    .action-icon app-icon {
      font-size: 15px;
    }
    .action-icon.is-warning {
      background: var(--app-error-container);
      color: var(--app-on-error-container);
    }
    code {
      font-size: 11px;
    }
    .details span {
      display: block;
      max-width: 420px;
      overflow-wrap: anywhere;
      font: var(--app-body-small);
    }
  `,
})
export class AuditTableComponent {
  readonly entries = input.required<AuditEntry[]>();
  /** Organisation names by id; when given, an Organisation column is shown. */
  readonly organisations = input<Record<string, string> | null>(null);

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
