import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';

/** What a list of cards shows while it loads: cards of the same shape, so nothing jumps when they arrive. */
@Component({
  selector: 'app-card-skeleton',
  imports: [SkeletonModule],
  templateUrl: './card-skeleton.component.html',
  styleUrl: './card-skeleton.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-label': 'Loading' },
})
export class CardSkeletonComponent {
  readonly count = input(6);
  /** The cards have a picture beside their text. */
  readonly media = input(false);
  protected readonly items = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
