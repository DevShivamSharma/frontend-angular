import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconComponent } from '../../shared/icon.component';

/**
 * What any URL that names no organisation shows, the bare domain included. It deliberately
 * lists no organisations: the way in is the link a venue shares.
 */
@Component({
  selector: 'app-invalid-link-page',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="frame">
      <app-icon class="icon" name="link_off" />
      <h1>This link doesn't lead anywhere</h1>
      <p class="muted">
        Use the link your venue or event organiser shared with you. If you typed the address, check
        its spelling.
      </p>
    </main>
  `,
  styles: `
    .frame {
      min-height: 100dvh;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 12px;
      padding: 24px;
      text-align: center;
      background: var(--app-surface-container-low);
      box-sizing: border-box;
    }
    .icon {
      width: 56px;
      height: 56px;
      font-size: 56px;
      color: var(--app-primary);
    }
    h1 {
      font: var(--app-headline-small);
    }
    p {
      max-width: 440px;
      margin: 0;
    }
  `,
})
export class InvalidLinkPageComponent {}
