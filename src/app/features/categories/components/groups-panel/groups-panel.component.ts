import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { TableSkeletonComponent } from '../../../../shared/ui/table-skeleton/table-skeleton.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { CategoriesApiService } from '../../data/categories-api.service';
import { CategoryGroup } from '../../data/categories.models';
import { categoryGroups } from '../../domain/category-groups';

type Show = 'all' | 'active' | 'inactive';

/**
 * The master of category groups (ITPO's code types): list them, add one, switch one on or off.
 * An inactive group is not offered by the category list nor by the event forms.
 */
@Component({
  selector: 'app-groups-panel',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    IconFieldModule,
    InputIconModule,
    TooltipModule,
    InputTextModule,
    SelectButtonModule,
    TextareaModule,
    ToggleSwitchModule,
    FormFieldComponent,
    TableSkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './groups-panel.component.html',
  styleUrl: './groups-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupsPanelComponent {
  private readonly api = inject(CategoriesApiService);
  private readonly notifier = inject(NotifierService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  /** Fires after a group was added or switched, so the page can refresh the groups it offers. */
  readonly changed = output<void>();

  protected readonly showOptions = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];
  protected readonly show = signal<Show>('all');
  protected readonly query = signal('');
  /** Placeholder columns while the list loads: number, name, status, action. */
  protected readonly skeleton = [
    { width: '1.5rem' },
    { width: '50%' },
    { width: '7rem' },
    { width: '2rem' },
  ];
  protected readonly groups = signal<CategoryGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly visible = signal(false);
  protected readonly saving = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    description: ['', Validators.maxLength(255)],
  });

  constructor() {
    this.load();
  }

  protected shown(): CategoryGroup[] {
    const show = this.show();
    const query = this.query().trim().toLowerCase();
    return this.groups().filter(
      (g) =>
        (show === 'all' || (show === 'active' ? g.active : !g.active)) &&
        (!query || g.name.toLowerCase().includes(query)),
    );
  }

  /** Opens the form for a new group; the page's header button calls it. */
  openNew(): void {
    this.form.reset({ name: '', description: '' });
    this.failure.set(null);
    this.visible.set(true);
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.failure.set(null);
    this.api.createGroup(value).subscribe({
      next: (group) => {
        this.saving.set(false);
        this.visible.set(false);
        this.notifier.success('Group created', group.name);
        this.load();
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.failure.set(
          error instanceof ApiError ? error.message : 'The group could not be created.',
        );
      },
    });
  }

  /** The switch moved when it was clicked; it stays so only if the user confirms and ITPO accepts. */
  protected async toggle(group: CategoryGroup, active: boolean): Promise<void> {
    const go = await this.confirm.ask({
      header: active ? 'Activate group' : 'Deactivate group',
      message: active
        ? `Offer "${group.name}" and its categories again?`
        : `Stop offering "${group.name}"? Its categories leave the category list and the event forms. Events that already use them keep them.`,
      acceptLabel: active ? 'Activate' : 'Deactivate',
      danger: !active,
    });
    if (!go) {
      this.groups.update((list) => [...list]);
      return;
    }
    this.api.setGroupActive(group.id, active).subscribe({
      next: () => {
        this.groups.update((list) => list.map((g) => (g.id === group.id ? { ...g, active } : g)));
        this.notifier.success(active ? 'Group activated' : 'Group deactivated', group.name);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.groups.update((list) => [...list]);
        this.notifier.fromError(error, 'The group could not be changed');
      },
    });
  }

  /** A group goes only when it holds no category, so none is left without its group. */
  protected async remove(group: CategoryGroup): Promise<void> {
    let count: number;
    try {
      count = await firstValueFrom(this.api.categoryCount(group.slug));
    } catch (error) {
      this.notifier.fromError(error, 'The group could not be checked');
      return;
    }
    if (count > 0) {
      this.notifier.warn(
        'Group not deleted',
        `${group.name} still holds ${count} ${count === 1 ? 'category' : 'categories'}. Delete them first, or deactivate the group.`,
      );
      return;
    }
    const go = await this.confirm.ask({
      header: 'Delete group',
      message: `Delete "${group.name}" for good? It cannot be brought back.`,
      acceptLabel: 'Delete',
      danger: true,
    });
    if (!go) {
      return;
    }
    this.api.deleteGroup(group.id).subscribe({
      next: () => {
        this.groups.update((list) => list.filter((g) => g.id !== group.id));
        this.notifier.success('Group deleted', group.name);
        this.changed.emit();
      },
      error: (error: unknown) => this.notifier.fromError(error, 'The group could not be deleted'),
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .groups('all')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          this.groups.set(categoryGroups(groups));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.notifier.fromError(error, 'The groups could not be loaded');
        },
      });
  }
}
