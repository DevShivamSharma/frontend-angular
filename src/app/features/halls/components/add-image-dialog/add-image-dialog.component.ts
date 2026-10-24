import { ChangeDetectionStrategy, Component, inject, input, model, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { HallImagePayload } from '../../domain/hall-payload';
import { createImageGroup, MAX_IMAGE_URL } from '../../domain/hall-images.form';

/** Adds one picture to an existing hall, by the address it is kept at. */
@Component({
  selector: 'app-add-image-dialog',
  imports: [
    ReactiveFormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    ToggleSwitchModule,
    FormFieldComponent,
  ],
  templateUrl: './add-image-dialog.component.html',
  styleUrl: './add-image-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddImageDialogComponent {
  readonly visible = model(false);
  readonly saving = input.required<boolean>();
  /** The hall has a cover already, so a new one cannot be the cover. */
  readonly hasCover = input(false);
  /** An address the API refused, to show on the field. */
  readonly failure = input<string | null>(null);

  readonly added = output<HallImagePayload>();

  protected readonly form = createImageGroup(inject(FormBuilder));
  protected readonly maxLength = MAX_IMAGE_URL;

  open(): void {
    this.form.reset({ url: '', cover: false });
    this.visible.set(true);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const { url, cover } = this.form.getRawValue();
    this.added.emit({ url: url.trim(), kind: cover && !this.hasCover() ? 'cover' : 'gallery' });
  }
}
