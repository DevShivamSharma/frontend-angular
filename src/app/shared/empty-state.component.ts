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
      padding: 48px 16px;
      text-align: center;
    }
    /* The icon sits in a tile lit from one corner by the organisation's colour. */
    .icon {
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      border-radius: 24px;
      border: 1px solid
        color-mix(in srgb, var(--mat-sys-primary) 14%, var(--mat-sys-outline-variant));
      background:
        radial-gradient(
          circle at 30% 20%,
          color-mix(in srgb, var(--mat-sys-primary) 20%, transparent),
          transparent 70%
        ),
        var(--mat-sys-surface-container-high);
      color: var(--mat-sys-primary);
    }
    .icon mat-icon {
      width: 34px;
      height: 34px;
      font-size: 34px;
    }
    p {
      margin: 0;
      max-width: 46ch;
    }
    .title {
      margin-top: 12px;
      font-family: var(--app-display-font);
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.25;
      letter-spacing: -0.01em;
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
