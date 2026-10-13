import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';

export interface BookDialogData {
  slug: string;
  eventId: string;
  hallId: string;
  /** The organisation's support address, if it gave one. */
  contactEmail: string | null;
  /** Signed in, but the account cannot book stalls. */
  signedIn: boolean;
}

/**
 * What to do when someone without a booking account presses "Book this stall": sign in, or ask
 * the organiser for an invitation (accounts are not made here).
 */
@Component({
  selector: 'app-book-dialog',
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Book this stall</h2>
    <div class="dialog-content">
      @if (data.signedIn) {
        <p class="message">
          You are signed in, but this account cannot book stalls. Bookings are by invitation: ask
          the organiser to invite you.
        </p>
      } @else {
        <p class="message">Sign in with the account you were invited with to hold a stall.</p>
        <p class="message">
          No account? Bookings are by invitation: ask the organiser to invite you.
        </p>
      }
      @if (data.contactEmail; as email) {
        <p class="message">
          Write to <a [href]="'mailto:' + email">{{ email }}</a
          >.
        </p>
      }
    </div>
    <div class="dialog-actions">
      <button
        pButton
        type="button"
        label="Close"
        [text]="true"
        severity="secondary"
        (click)="ref.close()"
      ></button>
      @if (!data.signedIn) {
        <button pButton type="button" label="Sign in to book" (click)="signIn()"></button>
      }
    </div>
  `,
  styles: `
    .message {
      margin: 0 0 12px;
      color: var(--app-on-surface-variant);
    }
  `,
})
export class BookDialogComponent {
  protected readonly data = dialogData<BookDialogData>();
  protected readonly ref = inject(DialogRef);
  private readonly router = inject(Router);

  /** Signing in brings the person back to the portal's page for this hall. */
  protected signIn(): void {
    const { slug, eventId, hallId } = this.data;
    void this.router.navigate(['/', slug, 'login'], {
      queryParams: { returnUrl: `/${slug}/portal/events/${eventId}/halls/${hallId}` },
    });
    this.ref.close();
  }
}
