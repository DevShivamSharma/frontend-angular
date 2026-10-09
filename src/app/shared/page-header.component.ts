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
    :host {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    h1 {
      font: var(--app-headline-small);
    }
    p {
      margin: 4px 0 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
      .white{
      color: white !important;
      }
  `,
})
export class PageHeaderComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
}
