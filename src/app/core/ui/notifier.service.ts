import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { errorMessage } from '../api/http-error';

/** Short confirmations and failures, as a snackbar. */
@Injectable({ providedIn: 'root' })
export class Notifier {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'OK', { duration: 4000 });
  }

  error(error: unknown, fallback?: string): void {
    this.snackBar.open(errorMessage(error, fallback), 'Dismiss', {
      duration: 8000,
      panelClass: 'app-snackbar-error',
      politeness: 'assertive',
    });
  }
}
