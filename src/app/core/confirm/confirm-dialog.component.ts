import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { dialogData, DialogRef } from '../dialog/app-dialog.service';

export interface ConfirmDialogData {
  header: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  /** A PrimeIcons class. */
  icon: string;
  /** For what cannot be undone: the icon and the button are red. */
  danger: boolean;
}

/** The question every confirmation asks. Closes with `true` to go ahead, `false` (or nothing) otherwise. */
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  protected readonly data = dialogData<ConfirmDialogData>();
  protected readonly ref = inject(DialogRef);
}
