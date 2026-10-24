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
}
