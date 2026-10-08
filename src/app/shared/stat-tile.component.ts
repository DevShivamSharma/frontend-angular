import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export type StatTone = 'primary' | 'secondary' | 'tertiary' | 'error';

/** One headline number with its meaning; a link when there is somewhere to go. */
@Component({
  selector: 'app-stat-tile',
  imports: [NgTemplateOutlet, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link()) {
      <a class="tile card-link" [routerLink]="link()" [attr.aria-label]="label() + ': ' + value()">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div class="tile"><ng-container [ngTemplateOutlet]="body" /></div>
    }
    <ng-template #body>
      <span class="icon" [class]="'icon tone-' + tone()" aria-hidden="true"
        ><mat-icon>{{ icon() }}</mat-icon></span
      >
      <span class="text">
        <span class="label">{{ label() }}</span>
        <span class="value">{{ value() }}</span>
        @if (caption()) {
          <span class="caption">{{ caption() }}</span>
        }
      </span>
      @if (link()) {
        <mat-icon class="go" aria-hidden="true">arrow_forward</mat-icon>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    /* The shared card surface (styles.scss); a link tile also gets the card-link lift. */
    .tile {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      height: 100%;
      padding: 22px;
      box-sizing: border-box;
      border-radius: var(--card-radius);
      border: 1px solid var(--card-border);
      background: var(--card-surface);
      box-shadow: var(--card-highlight);
      color: inherit;
      text-decoration: none;
    }
    .icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 48px;
      height: 48px;
      border-radius: 14px;
      box-shadow: var(--card-highlight);
    }
    .tone-primary {
      background: var(--card-icon-fill);
      color: var(--mat-sys-on-primary-container);
    }
    .tone-secondary {
      background: linear-gradient(
        135deg,
        var(--mat-sys-secondary-container),
        color-mix(in srgb, var(--mat-sys-secondary-container) 60%, var(--mat-sys-primary-container))
      );
      color: var(--mat-sys-on-secondary-container);
    }
    .tone-tertiary {
      background: linear-gradient(
        135deg,
        var(--mat-sys-tertiary-container),
        color-mix(in srgb, var(--mat-sys-tertiary-container) 65%, var(--mat-sys-primary-container))
      );
      color: var(--mat-sys-on-tertiary-container);
    }
    .tone-error {
      background: linear-gradient(
        135deg,
        var(--mat-sys-error-container),
        color-mix(in srgb, var(--mat-sys-error-container) 70%, var(--mat-sys-tertiary-container))
      );
      color: var(--mat-sys-on-error-container);
    }
    .text {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .label {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    /* The number is the point of the tile: large, in the display face. */
    .value {
      margin: 6px 0 4px;
      font-family: var(--app-display-font);
      font-size: clamp(2rem, 1.6rem + 1vw, 2.75rem);
      font-weight: 600;
      line-height: 1.05;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
    }
    .caption {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .go {
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      transition: transform 200ms ease-out;
    }
    a.tile:hover .go,
    a.tile:focus-visible .go {
      transform: translateX(4px);
      color: var(--mat-sys-primary);
    }
    @media (prefers-reduced-motion: reduce) {
      .go {
        transition: none;
      }
      a.tile:hover .go,
      a.tile:focus-visible .go {
        transform: none;
      }
    }
  `,
})
export class StatTileComponent {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly caption = input<string>();
  readonly link = input<string | string[]>();
  readonly tone = input<StatTone>('primary');
}
