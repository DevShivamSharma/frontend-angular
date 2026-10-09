import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type {
  AdminRoleView,
  OrganisationSummary,
  PermissionGroup,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { FieldComponent } from '../../../shared/field.component';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';

/**
 * Dynamic RBAC at a glance: every role against every permission. Ticking a box changes the
 * role for every member who holds it, from their next request.
 */
@Component({
  selector: 'app-roles-page',
  imports: [
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    TooltipModule,
    PageHeaderComponent,
    FieldComponent,
    SelectModule,
    CheckboxModule,
    FormsModule,
  ],
  templateUrl: './roles-page.component.html',
  styleUrl: './roles-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolesPageComponent {
  private readonly api = inject(AdminApi);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);

  protected readonly groups = signal<PermissionGroup[]>([]);
  protected readonly roles = signal<AdminRoleView[]>([]);
  protected readonly organisations = signal<OrganisationSummary[]>([]);
  protected readonly organisationId = signal<string>('');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  /** Edited permission sets, by role id, not saved yet. */
  protected readonly drafts = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  protected readonly changedCount = computed(() => this.drafts().size);
  protected readonly organisationOptions = computed(() => [
    { value: '', label: 'Platform roles (every organisation)' },
    ...this.organisations().map((org) => ({ value: org.id, label: `As ${org.name} sees them` })),
  ]);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const [groups, organisations] = await Promise.all([
        firstValueFrom(this.api.permissions()),
        firstValueFrom(this.api.organisations({ page: 1, pageSize: 100 })),
      ]);
      this.groups.set(groups);
      this.organisations.set(organisations.items);
      await this.loadRoles();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  protected async selectOrganisation(id: string): Promise<void> {
    const discard =
      !this.changedCount() ||
      (await this.confirm.confirm({
        title: 'Discard the unsaved changes?',
        message: 'The ticked permissions on this view have not been saved.',
        confirmLabel: 'Discard',
        destructive: true,
      }));
    if (!discard) {
      return;
    }
    this.organisationId.set(id);
    this.drafts.set(new Map());
    await this.loadRoles();
  }

  private async loadRoles(): Promise<void> {
    const roles = await firstValueFrom(this.api.roles(this.organisationId() || undefined));
    // Without an organisation chosen, show the platform roles only.
    this.roles.set(this.organisationId() ? roles : roles.filter((role) => !role.organisation));
  }

  protected has(role: AdminRoleView, permission: string): boolean {
    return (this.drafts().get(role.id) ?? new Set(role.permissions)).has(permission);
  }

  protected changed(role: AdminRoleView): boolean {
    return this.drafts().has(role.id);
  }

  protected toggle(role: AdminRoleView, permission: string, on: boolean): void {
    const next = new Set(this.drafts().get(role.id) ?? role.permissions);
    if (on) {
      next.add(permission);
    } else {
      next.delete(permission);
    }
    const drafts = new Map(this.drafts());
    const same =
      next.size === role.permissions.length && role.permissions.every((key) => next.has(key));
    if (same) {
      drafts.delete(role.id);
    } else {
      drafts.set(role.id, next);
    }
    this.drafts.set(drafts);
  }

  protected discard(): void {
    this.drafts.set(new Map());
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      for (const [roleId, permissions] of this.drafts()) {
        await firstValueFrom(this.api.updateRole(roleId, { permissions: [...permissions] }));
      }
      this.notifier.success(
        `Saved ${this.changedCount()} role(s). Members get the change on their next request.`,
      );
      this.drafts.set(new Map());
      await this.loadRoles();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.saving.set(false);
    }
  }
}
