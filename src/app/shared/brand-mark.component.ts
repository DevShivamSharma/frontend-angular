import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { ColorSchemeService } from '../core/theme/color-scheme.service';
import { readableOn } from './readable-color';

/**
 * An organisation's logo, or a monogram of its name when it has none (or the logo fails to
 * load). In dark mode it prefers the dark-surface logo.
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (logo() && !failed()) {
      <picture>
        <img
          [src]="logo()"
          [alt]="name() + ' logo'"
          [style.height.px]="size()"
          (error)="failed.set(true)"
        />
      </picture>
    } @else {
      <span
        class="monogram"
        [style.width.px]="size()"
        [style.height.px]="size()"
        aria-hidden="true"
      >
        {{ initials() }}
      </span>
    }
    @if (showName()) {
      <span class="name">{{ name() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    img {
      display: block;
      max-width: 180px;
      object-fit: contain;
    }
    .monogram {
      display: inline-grid;
      place-items: center;
      flex: none;
      border-radius: 28%;
      background: var(--app-primary);
      color: var(--app-on-primary);
      font-family: var(--app-font-family);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .name {
      font: var(--app-title-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class BrandMarkComponent {
  readonly name = input.required<string>();
  readonly logoUrl = input<string | null>(null);
  readonly logoDarkUrl = input<string | null>(null);
  readonly size = input(36);
  readonly showName = input(true);
  /** The organisation's own colour for the monogram; the theme's primary when absent. */
  readonly color = input<string | null>(null);

  protected readonly failed = signal(false);
  protected readonly textColor = computed(() => readableOn(this.color() ?? ''));
  private readonly schemes = inject(ColorSchemeService);
  /** In dark mode (chosen, or the device's), the dark-surface logo when there is one. */
  protected readonly logo = computed(() =>
    this.schemes.dark() && this.logoDarkUrl() ? this.logoDarkUrl() : this.logoUrl(),
  );
  protected readonly initials = computed(() =>
    this.name()
      .split(/[\s()-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join(''),
  );
}
