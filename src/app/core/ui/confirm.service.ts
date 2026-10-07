import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  /** Resolves true when confirmed. */
  async confirm(data: Omit<ConfirmDialogData, 'reasonLabel'>): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data, width: '440px' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /** Resolves the reason entered, or null when cancelled. */
  async askReason(data: ConfirmDialogData & { reasonLabel: string }): Promise<string | null> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data, width: '480px' });
    const result: unknown = await firstValueFrom(ref.afterClosed());
    return typeof result === 'string' ? result : null;
  }
}
