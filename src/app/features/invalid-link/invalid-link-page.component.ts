import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * What any URL that names no organisation shows, the bare domain included. It deliberately
 * lists no organisations: the way in is the link a venue shares.
 */
@Component({
  selector: 'app-invalid-link-page',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="frame">
      <mat-icon class="icon" aria-hidden="true">link_off</mat-icon>
      <h1>This link doesn't lead anywhere</h1>
      <p class="muted">
        Use the link your venue or event organiser shared with you. If you typed the address, check
        its spelling.
      </p>
    </main>
  `,
  styles: `
    /* A quiet stage: a soft glow of the platform's colour above a wide, calm message. */
    .frame {
      min-height: 100dvh;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 16px;
      padding: 24px;
      text-align: center;
      background:
        radial-gradient(
          70% 50% at 50% 0%,
          color-mix(in srgb, var(--mat-sys-primary) 12%, transparent),
          transparent 70%
        ),
        var(--mat-sys-surface-container-low);
      box-sizing: border-box;
    }
    /* The icon in a large lit tile, like the cards' own. */
    .icon {
      width: 88px;
      height: 88px;
      margin-bottom: 8px;
      font-size: 44px;
      line-height: 88px;
      text-align: center;
      border-radius: 28px;
      background: var(--card-icon-fill);
      color: var(--mat-sys-on-primary-container);
      box-shadow: var(--card-highlight);
    }
    h1 {
      font-family: var(--app-display-font);
      font-size: clamp(1.875rem, 1.3rem + 1.8vw, 2.75rem);
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.025em;
      text-wrap: balance;
    }
    p {
      max-width: 46ch;
      margin: 0;
      font: var(--mat-sys-body-large);
    }
  `,
})
export class InvalidLinkPageComponent {}
