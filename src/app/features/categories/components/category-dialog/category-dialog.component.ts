import { ChangeDetectionStrategy, Component, inject, input, model, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { CategoryGroup } from '../../data/categories.models';

export interface NewCategoryRequest {
  group: string;
  name: string;
  description: string;
}

/** A new category: the group it belongs to (a fair, F&B…), its name, and a note. */
@Component({
  selector: 'app-category-dialog',
  imports: [
    ReactiveFormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TextareaModule,
    FormFieldComponent,
  ],
  templateUrl: './category-dialog.component.html',
  styleUrl: './category-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryDialogComponent {
  readonly visible = model(false);
  readonly groups = input.required<CategoryGroup[]>();
  readonly saving = input.required<boolean>();
  /** What ITPO refused with (e.g. a category of that name exists), shown by the name. */
  readonly failure = input<string | null>(null);

  readonly created = output<NewCategoryRequest>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    group: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    description: ['', Validators.maxLength(255)],
  });

  /** Opens it for a new category, in the group the list shows. */
  open(group: string | null): void {
    this.form.reset({ group: group ?? '', name: '', description: '' });
    this.visible.set(true);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    this.created.emit(this.form.getRawValue());
  }
}
