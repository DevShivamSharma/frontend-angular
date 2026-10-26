import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** What a list or a section shows when there is nothing to list (or it could not be loaded). */
@Component({
  selector: 'app-empty-state',
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  readonly icon = input('pi-inbox');
  readonly title = input.required<string>();
  readonly message = input<string>();
  /** Offers Reload the page, for a failure only a reload mends. */
  readonly reload = input(false);
  /** The heading level of the title: 2 when nothing but the page title is above it, else 3. */
  readonly level = input<2 | 3>(3);

  protected reloadPage(): void {
    location.reload();
  }
}
