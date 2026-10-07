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
      <a class="tile" [routerLink]="link()" [attr.aria-label]="label() + ': ' + value()">
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
    .tile {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      height: 100%;
      padding: 20px;
      box-sizing: border-box;
      border-radius: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
      text-decoration: none;
      transition:
        border-color 150ms ease,
        box-shadow 150ms ease;
    }
    a.tile:hover {
      border-color: var(--mat-sys-outline);
      box-shadow: var(--mat-sys-level1);
    }
    a.tile:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
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
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .tone-secondary {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .tone-tertiary {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .tone-error {
      background: var(--mat-sys-error-container);
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
    .value {
      font: var(--mat-sys-headline-medium);
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
