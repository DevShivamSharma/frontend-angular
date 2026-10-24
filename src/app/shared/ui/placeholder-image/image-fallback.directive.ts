import { Directive, ElementRef, HostListener, inject } from '@angular/core';

import { PLACEHOLDER_IMAGE } from './placeholder-image';

/** On an `<img>`: when its picture cannot be loaded, shows the placeholder instead (once, so it cannot loop). */
@Directive({ selector: 'img[appImageFallback]' })
export class ImageFallbackDirective {
  private readonly image = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement;

  @HostListener('error')
  protected onError(): void {
    if (this.image.src !== PLACEHOLDER_IMAGE) {
      this.image.src = PLACEHOLDER_IMAGE;
    }
  }
}
