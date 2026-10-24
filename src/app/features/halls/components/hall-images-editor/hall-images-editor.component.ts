import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import {
  chooseCover,
  createImageGroup,
  ImageGroup,
  MAX_HALL_IMAGES,
  MAX_IMAGE_URL,
} from '../../domain/hall-images.form';

/** The pictures of a hall as a list of URLs (where they are kept, e.g. on S3), one the cover. */
@Component({
  selector: 'app-hall-images-editor',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    ToggleSwitchModule,
    FormFieldComponent,
  ],
  templateUrl: './hall-images-editor.component.html',
  styleUrl: './hall-images-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallImagesEditorComponent {
  readonly images = input.required<FormArray<ImageGroup>>();

  private readonly fb = inject(FormBuilder);
  protected readonly maxLength = MAX_IMAGE_URL;
  protected readonly max = MAX_HALL_IMAGES;

  protected add(): void {
    this.images().push(createImageGroup(this.fb));
    this.images().markAsDirty();
  }

  protected remove(index: number): void {
    this.images().removeAt(index);
    this.images().markAsDirty();
  }

  protected setCover(index: number): void {
    chooseCover(this.images().controls, index);
  }
}
