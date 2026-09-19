import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Every icon this app draws. Kept explicit so a typo is a compile error. */
export type IconName =
  | 'building'
  | 'upload'
  | 'file'
  | 'plus'
  | 'pencil'
  | 'store'
  | 'save'
  | 'refresh'
  | 'eye'
  | 'trash'
  | 'check'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right';

/**
 * Inline stroke icons, Lucide-style (24x24 grid, 2px stroke, currentColor).
 *
 * The React build used emoji as icons. Emoji render as full-colour bitmaps
 * that differ per operating system, ignore the surrounding text colour, and
 * are announced by screen readers as their unicode name - so they are replaced
 * here with SVG that inherits `color` and is hidden from assistive tech.
 *
 * A `@switch` of literal SVG is deliberate: no icon dependency, no sanitizer,
 * and the template stays type-checked.
 */
@Component({
  selector: 'app-icon',
  templateUrl: './icon.component.html',
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
        line-height: 0;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(16);
}
