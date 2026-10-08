import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A page's title, an optional line under it, and its main actions (projected). */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="titles">
      <h1>{{ heading() }}</h1>
      @if (subheading()) {
        <p class="muted">{{ subheading() }}</p>
      }
      <ng-content select="[meta]" />
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    /* An editorial split: a wide title on the left, the page's actions on its baseline. */
    :host {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px 32px;
      flex-wrap: wrap;
      padding-bottom: 4px;
    }
    .titles {
      min-width: 0;
    }
    /* Wide and fluid, so a title stays on one or two lines at any width. */
    h1 {
      font-family: var(--app-display-font);
      font-size: clamp(1.875rem, 1.3rem + 1.5vw, 2.625rem);
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.025em;
      text-wrap: balance;
      overflow-wrap: anywhere;
    }
    p {
      margin: 8px 0 0;
      max-width: 72ch;
      font: var(--mat-sys-body-large);
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `,
})
export class PageHeaderComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
}
