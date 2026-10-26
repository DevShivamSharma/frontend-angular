import { ImageFallbackDirective } from '../../../../shared/ui/placeholder-image/image-fallback.directive';
import { PLACEHOLDER_IMAGE } from '../../../../shared/ui/placeholder-image/placeholder-image';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { HallImage } from '../../data/halls.models';

/**
 * The pictures of a hall: a large one, and the others as thumbnails to choose from. The cover is
 * shown first. A picture that cannot be loaded (a broken address) is left out rather than shown
 * as a broken image.
 */
@Component({
  selector: 'app-hall-gallery',
  imports: [ImageFallbackDirective, ButtonModule],
  templateUrl: './hall-gallery.component.html',
  styleUrl: './hall-gallery.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallGalleryComponent {
  readonly images = input.required<readonly HallImage[]>();
  protected readonly placeholder = PLACEHOLDER_IMAGE;
  readonly hallName = input.required<string>();
  /** ITPO staff may take a picture off. */
  readonly canRemove = input(false);

  readonly removed = output<HallImage>();

  private readonly broken = signal<ReadonlySet<number>>(new Set());
  private readonly chosenId = signal<number | null>(null);

  /** The cover first, then the rest in the order ITPO lists them. */
  protected readonly shown = computed(() => {
    const usable = this.images().filter((image) => !this.broken().has(image.documentId));
    return [
      ...usable.filter((i) => i.kind === 'cover'),
      ...usable.filter((i) => i.kind !== 'cover'),
    ];
  });

  protected readonly current = computed(
    () =>
      this.shown().find((image) => image.documentId === this.chosenId()) ?? this.shown()[0] ?? null,
  );

  protected choose(image: HallImage): void {
    this.chosenId.set(image.documentId);
  }

  protected markBroken(image: HallImage): void {
    this.broken.update((ids) => new Set(ids).add(image.documentId));
  }

  protected alt(image: HallImage, index: number): string {
    return `${this.hallName()}, picture ${index + 1}`;
  }
}
