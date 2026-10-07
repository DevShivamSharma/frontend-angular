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
    .frame {
      min-height: 100dvh;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 12px;
      padding: 24px;
      text-align: center;
      background: var(--mat-sys-surface-container-low);
      box-sizing: border-box;
    }
    .icon {
      width: 56px;
      height: 56px;
      font-size: 56px;
      color: var(--mat-sys-primary);
    }
    h1 {
      font: var(--mat-sys-headline-small);
    }
    p {
      max-width: 440px;
      margin: 0;
    }
  `,
})
export class InvalidLinkPageComponent {}
