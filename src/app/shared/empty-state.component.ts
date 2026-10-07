import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** What to show where a list is empty: what this place is for, and the way to fill it. */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="icon" aria-hidden="true"
      ><mat-icon>{{ icon() }}</mat-icon></span
    >
    <p class="title">{{ heading() }}</p>
    @if (text()) {
      <p class="text">{{ text() }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: grid;
      justify-items: center;
      gap: 8px;
      padding: 40px 16px;
      text-align: center;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 20px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-primary);
    }
    .icon mat-icon {
      width: 32px;
      height: 32px;
      font-size: 32px;
    }
    p {
      margin: 0;
      max-width: 420px;
    }
    .title {
      margin-top: 8px;
      font: var(--mat-sys-title-medium);
    }
    .text {
      color: var(--mat-sys-on-surface-variant);
    }
    .actions:not(:empty) {
      margin-top: 8px;
    }
  `,
})
export class EmptyStateComponent {
  readonly icon = input('inbox');
  readonly heading = input.required<string>();
  readonly text = input<string>();
}
