import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { firstValueFrom } from 'rxjs';

import { CategoriesApi } from '../../../core/categories/categories-api.service';
import type { CategoryStatus, CategoryView } from '../../../core/categories/categories.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';

export interface CategoryDialogData {
  slug: string;
  /** The category to edit; absent to create one. */
  category?: CategoryView;
}

export const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

/** Creates or edits a stall category. Closes with the saved category. */
@Component({
  selector: 'app-category-dialog',
  imports: [ReactiveFormsModule, ButtonModule, FieldComponent, InputTextModule, SelectButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">{{ data.category ? 'Edit category' : 'New category' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="dialog-content stack">
        <app-field
          label="Name"
          hint="e.g. Premium, Corner, F&B"
          error="1 to 80 characters"
          for="category-dialog-name"
        >
          <input id="category-dialog-name" pInputText formControlName="name" maxlength="80" />
        </app-field>
        <app-field label="Status" hint="Inactive categories are not offered on event halls">
          <p-selectbutton
            formControlName="status"
            [options]="statuses"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            ariaLabel="Status"
          />
        </app-field>
      </div>
      <div class="dialog-actions">
        <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
        <button pButton type="submit" [disabled]="busy()">
          {{ data.category ? 'Save' : 'Create category' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .stack {
      display: grid;
      gap: 4px;
      min-width: min(380px, 80vw);
    }
  `,
})
export class CategoryDialogComponent {
  protected readonly data = dialogData<CategoryDialogData>();
  private readonly api = inject(CategoriesApi);
  protected readonly ref = inject(DialogRef);
  protected readonly statuses = STATUS_OPTIONS;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.category?.name ?? '', [Validators.required, Validators.maxLength(80)]],
    status: [(this.data.category?.status ?? 'active') as CategoryStatus],
  });
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    if (this.form.invalid || !name) {
      this.form.controls.name.setErrors({ required: true });
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const input = { name, status: this.form.controls.status.value };
    try {
      const saved = await firstValueFrom(
        this.data.category
          ? this.api.update(this.data.slug, this.data.category.id, input)
          : this.api.create(this.data.slug, input),
      );
      this.ref.close(saved);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
