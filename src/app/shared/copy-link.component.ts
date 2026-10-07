import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/** A link to pass on by hand, with a copy button. */
@Component({
  selector: 'app-copy-link',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <code class="url">{{ url() }}</code>
    <button
      mat-icon-button
      type="button"
      (click)="copy()"
      [matTooltip]="copied() ? 'Copied' : 'Copy link'"
      [attr.aria-label]="label()"
    >
      <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      min-width: 0;
    }
    .url {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font: var(--mat-sys-body-small);
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
