import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type {
  AdminRoleView,
  OrganisationSummary,
  PermissionGroup,
  RoleScopeKind,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';

const ROLE_KEY = /^[a-z][a-z0-9_]{1,47}$/;

/** "Hall Operations" → "hall_operations". */
function roleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 48);
}

/** Creates a role, or edits one: its name, where it applies, and its permissions. */
@Component({
  selector: 'app-role-editor-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    PageHeaderComponent,
    FieldComponent,
    InputTextModule,
    SelectModule,
    CheckboxModule,
    RadioButtonModule,
    FormsModule,
  ],
  templateUrl: './role-editor-page.component.html',
  styleUrl: './role-editor-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleEditorPageComponent {
  private readonly api = inject(AdminApi);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  /** Route parameter; absent for a new role. */
  readonly id = input<string>();
  /** Query parameter: preselects the organisation of a new role. */
  readonly organisationId = input<string>();

  protected readonly role = signal<AdminRoleView | null>(null);
  protected readonly groups = signal<PermissionGroup[]>([]);
  protected readonly organisations = signal<OrganisationSummary[]>([]);
  protected readonly organisationOptions = computed(() => [
    { value: '', label: 'Every organisation' },
    ...this.organisations().map((org) => ({ value: org.id, label: `Only ${org.name}` })),
  ]);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly isNew = computed(() => !this.id());
  protected readonly locked = computed(() => this.role()?.isLocked ?? false);
  protected readonly inUse = computed(() => {
    const role = this.role();
    return role ? role.memberCount + role.openInvitationCount > 0 : false;
  });

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    key: ['', [Validators.required, Validators.pattern(ROLE_KEY)]],
    description: ['', Validators.maxLength(300)],
    organisationId: [''],
    scopeKind: this.fb.control<RoleScopeKind>('organisation'),
  });

  constructor() {
    this.form.controls.name.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((name) => {
        if (this.isNew() && !this.form.controls.key.dirty) {
          this.form.controls.key.setValue(roleKey(name));
        }
      });
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const [id, organisationId] = [this.id(), this.organisationId()];
      untracked(() => void this.load(id, organisationId));
    });
  }

  private async load(id: string | undefined, organisationId: string | undefined): Promise<void> {
    try {
      const [groups, organisations, role] = await Promise.all([
        firstValueFrom(this.api.permissions()),
        firstValueFrom(this.api.organisations({ page: 1, pageSize: 100 })),
        id ? firstValueFrom(this.api.role(id)) : Promise.resolve(null),
      ]);
      this.groups.set(groups);
      this.organisations.set(organisations.items);
      this.role.set(role);
      if (role) {
        this.form.reset({
          name: role.name,
          key: role.key,
          description: role.description ?? '',
          organisationId: role.organisation?.id ?? '',
          scopeKind: role.scopeKind,
        });
        this.form.controls.key.disable();
        this.form.controls.organisationId.disable();
        if (role.isLocked || role.memberCount + role.openInvitationCount > 0) {
          this.form.controls.scopeKind.disable();
        }
        this.selected.set(new Set(role.permissions));
      } else {
        this.form.reset({ organisationId: organisationId ?? '', scopeKind: 'organisation' });
      }
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected toggle(permission: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) {
      next.add(permission);
    } else {
      next.delete(permission);
    }
    this.selected.set(next);
    this.form.markAsDirty();
  }

  protected groupState(group: PermissionGroup): 'all' | 'some' | 'none' {
    const count = group.permissions.filter((p) => this.selected().has(p.key)).length;
    return count === 0 ? 'none' : count === group.permissions.length ? 'all' : 'some';
  }

  protected toggleGroup(group: PermissionGroup, on: boolean): void {
    const next = new Set(this.selected());
    for (const permission of group.permissions) {
      if (on) {
        next.add(permission.key);
      } else {
        next.delete(permission.key);
      }
    }
    this.selected.set(next);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const permissions = [...this.selected()];
    this.busy.set(true);
    try {
      if (this.isNew()) {
        const created = await firstValueFrom(
          this.api.createRole({
            ...(value.organisationId ? { organisationId: value.organisationId } : {}),
            key: value.key,
            name: value.name.trim(),
            description: value.description.trim() || null,
            scopeKind: value.scopeKind,
            permissions,
          }),
        );
        this.notifier.success(`${created.name} created.`);
        await this.router.navigate(['/admin/roles', created.id], { replaceUrl: true });
      } else {
        const role = this.role()!;
        const updated = await firstValueFrom(
          this.api.updateRole(role.id, {
            name: value.name.trim(),
            description: value.description.trim() || null,
            ...(role.isLocked ? {} : { permissions }),
            ...(role.isLocked || this.inUse() || value.scopeKind === role.scopeKind
              ? {}
              : { scopeKind: value.scopeKind }),
          }),
        );
        this.role.set(updated);
        this.form.markAsPristine();
        this.notifier.success('Saved. Members get the change on their next request.');
      }
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const role = this.role();
    if (!role) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Delete ${role.name}?`,
      message: 'Nobody holds it, so nothing else changes. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteRole(role.id));
      this.notifier.success(`${role.name} deleted.`);
      await this.router.navigate(['/admin/roles']);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
