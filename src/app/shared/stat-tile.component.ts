import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IconComponent } from './icon.component';
import { RouterLink } from '@angular/router';

export type StatTone = 'primary' | 'secondary' | 'tertiary' | 'error';

/** One headline number with its meaning; a link when there is somewhere to go. */
@Component({
  selector: 'app-stat-tile',
  imports: [NgTemplateOutlet, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link()) {
      <a class="tile" [routerLink]="link()" [attr.aria-label]="label() + ': ' + value()">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div class="tile"><ng-container [ngTemplateOutlet]="body" /></div>
    }
    <ng-template #body>
      <span class="icon" [class]="'icon tone-' + tone()" aria-hidden="true"
        ><app-icon [name]="icon()"
      /></span>
      <span class="text">
        <span class="label">{{ label() }}</span>
        <span class="value">{{ value() }}</span>
        @if (caption()) {
          <span class="caption">{{ caption() }}</span>
        }
      </span>
      @if (link()) {
        <app-icon class="go" name="arrow_forward" />
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .tile {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      height: 100%;
      padding: 20px;
      box-sizing: border-box;
      border-radius: 16px;
      border: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
      color: inherit;
      text-decoration: none;
      transition:
        border-color 150ms ease,
        box-shadow 150ms ease;
    }
    a.tile:hover {
      border-color: var(--app-outline);
      box-shadow: var(--app-level1);
    }
    a.tile:focus-visible {
      outline: 2px solid var(--app-primary);
      outline-offset: 2px;
    }
    .icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 44px;
      height: 44px;
      border-radius: 12px;
    }
    .tone-primary {
      background: var(--app-primary-container);
      color: var(--app-on-primary-container);
    }
    .tone-secondary {
      background: var(--app-secondary-container);
      color: var(--app-on-secondary-container);
    }
    .tone-tertiary {
      background: var(--app-tertiary-container);
      color: var(--app-on-tertiary-container);
    }
    .tone-error {
      background: var(--app-error-container);
      color: var(--app-on-error-container);
    }
    .text {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .label {
      font: var(--app-label-large);
      color: var(--app-on-surface-variant);
    }
    .value {
      font: var(--app-headline-medium);
      font-variant-numeric: tabular-nums;
      color: var(--app-on-surface);
    }
    .caption {
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
    }
    .go {
      align-self: center;
      color: var(--app-on-surface-variant);
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
