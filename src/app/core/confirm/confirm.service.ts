import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AppDialog } from '../dialog/app-dialog.service';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';
import { ReasonDialogComponent, ReasonDialogData } from '../dialog/reason-dialog.component';

export interface ConfirmOptions {
  header: string;
  message: string;
  /** The button that goes ahead, named for what it does ("Create", "Remove"). */
  acceptLabel: string;
  rejectLabel?: string;
  /** For what cannot be undone: the button is red. */
  danger?: boolean;
  /** A PrimeIcons class for the dialog's icon; the question mark when not given. */
  icon?: string;
}

/**
 * Asks the user to confirm before an action is sent. One question, one place: the dialog is the
 * app's own component, opened through {@link AppDialog}, so every confirmation looks and behaves the same.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(AppDialog);

  /** Resolves true when the user goes ahead, false when they decline or close the dialog. */
  async ask(options: ConfirmOptions): Promise<boolean> {
    const answer = await firstValueFrom(
      this.dialog.open<boolean, ConfirmDialogData>(ConfirmDialogComponent, {
        data: {
          header: options.header,
          message: options.message,
          acceptLabel: options.acceptLabel,
          rejectLabel: options.rejectLabel ?? 'Cancel',
          icon:
            options.icon ??
            (options.danger ? 'pi pi-exclamation-triangle' : 'pi pi-question-circle'),
          danger: !!options.danger,
        },
        width: 'min(24rem, 94vw)',
      }),
      { defaultValue: undefined },
    );
    return answer === true;
  }

  /** The same question in the words the stall planner was written with (title, confirm label). */
  confirm(data: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean> {
    return this.ask({
      header: data.title,
      message: data.message,
      acceptLabel: data.confirmLabel,
      rejectLabel: data.cancelLabel,
      danger: data.destructive,
    });
  }

  /** Asks for a reason; resolves what was typed, or null when cancelled. */
  async askReason(data: ReasonDialogData): Promise<string | null> {
    const result = await firstValueFrom(
      this.dialog.open<string, ReasonDialogData>(ReasonDialogComponent, {
        data,
        width: 'min(480px, 94vw)',
      }),
    );
    return typeof result === 'string' ? result : null;
  }
}
