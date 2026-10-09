import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AppDialog } from './app-dialog.service';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(AppDialog);

  /** Resolves true when confirmed. */
  async confirm(data: Omit<ConfirmDialogData, 'reasonLabel'>): Promise<boolean> {
    const result = await firstValueFrom(
      this.dialog.open(ConfirmDialogComponent, { data, width: 'min(440px, 94vw)' }),
    );
    return result === true;
  }

  /** Resolves the reason entered, or null when cancelled. */
  async askReason(data: ConfirmDialogData & { reasonLabel: string }): Promise<string | null> {
    const result = await firstValueFrom(
      this.dialog.open(ConfirmDialogComponent, { data, width: 'min(480px, 94vw)' }),
    );
    return typeof result === 'string' ? result : null;
  }
}
