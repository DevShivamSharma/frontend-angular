import { AbstractControl, FormBuilder, ValidationErrors, Validators } from '@angular/forms';

import { HallImagePayload } from './hall-payload';

/** `T_DOCUMENTS.path`, where ITPO keeps a picture's URL, holds 200 characters. */
export const MAX_IMAGE_URL = 200;
export const MAX_HALL_IMAGES = 20;

/** An https address (a picture is shown from where it is kept, so a plain http one would be blocked). */
export function httpsUrl(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? null : { message: 'Use an https address.' };
  } catch {
    return { message: 'Enter the full address, starting with https://' };
  }
}

/** One picture: where it is kept, and whether it is the hall's cover. */
export function createImageGroup(fb: FormBuilder) {
  return fb.nonNullable.group({
    url: ['', [Validators.required, httpsUrl, Validators.maxLength(MAX_IMAGE_URL)]],
    cover: [false],
  });
}

export type ImageGroup = ReturnType<typeof createImageGroup>;

/** Makes the one at `index` the cover, and none of the others (a hall has one). */
export function chooseCover(groups: readonly ImageGroup[], index: number): void {
  groups.forEach((group, i) =>
    group.controls.cover.setValue(i === index && group.value.cover === true),
  );
}

/** The pictures filled in, as the API takes them; a row left empty is not a picture. */
export function toImagePayloads(groups: readonly ImageGroup[]): HallImagePayload[] {
  return groups
    .map((group) => group.getRawValue())
    .filter((value) => value.url.trim() !== '')
    .map((value) => ({ url: value.url.trim(), kind: value.cover ? 'cover' : 'gallery' }));
}
