import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from './icon.component';
import { TooltipModule } from 'primeng/tooltip';

/** A link to pass on by hand, with a copy button. */
@Component({
  selector: 'app-copy-link',
  imports: [ButtonModule, IconComponent, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <code class="url">{{ url() }}</code>
    <button
      pButton
      [text]="true"
      [rounded]="true"
      severity="secondary"
      type="button"
      (click)="copy()"
      [pTooltip]="copied() ? 'Copied' : 'Copy link'"
      [attr.aria-label]="label()"
    >
      <app-icon [name]="copied() ? 'check' : 'content_copy'" />
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
      border-radius: 8px;
      background: var(--app-surface-container-high);
      min-width: 0;
    }
    .url {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font: var(--app-body-small);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  `,
})
export class CopyLinkComponent {
  private readonly clipboard = inject(Clipboard);

  readonly url = input.required<string>();
  readonly label = input('Copy link');
  protected readonly copied = signal(false);

  protected copy(): void {
    this.copied.set(this.clipboard.copy(this.url()));
    setTimeout(() => this.copied.set(false), 2000);
  }
}
